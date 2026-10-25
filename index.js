/**
 * dsh-cyrene 宿主半体
 *
 * 本文件刻意不做任何运行时改动：它的价值全在 preset/ 目录里的 agent 预设。
 * 本文件的作用只是给 profile bundle 提供一个可加载的包锚点。
 *
 * 真正会注册东西的宿主逻辑由**预设**挂载：memory.js（记忆变量 + 工具）、
 * nickname.js（称呼变量）、worldbook/（世界书注入）。它们只作用于该预设的会话，
 * 不污染其它模式。详见 docs/host-side.md。
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCENE_STORE, readState, writeState } from './scene.js';
import { DEFAULT_NICKNAME, loadProfile, sanitize, saveField } from './nickname.js';
import {
  STYLES,
  readState as readStyleState,
  writeState as writeStyleState,
  resolveStyle,
  labelOf,
  chooseStyle
} from './style.js';

/** 插件 id（与 package.json 的 dsh.id、cordis.patch.yml 的条目 id 保持一致）。 */
export const name = 'dsh-cyrene';

/**
 * 版本号：**从 package.json 读**，不再手写一份。
 *
 * 早先这里是硬编码的字符串，于是版本散在四处（package.json 两处、plugin.json、
 * dsh.plugin.json、这里），改一次要同步五遍 —— README 甚至为此专门写了"改名要同步哪几处"
 * 的提醒。读出来就没有可不同步的机会了。
 *
 * 读不到就退回 '0.0.0'：版本号只用于健康检查与日志，不该让插件加载失败。
 */
export const version = (() => {
  try {
    const file = fileURLToPath(new URL('./package.json', import.meta.url));
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed?.version === 'string' && parsed.version !== '' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/**
 * 不注入任何宿主服务。
 * 缺少可选服务时插件仍应正常加载——本文件不依赖它们。
 */
export const inject = [];

/**
 * `/cyrene-nickname-api` 的处理器：读 / 改「称呼偏好」与「昵称」。
 *
 * 与 `/cyrene-scene-api` 是同一套思路：浏览器半边碰不到文件系统，所以开关与输入框
 * 都走主机接口；真正落盘的是 nickname.js 的 `saveField`，双方读同一个
 * `<DSH_HOME>/dsha-brand-rename.json`（与昵称插件共用，读-改-写）。
 *
 * 字段语义对齐上游：`callPreference`（怎么叫）**优先**于 `nickname`（名字），
 * 两者都空时用默认的「伙伴」。`value` 传空串表示清除该字段（回落到另一个）。
 * 导出是为了单测（不经过 webServer）。
 * @param req - 请求对象。
 * @param res - 响应对象。
 */
export async function handleNicknameApi(req, res) {
  try {
    const snapshot = () => {
      const profile = loadProfile();
      return {
        ok: true,
        nickname: profile.nickname,
        callPreference: profile.callPreference,
        address: profile.address,
        default: DEFAULT_NICKNAME
      };
    };
    if (req.method === 'GET') {
      json(res, snapshot());
      return;
    }
    if (req.method !== 'POST') {
      json(res, { ok: false, error: '只支持 GET / POST' }, 405);
      return;
    }
    const raw = await readBody(req);
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      json(res, { ok: false, error: '请求体不是 JSON' }, 400);
      return;
    }
    const field = payload.field;
    if (field !== 'nickname' && field !== 'callPreference') {
      json(res, { ok: false, error: 'field 只能是 nickname / callPreference' }, 400);
      return;
    }
    if (typeof payload.value !== 'string') {
      json(res, { ok: false, error: 'value 必须是字符串' }, 400);
      return;
    }
    // 清洗会去掉花括号 / 控制字符、把换行压成空格。设置界面里输入的称呼**不该**被
    // 静默改写：要么原样接受，要么明确拒绝，否则用户看到「已保存」但存进去的是另一个词。
    const trimmed = payload.value.trim();
    if (sanitize(trimmed) !== trimmed) {
      json(res, { ok: false, error: '这个称呼不合法：不能带花括号、换行或控制字符' }, 400);
      return;
    }
    if (saveField(field, payload.value) === '') {
      json(res, { ok: false, error: '写入 ' + (field === 'nickname' ? '昵称' : '称呼偏好') + ' 失败' }, 500);
      return;
    }
    json(res, snapshot());
  } catch (error) {
    json(res, { ok: false, error: String(error?.message ?? error) }, 400);
  }
}

/** 更新检查的 GitHub 仓库（可用环境变量覆盖，便于 fork）。 */
const UPDATE_REPO = process.env.DSH_CYRENE_UPDATE_REPO || 'Cyrene-xl/DSH-Cyrene';
/** 更新检查缓存：一天。手动点一次就够，别每次都打 GitHub。 */
const UPDATE_CACHE_MS = 24 * 60 * 60 * 1000;
/** 内存缓存：{ at, etag, payload }。进程重启就重查。 */
let updateCache = null;

/**
 * 比较两个语义化版本（忽略 `v` 前缀与预发布后缀）。
 * @param a - 版本 A。
 * @param b - 版本 B。
 * @returns A>B 返回 1，A<B 返回 -1，相等返回 0。
 */
export function compareSemver(a, b) {
  const core = (v) => String(v || '').trim().replace(/^v/i, '').split('-')[0].split('+')[0]
    .split('.').map((n) => Number.parseInt(n, 10) || 0);
  const x = core(a);
  const y = core(b);
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] || 0) > (y[i] || 0)) return 1;
    if ((x[i] || 0) < (y[i] || 0)) return -1;
  }
  return 0;
}

