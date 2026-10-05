/**
 * worldbook/index.mjs —— 昔涟世界书的注入层（主机插件）。
 *
 * 由 `chat` 与 `cyrene-work` 两个预设**分别挂载**（挂的是本包在 profile 里的那个
 * 实例，不是包自己的 cordis.patch.yml），所以只作用于挂了它的那些预设的会话：
 * 内置的**标准模式**看不到。也因此不需要往 profile 的 package.json /
 * pnpm-lock.yaml 加依赖。
 *
 * ## 两条通道，按「需不需要本轮用户消息」拆开
 *
 * 这是本插件最关键的结构决定，是踩了坑才定下来的：
 *
 *   `assemble()`（dsh-agent-loop 第 889 行）跑在
 *   `session.append("user/message", …)`（第 1028 行）**之前**。
 *
 * 也就是：`systemPrompt.context()` / `variable()` 的 provider 被调用时，
 * **本轮用户消息还没写进会话**。读会话只能拿到**前几轮**内容 —— 新会话第一轮
 * 更是一条都没有，于是什么都匹配不到，而且**静默失效**（空文本的 section 会被
 * renderContextSections 直接过滤掉，快照里看不出任何异常）。
 *
 * 所以：
 *
 * | 块 | 需要本轮消息吗 | 走哪条通道 | 落库行为 |
 * |---|---|---|---|
 * | 常驻（内容恒定） | 不需要 | `systemPrompt.context()` | 内容不变 → 只落一次 |
 * | 命中（随语料变） | **需要** | `agent/pre-step` | 每轮追加一条，靠内容去重抑制累积 |
 *
 * 两个参考实现也是这么绕的：dsh-local-vector-memory 用 `agent/pre-step`
 * （本轮输入就是它的 `messages` 参数），dsh-universal-worldbook 用 `llm/stream`
 * （改写出站请求）。它们都不靠"读会话拿当前消息"，因为拿不到。
 *
 * ## 命中块为什么不用 llm/stream
 *
 * llm/stream 缓存更优（改尾部而非头部）、注入也不进会话；但实测
 * `options.messages` 是**冻结**的（原地 splice 抛 "Cannot add property N,
 * object is not extensible"），只能重建请求对象再重调 `llm.stream()` ——
 * 那等于从瀑布顶端重入，会让排在它前面的 llm/stream 处理器再跑一遍。
 * agent/pre-step 简单得多，代价是注入块会进会话历史（DSH 自己的运行时快照也是
 * 这么做的），所以下面用"内容相同就不重复注入"来抑制累积。
 *
 * ## 匹配只扫用户说过的话
 *
 * 不含 assistant 自己的回复 —— 否则她一提「迷迷」就激活「迷迷」条目、下一轮又提，
 * 自我回声。
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorldbookDirectory } from './parse.mjs';
import { buildCorpus, matchWorldbook, DEFAULT_MAX_ACTIVE } from './match.mjs';
import { assembleWorldbook } from './assemble.mjs';

/** 跟其它 dsha-* 插件一样认 DSH_HOME。 */
const HOME = process.env.DSH_HOME || join(process.env.HOME || '.', '.dsh');
/** 配置文件；不存在就用默认值。 */
const CONFIG_PATH = join(HOME, 'cyrene-worldbook.json');
/** 诊断日志。踩过一次"静默失效"，所以必须有文件级可观测性。 */
const LOG_PATH = join(HOME, 'cyrene-worldbook.log');
/**
 * 随包发运的世界书数据目录。
 *
 * 用 `import.meta.url` 相对本模块解析，而不是拼 DSH_HOME —— 这样无论包被装进
 * profile 的 node_modules，还是从仓库的绝对路径加载，都指向**同一份数据**，
 * 不会出现"两份数据各自漂移"。用户想换成自己的世界书时，用配置里的 dir 覆盖。
 */
const BUNDLED_DIR = fileURLToPath(new URL('./data/', import.meta.url));

/** 默认配置。 */
const DEFAULTS = Object.freeze({
  enabled: true,
  dir: BUNDLED_DIR,
  maxActive: DEFAULT_MAX_ACTIVE,
  /** 扫最近几条用户消息（D0 来自本轮，D1/D2 来自前几轮）。 */
  scanDepth: 3,
  /** 条目文件的缓存时长；改完世界书不用重启，等这么久即生效。 */
  cacheTtlMs: 30_000,
  /** 诊断日志开关。默认关；排障时在 <DSH_HOME>/cyrene-worldbook.json 里打开。 */
  trace: false
});

/**
 * 读配置。任何异常都退回默认值 —— 配置坏了不该让对话挂掉。
 * @returns 合并后的配置。
 */
function loadConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 追加一行诊断日志；整个吞掉异常。 */
function logLine(message) {
  try {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* 诊断永远不该影响主流程 */
  }
}

/**
 * 取一条消息里的纯文本。
 * @param message - 消息对象。
 * @returns 文本；非文本消息返回空串。
 */
function textOfMessage(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('\n');
}

/**
 * 判断是不是"真实用户消息"。
 *
 * `source.kind === 'user'` 这条很关键：它把插件注入的快照
 * （`source.kind === 'plugin'`）和工具产生的 user 角色消息排除掉，否则世界书会拿
 * 自己上一轮注入的内容当语料，自我强化。
 * @param message - 消息对象。
 * @returns 是否为真实用户消息。
 */
function isRealUser(message) {
  return message?.role === 'user' && message?.source?.kind === 'user';
}

/**
 * 从一串消息里取最后一条真实用户消息的文本。
 * @param messages - 消息数组。
 * @returns 文本；没有则空串。
 */
export function lastUserText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!isRealUser(messages[i])) continue;
    const text = textOfMessage(messages[i]).trim();
    if (text !== '') return text;
  }
  return '';
}

/**
 * 从会话事件里取最近若干条**真实用户消息**（新→旧）。
 *
 * 注意：这里拿不到本轮消息（装配早于 append），只用于 D1/D2 这类历史槽位。
 *
 * @param session - 会话对象。
 * @param depth - 取几条。
 * @returns 文本数组，新→旧。
 */
export function recentUserTexts(session, depth) {
  let events;
  try {
    events = session?.snapshotEvents?.();
  } catch {
    return [];
  }
  if (!Array.isArray(events)) return [];

  const out = [];
  for (let i = events.length - 1; i >= 0 && out.length < depth; i--) {
    const event = events[i];
    if (event?.type !== 'user/message') continue;
    if (event.data?.source?.kind !== 'user') continue;
    const text = textOfMessage(event.data).trim();
    if (text !== '') out.push(text);
  }
  return out;
}

/** 插件需要的服务。显式声明，跟 memory.js 保持一致。 */
export const inject = ['systemPrompt'];

/**
 * 注册世界书注入。
 * @param ctx - 主机插件上下文。
 */
