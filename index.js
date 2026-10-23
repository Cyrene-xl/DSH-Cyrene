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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SCENE_STORE, readState, writeState } from './scene.js';
import { DEFAULT_NICKNAME, loadProfile, sanitize, saveField } from './nickname.js';

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

/**
 * 插件加载钩子。
 *
 * 只记录一行日志，便于用户确认插件已被 loader 读到。
 * 本文件不做任何文件写入、不注册工具、不改动系统提示词——
 * 预设的生效完全由 DSH 自身对 ~/.dsh/.agent-presets/ 的发现机制负责。
 */
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
      json(res, { ok: true, enabled: readState().enabled, path: SCENE_STORE });
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
    // 只接受真正的布尔值：设置界面传 "false" 这种字符串是 bug，不该被静默当成开。
    if (typeof payload.enabled !== 'boolean') {
      json(res, { ok: false, error: 'enabled 必须是 true / false' }, 400);
      return;
    }
    if (!writeState({ enabled: payload.enabled })) {
      json(res, { ok: false, error: `写入 ${SCENE_STORE} 失败` }, 500);
      return;
    }
    json(res, { ok: true, enabled: payload.enabled });
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
    '[dsh-cyrene] 已加载。若尚未安装预设，请运行 scripts/install.sh（或 install.ps1 / install.bat）：' +
      'DSH 没有公开的预设安装 API，预设必须落到 ~/.dsh/.agent-presets/chat/ 才会被发现。'
  );

  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () => scope.webServer.register({ kind: 'exact', path: SCENE_API_PATH, handler: handleSceneApi }),
      'dsh-cyrene: /cyrene-scene-api'
    );
    scope.effect(
      () => scope.webServer.register({ kind: 'exact', path: NICKNAME_API_PATH, handler: handleNicknameApi }),
      'dsh-cyrene: /cyrene-nickname-api'
    );
  });
}