/**
 * `/cyrene-update-api`：手动检查 GitHub 上的最新 Release。
 *
 * - `?meta=1`：只回当前本地版本，不联网（设置行初始化用）；
 * - 默认/`?force=1`：查 GitHub releases/latest，结果缓存 24 小时（带 ETag）；
 * - 网络失败也回 200 + `ok:false`，设置行显示原因，不抛错。
 */
export async function handleUpdateApi(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('meta') === '1') {
      json(res, { ok: true, current: version });
      return;
    }
    const force = url.searchParams.get('force') === '1';
    const now = Date.now();
    if (!force && updateCache !== null && now - updateCache.at < UPDATE_CACHE_MS) {
      json(res, { ok: true, ...updateCache.payload, cached: true });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let response;
    try {
      const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-cyrene-update-check' };
      if (updateCache?.etag) headers['if-none-match'] = updateCache.etag;
      response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        headers,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 304 && updateCache !== null) {
      updateCache.at = now;
      json(res, { ok: true, ...updateCache.payload, cached: true });
      return;
    }
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
    const data = await response.json();
    const latest = String(data.tag_name || '').replace(/^v/i, '');
    const payload = {
      current: version,
      latest,
      hasUpdate: latest !== '' && compareSemver(latest, version) > 0,
      url: typeof data.html_url === 'string' ? data.html_url : `https://github.com/${UPDATE_REPO}/releases`,
      checkedAt: new Date(now).toISOString()
    };
    updateCache = { at: now, etag: response.headers.get('etag') || null, payload };
    json(res, { ok: true, ...payload, cached: false });
  } catch (error) {
    json(res, {
      ok: false,
      current: version,
      error: String((error && error.message) || error),
      url: `https://github.com/${UPDATE_REPO}/releases`
    });
  }
}

/** 表达风格状态文件（style.js 读写的同一份）。 */
const STYLE_STORE = join(dirname(SCENE_STORE), 'cyrene-style.json');

/** 给浏览器半边的档位列表。 */
function styleListOf(state) {
  return Object.keys(STYLES).map((id) => ({
    id,
    label: labelOf(state, id),
    temperature: STYLES[id].temperature
  }));
}

/**
 * `/cyrene-style-api`：读 / 切换表达风格。
 *
 * 以前这个路由挂在 dsha-brand-rename 里（还硬编码了 `/root/dsh-cyrene/style.js`），
 * 换台机器就找不到。现在由 dsh-cyrene 自己提供 —— 装了本插件就有，
 * brand-rename 的风格按钮会直接用这个接口。
 *
 * POST 支持三种意图（按顺序判断）：
 *   - `{ customTier }`：只改「自定义档」的强度（1 / 2）；
 *   - `{ defaultStyle }`：改全局兜底档（没有会话时）；
 *   - `{ session, style }`：只改这个会话的档位。
 */