export function apply(ctx) {
  const config = loadConfig();
  let cache = { at: 0, entries: [], error: null };

  /**
   * 会话 id → 上一轮注入的命中块文本，用于"内容相同就不重复注入"。
   *
   * **有界**：Map 保持插入顺序，超上限就淘汰最早的那个。没有这一步的话，一个长跑的
   * 进程里每来一个会话就多一条，只增不减。
   */
  const lastHit = new Map();
  /** 最多记多少个会话的去重状态。够用即可 —— 这只是抑制重复注入的优化，丢了不致命。 */
  const MAX_TRACKED_SESSIONS = 64;

  /**
   * 记一次注入去重状态，必要时淘汰最旧的会话。
   * @param sessionId - 会话 id。
   * @param text - 本轮注入的文本。
   */
  function trackHit(sessionId, text) {
    lastHit.delete(sessionId); // 重新插入以刷新 LRU 位置
    lastHit.set(sessionId, text);
    while (lastHit.size > MAX_TRACKED_SESSIONS) {
      const oldest = lastHit.keys().next();
      if (oldest.done === true) break;
      lastHit.delete(oldest.value);
    }
  }

  /**
   * 取世界书条目，带 TTL 缓存。读盘或解析失败时退回上一次结果，否则空数组 ——
   * 世界书读不到只是不注入，绝不能让装配抛错。
   * @returns 条目数组。
   */
  function entries() {
    const now = Date.now();
    if (now - cache.at < config.cacheTtlMs) return cache.entries;
    try {
      const list = loadWorldbookDirectory(config.dir);
      cache = { at: now, entries: list, error: null };
      if (config.trace) logLine(`已载入条目 ${list.length} 条（dir=${config.dir}）`);
    } catch (error) {
      cache = { at: now, entries: cache.entries, error: String(error?.message ?? error) };
      if (config.trace) logLine(`读取世界书失败：${cache.error}`);
    }
    return cache.entries;
  }

  /**
   * 常驻块。不依赖本轮消息、内容恒定 —— 走 context()，只落库一次。
   * 空结果必须返回空串（返回 undefined 会让装配失败）。
   * @returns 注入文本或空串。
   */
  function staticText() {
    if (!config.enabled) return '';
    try {
      const list = entries();
      if (list.length === 0) return '';
      const permanent = list
        .filter((entry) => entry.constant)
        .map((entry) => ({ entry, reason: 'constant', matchedKeys: [], matchedSlots: [] }));
      return assembleWorldbook({ permanent, primary: [], chained: [] }, config.assemble).text;
    } catch (error) {
      if (config.trace) logLine(`常驻块失败：${String(error?.message ?? error)}`);
      return '';
    }
  }

  /**
   * 命中块。需要本轮用户消息 —— 由 agent/pre-step 作为参数传进来。
   * @param messages - 本轮 claimed 消息。
   * @param session - 会话对象（用于取 D1/D2）。
   * @returns 注入文本或空串。
   */
  function hitText(messages, session) {
    if (!config.enabled) return '';
    try {
      const list = entries();
      if (list.length === 0) {
        if (config.trace) logLine('命中块跳过：条目为 0');
        return '';
      }
      const userText = lastUserText(messages);
      if (userText === '') {
        const count = Array.isArray(messages) ? messages.length : '?';
        if (config.trace) logLine(`命中块跳过：本轮没有真实用户消息（messages=${count} 条）`);
        return '';
      }
      const depth = Math.max(1, Number(config.scanDepth) || 3);
      const previousTexts = recentUserTexts(session, depth - 1);
      const matched = matchWorldbook(
        list,
        buildCorpus({ userText, previousTexts }),
        { maxActive: config.maxActive, scanDepth: depth }
      );
      const built = assembleWorldbook(
        { permanent: [], primary: matched.primary, chained: matched.chained },
        config.assemble
      );
      if (config.trace) {
        logLine(
          `命中块：常驻 ${matched.permanent.length}｜命中 ${matched.primary.length}`
          + `｜连带 ${matched.chained.length}｜被上限截掉 ${matched.diagnostics.length}`
          + `｜产出 ${built.chars} 字符`
        );
      }
      return built.text;
    } catch (error) {
      // 流水线期抛错会打掉整轮对话，所以这里必须兜住。
      if (config.trace) logLine(`命中块失败：${String(error?.message ?? error)}`);
      return '';
    }
  }

  // ── 常驻块：不需要本轮消息，走 context() ──
  ctx.systemPrompt.context({
    name: 'cyrene:worldbook-static',
    // 排在策略类 context（110/115/120）之后，便于在快照里辨认。
    order: 140,
    text: () => staticText()
  });

  // ── 命中块：必须走 agent/pre-step（本轮消息是它的参数，读会话拿不到）──
  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      const decision = await next();
      if (decision?.kind !== 'enter') return decision;

      const session = payload?.agent?.session;
      const sessionId = String(session?.id ?? payload?.agent?.id ?? '');
      const text = hitText(payload?.messages, session);
      if (text === '') return decision;

      // 内容没变就不重复注入 —— 否则同一话题连着聊几轮，同样的块会被塞进历史好几遍。
      if (sessionId !== '' && lastHit.get(sessionId) === text) {
        if (config.trace) logLine('命中块跳过：与上一轮完全相同');
        return decision;
      }
      if (sessionId !== '') trackHit(sessionId, text);

      // 手写描述符，不 import @deepseek-ai/dsh-llm / dsh-tools ——
      // 那类包在 link 安装下解析不到（ERR_MODULE_NOT_FOUND），
      // 而 npm 上的版本（0.0.1-rc.1）又跟运行时对不上。
      //
      // ⚠️ `id` **必须自己生成，不能省**。
      //
      // DSH 自己的消息都走 `createMessage()`，它内部会赋
      // `id: randomUUID()`；而这里是手写的描述符，绕过了那个工厂。
      // 没有 id 的 user/message 会被原样写进会话事件，之后**历史加载直接失败**：
      //
      //   session event at seq N lacks an identified message
      //   （dsh-session 的 assertMessageEventShape 要求消息类事件的 id 是非空字符串）
      //
      // 表现是那个会话再也打不开 —— 排查时只看到"历史加载失败"，看不出跟本插件有关。
      // 这个坑真踩过：3 个会话因此损坏，每条只差这一个字段。
      const marker = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'dsh-cyrene/worldbook', form: 'snapshot' }
      };
      return { kind: 'enter', messages: [...decision.messages, marker] };
    },
    { prepend: true }
  );

  // ⚠️ 这里**绝对不能** ctx.provide()。
  //
  // dsh-agent-presets 挂载预设后会做 leakedServices 校验：预设 fiber 内发布、
  // 并落进根 isolate realm 的服务会被判为"污染进程全局"，直接抛错让**整个预设
  // 挂载失败** —— 表现是「纯文本对话模式」不可用，连新建会话都会出问题。
  // 真要发布服务，得用 isolate realm，或把插件搬到 host composition（profile 级）。

  if (config.trace) logLine(`apply 完成｜dir=${config.dir}（条目缓存待首次装配时载入）`);
}