export async function handleStyleApi(req, res) {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const session = String(url.searchParams.get('session') || '');
      const state = readStyleState(STYLE_STORE);
      json(res, {
        ok: true,
        session,
        style: resolveStyle(state, session),
        default: state.default,
        customTier: state.customTier === 2 ? 2 : 1,
        styles: styleListOf(state)
      });
      return;
    }
    if (req.method !== 'POST') {
      json(res, { ok: false, error: '只支持 GET / POST' }, 405);
      return;
    }
    const raw = await readBody(req);
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      json(res, { ok: false, error: '请求体不是 JSON' }, 400);
      return;
    }
    const state = readStyleState(STYLE_STORE);

    if (payload.customTier !== undefined) {
      const tier = Number(payload.customTier) === 2 ? 2 : 1;
      if (!writeStyleState(STYLE_STORE, { ...state, customTier: tier })) {
        json(res, { ok: false, error: '写入 ' + STYLE_STORE + ' 失败' }, 500);
        return;
      }
      json(res, { ok: true, customTier: tier, styles: styleListOf(state) });
      return;
    }

    if (typeof payload.defaultStyle === 'string' && payload.defaultStyle !== '') {
      const wanted = payload.defaultStyle;
      if (!Object.prototype.hasOwnProperty.call(STYLES, wanted)) {
        json(res, { ok: false, error: '没有这个风格：' + wanted }, 400);
        return;
      }
      writeStyleState(STYLE_STORE, { ...state, default: wanted });
      json(res, { ok: true, style: wanted, default: wanted, styles: styleListOf(state) });
      return;
    }

    const session = String(payload.session || '');
    const style = String(payload.style || '');
    if (!Object.prototype.hasOwnProperty.call(STYLES, style)) {
      json(res, { ok: false, error: '没有这个风格：' + style }, 400);
      return;
    }
    if (session === '') {
      json(res, { ok: false, error: '缺少会话 id' }, 400);
      return;
    }
    if (!writeStyleState(STYLE_STORE, chooseStyle(state, session, style, Date.now()))) {
      json(res, { ok: false, error: '写入 ' + STYLE_STORE + ' 失败' }, 500);
      return;
    }
    json(res, { ok: true, session, style, styles: styleListOf(state) });
  } catch (error) {
    json(res, { ok: false, error: String((error && error.message) || error) }, 500);
  }
}

/** 设置界面用的接口路径：表达风格。 */
export const STYLE_API_PATH = '/cyrene-style-api';

/** 设置界面用的接口路径：手动检查更新。 */
export const UPDATE_API_PATH = '/cyrene-update-api';
/** 设置界面用的接口路径：角色扮演模式开关。 */
export const SCENE_API_PATH = '/cyrene-scene-api';
/** 设置界面用的接口路径：称呼偏好 / 昵称。 */
export const NICKNAME_API_PATH = '/cyrene-nickname-api';

/**
 * 写 JSON 响应。
 * @param res - 响应对象。
 * @param obj - 要序列化的对象。
 * @param status - HTTP 状态码。
 */
function json(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

/**
 * 读请求体（设置界面只发很小的 JSON）。
 * @param req - 请求对象。
 * @returns 请求体文本。
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 设置界面用的接口路径：编辑最后一条用户消息。 */
export const EDIT_API_PATH = '/cyrene-edit-api';
/** 编辑按钮的图标。 */
export const EDIT_ICON_PATH = '/cyrene-edit-icon.png';
/** 图标文件（随包发运，浏览器半边用 `<img>` 引用）。 */
const EDIT_ICON_FILE = fileURLToPath(new URL('./assets/edit-icon.png', import.meta.url));
/** 能进入「表面」（模型可见历史）的事件类型。 */
const SURFACE_TYPES = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result']);

/**
 * 把事件日志折叠成当前的**表面**（模型可见的那串消息）。
 *
 * 会话日志是 append-only 的：一条事件可以带 `surfaceOp: { op:'replace', startSeq, endSeq }`
 * 把一段旧节点从表面里换掉（旧事件仍留在日志里）。这里按同样的规则重放一遍，
 * 得到「现在哪些 seq 还在表面上、顺序如何」—— 编辑功能靠它判断能不能改、改哪段。
 * @param events - 按 seq 升序的事件数组（`session.snapshotEvents()`）。
 * @returns 表面节点的 seq 数组。
 */
export function foldSurface(events) {
  const nodes = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || !SURFACE_TYPES.has(event.type)) continue;
    const op = event.surfaceOp;
    if (op === undefined || op === 'append') {
      nodes.push(event.seq);
      continue;
    }
    const startIdx = nodes.indexOf(op.startSeq);
    const endIdx = nodes.indexOf(op.endSeq);
    // 坏日志（端点已被更早的替换盖掉）就跳过这一条，别让整次折叠抛错。
    if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) continue;
    nodes.splice(startIdx, endIdx - startIdx + 1, event.seq);
  }
  return nodes;
}

/**
 * 判断能不能编辑「最后一条用户消息」，以及要替换哪一段。
 *
 * 规则（都是为了让模型看到的历史自洽）：
 *   - 只认 `source.kind === 'user'` 的消息 —— 插件注入的标记不算用户输入；
 *   - 只改**最后一条**用户消息，且它之后不能再有用户消息；
 *   - 那一轮必须已经结束：表面最后是 `assistant/message`（已回复）或者
 *     这条用户消息本身（还没回复）。最后是 tool/result / system 说明还在跑，拒绝；
 *   - 带图片 / 文件的消息不编辑 —— 替换事件只带文本，附件会被静默丢掉。
 *
 * 返回两个可用的替换范围（调用方二选一）：
 *   - **只改这条**：`[singleStartSeq, singleEndSeq]` + `singleShadowed` —— 后续回复保留，
 *     日志里只是把这一条用户消息换掉（和 dsh-plugin-message-edit 的「保存」同义）；
 *   - **改并撤回后续**：`[startSeq, endSeq]` + `shadowed` —— 相当于「改口重说」。
 * @param events - 按 seq 升序的事件数组。
 * @returns `{ ok, reason?, startSeq, endSeq, shadowed, singleStartSeq, singleEndSeq, singleShadowed, text, source }`。
 */
export function planEdit(events) {
  const bySeq = new Map();
  for (const event of Array.isArray(events) ? events : []) bySeq.set(event.seq, event);
  const nodes = foldSurface(events);
  if (nodes.length === 0) return { ok: false, reason: '这个会话还没有消息' };

  const last = bySeq.get(nodes[nodes.length - 1]);
  if (last !== undefined && last.type === 'tool/result') {
    return { ok: false, reason: '她还在执行工具，等这一轮结束再改' };
  }
  if (last !== undefined && last.type === 'system/message') {
    return { ok: false, reason: '这一轮还没开始，暂时不能编辑' };
  }

  let userIdx = -1;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const event = bySeq.get(nodes[i]);
    if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
      userIdx = i;
      break;
    }
  }
  if (userIdx === -1) return { ok: false, reason: '这个会话里还没有你发的消息' };
  if (userIdx !== nodes.length - 1 && nodes.length - 1 !== userIdx) {
    // 后面还有 assistant 回复是正常的（userIdx 是最后一个用户消息），
    // 但若后面还有**用户消息**，说明我们找到的不是最后一条 —— 直接拒绝，避免改错。
    for (let i = userIdx + 1; i < nodes.length; i += 1) {
      const event = bySeq.get(nodes[i]);
      if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
        return { ok: false, reason: '只能改最后一条消息' };
      }
    }
  }

  const entry = bySeq.get(nodes[userIdx]);
  const content = Array.isArray(entry?.data?.content) ? entry.data.content : [];
  const textBlocks = content.filter((block) => block?.type === 'text');
  const otherBlocks = content.filter((block) => block?.type !== 'text');
  if (otherBlocks.length > 0) {
    return { ok: false, reason: '这条消息带图片或文件，暂时不能在这里编辑' };
  }
  const text = textBlocks.map((block) => String(block.text ?? '')).join('\n').trim();
  if (text === '') return { ok: false, reason: '这条消息里没有可编辑的文字' };

  const shadowed = nodes.slice(userIdx);
  const single = [nodes[userIdx]];
  return {
    ok: true,
    startSeq: shadowed[0],
    endSeq: shadowed[shadowed.length - 1],
    shadowed,
    singleStartSeq: single[0],
    singleEndSeq: single[0],
    singleShadowed: single,
    text,
    source: entry.data.source
  };
}

/**
 * 取「最后一条用户消息」的版本链（旧 → 新）。
 *
 * 编辑就是一次**单节点表面替换**：新事件把旧的那一格顶掉。于是版本链可以这样倒推：
 * 当前节点如果本身是一次替换（`surfaceOp.startSeq === endSeq`），它盖掉的那个节点
 * 就是上一版；再往上同理。链最长留 20 版，防坏日志死循环。
 *
 * 这样「方向键切换」不需要额外存任何东西 —— 版本链完全从事件日志里读出来。
 * @param events - 按 seq 升序的事件数组。
 * @returns `{ versions: [{ seq, text, time }], currentIndex }`；没有用户消息时 versions 为空。
 */
export function versionChain(events) {
  const bySeq = new Map();
  for (const event of Array.isArray(events) ? events : []) bySeq.set(event.seq, event);
  const nodes = foldSurface(events);
  let idx = -1;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const event = bySeq.get(nodes[i]);
    if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
      idx = i;
      break;
    }
  }
  if (idx === -1) return { versions: [], currentIndex: -1 };

  const chain = [bySeq.get(nodes[idx])];
  for (let guard = 0; guard < 20; guard += 1) {
    const current = chain[0];
    const op = current?.surfaceOp;
    if (op === undefined || op === 'append' || op.startSeq !== op.endSeq) break;
    const previous = bySeq.get(op.startSeq);
    if (previous === undefined) break;
    chain.unshift(previous);
  }

  const textOf = (event) => (Array.isArray(event?.data?.content) ? event.data.content : [])
    .filter((block) => block?.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('\n')
    .trim();
  return {
    versions: chain.map((event) => ({ seq: event.seq, text: textOf(event), time: event.time })),
    currentIndex: chain.length - 1
  };
}

/**
 * `/cyrene-edit-api` 的处理器。
 *
 *   GET  ?sessionId=...  → 最后一条用户消息的文本 + 能不能编辑
 *   POST { sessionId, text } → 用**表面替换**把「这条消息 + 它之后的所有表面节点」
 *                              换成一条改好的用户消息
 *
 * 为什么是替换而不是改文件：会话是 append-only 的事件日志（磁盘上是多帧 zstd），
 * 直接改日志会和内存里的投影、缓存脱同步。表面替换是 DSH 自己的机制：旧事件留在日志里，
 * 只是不再进入模型可见的历史 —— 这也让「编辑」天然可追溯（日志里能看到原话）。
 * @param req - 请求对象。
 * @param res - 响应对象。
 * @param sessions - `ctx.sessions` 服务（测试可注入假实现）。
 */
export async function handleEditApi(req, res, sessions) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET') {
      const sessionId = String(url.searchParams.get('session') || '');
      const session = sessions?.get?.(sessionId);
      if (session === undefined || session === null) {
        json(res, { ok: false, error: '找不到这个会话' }, 404);
        return;
      }
      const events = session.snapshotEvents(0, session.seq);
      const plan = planEdit(events);
      const chain = versionChain(events);
      json(res, plan.ok
        ? {
          ok: true,
          text: plan.text,
          canEdit: true,
          versions: chain.versions.map((version, index) => ({ ...version, current: index === chain.currentIndex })),
          currentIndex: chain.currentIndex
        }
        : {
          ok: true,
          text: '',
          canEdit: false,
          reason: plan.reason,
          versions: chain.versions.map((version, index) => ({ ...version, current: index === chain.currentIndex })),
          currentIndex: chain.currentIndex
        });
      return;
    }
    if (req.method !== 'POST') {
      json(res, { ok: false, error: '只支持 GET / POST' }, 405);
      return;
    }
    const raw = await readBody(req);
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      json(res, { ok: false, error: '请求体不是 JSON' }, 400);
      return;
    }
    const sessionId = String(payload.sessionId || '');

    // 切版本：把「最后一条用户消息」换回历史里的某一版（再 append 一次单节点替换）。
    if (payload.targetSeq !== undefined) {
      const session = sessions?.get?.(sessionId);
      if (session === undefined || session === null) {
        json(res, { ok: false, error: '找不到这个会话' }, 404);
        return;
      }
      const events = session.snapshotEvents(0, session.seq);
      const chain = versionChain(events);
      const targetIndex = chain.versions.findIndex((version) => version.seq === Number(payload.targetSeq));
      if (targetIndex === -1) {
        json(res, { ok: false, error: '这个版本不在最后一条消息的历史里' }, 409);
        return;
      }
      if (targetIndex === chain.currentIndex) {
        json(res, { ok: true, text: chain.versions[targetIndex].text, currentIndex: targetIndex });
        return;
      }
      const target = events.find((event) => event.seq === Number(payload.targetSeq));
      if (target === undefined) {
        json(res, { ok: false, error: '找不到这个版本' }, 409);
        return;
      }
      session.append('user/message', {
        id: randomUUID(),
        role: 'user',
        content: target.data.content,
        source: { ...(target.data.source ?? { kind: 'user' }) }
      }, {
        surfaceOp: {
          op: 'replace',
          startSeq: chain.versions[chain.currentIndex].seq,
          endSeq: chain.versions[chain.currentIndex].seq
        },
        sourceEventSeqs: [chain.versions[chain.currentIndex].seq]
      });
      json(res, { ok: true, text: chain.versions[targetIndex].text, currentIndex: targetIndex });
      return;
    }

    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    // keep（默认）= 只换这一条、后续回复保留；truncate = 连同后续一起撤回（改口重说）。
    const mode = payload.mode === 'truncate' ? 'truncate' : payload.mode === 'keep' || payload.mode === undefined ? 'keep' : '';
    if (mode === '') {
      json(res, { ok: false, error: "mode 只能是 keep / truncate" }, 400);
      return;
    }
    if (text === '') {
      json(res, { ok: false, error: '消息不能为空' }, 400);
      return;
    }
    if (text.length > 20000) {
      json(res, { ok: false, error: '消息太长了' }, 400);
      return;
    }
    const session = sessions?.get?.(sessionId);
    if (session === undefined || session === null) {
      json(res, { ok: false, error: '找不到这个会话' }, 404);
      return;
    }
    const plan = planEdit(session.snapshotEvents(0, session.seq));
    if (!plan.ok) {
      json(res, { ok: false, error: plan.reason }, 409);
      return;
    }
    // 新的用户消息：source 沿用原消息的（可能是 user，也可能带了别的标记字段）。
    const range = mode === 'truncate'
      ? { startSeq: plan.startSeq, endSeq: plan.endSeq, shadowed: plan.shadowed }
      : { startSeq: plan.singleStartSeq, endSeq: plan.singleEndSeq, shadowed: plan.singleShadowed };
    session.append('user/message', {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { ...(plan.source ?? { kind: 'user' }) }
    }, {
      surfaceOp: { op: 'replace', startSeq: range.startSeq, endSeq: range.endSeq },
      sourceEventSeqs: range.shadowed
    });
    json(res, { ok: true, text, mode, startSeq: range.startSeq, endSeq: range.endSeq });
  } catch (error) {
    json(res, { ok: false, error: String(error?.message ?? error) }, 400);
  }
}

/**
 * `/cyrene-scene-api` 的处理器：读 / 改「角色扮演模式」开关。
 *
 * 浏览器半边（client.js）碰不到主机文件系统，所以开关的读写走这个接口；
 * 真正存盘的是 scene.js 的 `writeState`，两边读的是同一个 `<DSH_HOME>/cyrene-scene.json`。
 * 导出是为了单测（不经过 webServer）。
 * @param req - 请求对象。
 * @param res - 响应对象。
 */
export async function handleSceneApi(req, res) {
  try {
    if (req.method === 'GET') {
      const state = readState();
      json(res, { ok: true, enabled: state.enabled, trailblazer: state.trailblazer, path: SCENE_STORE });
      return;
    }
    if (req.method !== 'POST') {
      json(res, { ok: false, error: '只支持 GET / POST' }, 405);
      return;
    }
    const raw = await readBody(req);
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      json(res, { ok: false, error: '请求体不是 JSON' }, 400);
      return;
    }
    // 两个开关（角色扮演模式 / 默认对方是开拓者），各自独立、都只接受真正的布尔值：
    // 设置界面传 "false" 这种字符串是 bug，不该被静默当成开。
    const patch = {};
    if (typeof payload.enabled === 'boolean') patch.enabled = payload.enabled;
    if (typeof payload.trailblazer === 'boolean') patch.trailblazer = payload.trailblazer;
    if (Object.keys(patch).length === 0) {
      json(res, { ok: false, error: 'enabled / trailblazer 至少给一个，且必须是 true / false' }, 400);
      return;
    }
    if (!writeState(patch)) {
      json(res, { ok: false, error: `写入 ${SCENE_STORE} 失败` }, 500);
      return;
    }
    const state = readState();
    json(res, { ok: true, enabled: state.enabled, trailblazer: state.trailblazer });
  } catch (error) {
    json(res, { ok: false, error: String(error?.message ?? error) }, 400);
  }
}

/**
 * 插件加载钩子。
 *
 * 两件事：记一行日志（方便确认 loader 读到了），以及在没有 webServer 的部署里
 * 静默跳过——设置界面靠这个接口，但缺了它不影响预设本身能跑。
 * @param ctx - 插件上下文。
 */
export function apply(ctx) {
  ctx?.logger?.info?.(
    '[dsh-cyrene] 已加载。若尚未安装预设，请运行 scripts/install.mjs --yes（或 install.sh --yes）：' +
      '0.1.x 会把预设落到 ~/.dsh/.agent-presets/，0.2.0+ 会写进 profile 的 cordis.patch.yml。'
  );

  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () => scope.webServer.register({ kind: 'exact', path: SCENE_API_PATH, handler: handleSceneApi }),
      'dsh-cyrene: /cyrene-scene-api'
    );
    scope.effect(
      () => scope.webServer.register({ kind: 'exact', path: UPDATE_API_PATH, handler: handleUpdateApi }),
      'dsh-cyrene: /cyrene-update-api'
    );
    scope.effect(
      () => scope.webServer.register({ kind: 'exact', path: STYLE_API_PATH, handler: handleStyleApi }),
      'dsh-cyrene: /cyrene-style-api'
    );
    scope.effect(
      () => scope.webServer.register({ kind: 'exact', path: NICKNAME_API_PATH, handler: handleNicknameApi }),
      'dsh-cyrene: /cyrene-nickname-api'
    );
    scope.effect(
      () => scope.webServer.register({
        kind: 'exact',
        path: EDIT_ICON_PATH,
        handler: (req, res) => {
          try {
            const body = readFileSync(EDIT_ICON_FILE);
            res.writeHead(200, {
              'Content-Type': 'image/png',
              'Cache-Control': 'public, max-age=86400'
            });
            res.end(body);
          } catch {
            res.writeHead(404).end();
          }
        }
      }),
      'dsh-cyrene: /cyrene-edit-icon.png'
    );
  });

  // 编辑「最后一条用户消息」：同时需要 webServer 与 sessions，缺一个就不挂（预设仍能跑）。
  ctx.inject(['webServer', 'sessions'], (scope) => {
    scope.effect(
      () => scope.webServer.register({
        kind: 'exact',
        path: EDIT_API_PATH,
        handler: (req, res) => handleEditApi(req, res, scope.sessions)
      }),
      'dsh-cyrene: /cyrene-edit-api'
    );
  });
}
