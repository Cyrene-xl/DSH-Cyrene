/**
 * dsh-cyrene-chat / memory.js —— 「纯文本对话模式」的长期记忆。
 *
 * 这个文件**由预设挂载**（预设里写 `dsh-cyrene-chat/memory`），不由本包的
 * cordis.patch.yml 挂载。差别很实际：挂在预设里，它的提示词变量和工具就只落在
 * 会话自己的作用域，工作模式完全看不到，也拿不到这两个工具。
 *
 * 为什么必须走 `{{变量}}`，而不是运行时上下文快照：
 *   本预设是 `complete: true` + `includeRuntimeContext: false`。
 *   前者会把全部 prompt section 换成只剩人设那一段，后者会把全部 context 清空
 *   （dsh-system-prompt 组装时的 `contexts: runtimeContextSuppressed ? [] : …`）。
 *   变量插值发生在**人设那一段文本内部**，是这两把刀都砍不到的地方。
 *
 * 为什么这里不 import `@deepseek-ai/dsh-tools` 的 defineTool：
 *   本文件被解析时，Node 会从**它的真实路径**往上找 node_modules。用户是把它装在
 *   profile 里的，一路往上能碰到 <DSH_HOME>/node_modules/@deepseek-ai；但开发时
 *   用 `link:` 装的话真实路径落在仓库目录，那里往上没有 @deepseek-ai，就会
 *   ERR_MODULE_NOT_FOUND。而 npm 上的 @deepseek-ai/dsh-tools 只有 0.0.1-rc.1，
 *   跟运行时版本对不上，不能当依赖声明。所以干脆不依赖：defineTool 做的事只是把
 *   参数 DSL 翻成 JSON Schema，这里直接写描述符，交给 tools.register 校验。
 *
 * 记忆故意做成「纯文本、人可手改」：文件就是唯一真相，改它就是改记忆，
 * 删它就是真忘掉，本插件不会另存一份、也不会偷偷回写。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** 记忆文件位置：跟预设安装位置同源，都认 DSH_HOME。 */
const HOME = process.env.DSH_HOME || `${process.env.HOME || '.'}/.dsh`;
/** 记忆本体。纯 markdown，一行一条 `- 内容`，也允许自由写小标题和说明。 */
const STORE = `${HOME}/cyrene-memory.md`;
/** 注入上限。记忆再长也不该吃掉对话空间，超了按行截断。 */
const MAX_INJECT_CHARS = 2000;
/** 超过这个条数就在写入结果里提醒一句（只提醒，不阻止写入，免得丢数据）。 */
const SOFT_ENTRY_LIMIT = 120;

/**
 * 需要的服务。`systemPrompt` 必须声明才能访问（Cordis 规则）。
 * `tools` 故意不在这里声明 —— 它在下面用 scoped inject 可选挂载。
 * 这样即使某个部署没有 tools 服务，也只是没有写入工具，而不会整个插件激活失败
 * （预设里的插件激活失败会导致整个预设挂载失败，代价太大）。
 */
export const inject = ['systemPrompt'];

/** 读记忆文件；不存在或读不了都当空。 */
function readStore() {
  try {
    return existsSync(STORE) ? readFileSync(STORE, 'utf8') : '';
  } catch {
    return '';
  }
}

/** 写记忆文件。 */
function writeStore(text) {
  writeFileSync(STORE, text, 'utf8');
}

/** 数一数有几条 `- ` 开头的记忆。 */
function countEntries(text) {
  return text.split('\n').filter((line) => line.trimStart().startsWith('- ')).length;
}

/**
 * 生成注入人设的文本。
 * 空记忆必须返回空串而不是 undefined —— 引用到未定义值的段落会让整次装配失败。
 */
function injectText() {
  const body = readStore().trim();
  if (body === '') return '';
  if (body.length <= MAX_INJECT_CHARS) return body;
  const cut = body.slice(0, MAX_INJECT_CHARS);
  const at = cut.lastIndexOf('\n');
  return `${at > 0 ? cut.slice(0, at) : cut}\n\n（记忆较长，这里只显示了较早的一部分。）`;
}

/** 追加一条记忆；已存在的原样内容不重复添加。 */
function remember(text) {
  const clean = String(text ?? '').trim();
  if (clean === '') return '内容为空，没有写入。';
  const line = `- ${clean}`;
  const current = readStore();
  if (current.split('\n').some((existing) => existing.trim() === line)) {
    return `「${clean}」已经在记忆里了，没有重复添加。`;
  }
  const trimmed = current.replace(/\s*$/, '');
  writeStore(trimmed === '' ? `${line}\n` : `${trimmed}\n${line}\n`);
  const total = countEntries(readStore());
  if (total > SOFT_ENTRY_LIMIT) {
    return `已记住：${clean}（记忆已有 ${total} 条，偏多了，可以用 forget 清掉过时的。）`;
  }
  return `已记住：${clean}`;
}

/** 按关键词忘掉记忆：任何包含该关键词的行都会被删掉。 */
function forget(keyword) {
  const key = String(keyword ?? '').trim();
  if (key === '') return '关键词为空，没有改动。';
  const lines = readStore().split('\n');
  const kept = lines.filter((line) => !line.includes(key));
  const removed = lines.length - kept.length;
  if (removed === 0) return `记忆里没有包含「${key}」的内容。`;
  writeStore(kept.join('\n').replace(/^\n+/, ''));
  return `已忘掉 ${removed} 条包含「${key}」的记忆。`;
}

/**
 * 造一个「一个字符串参数、返回一段文本」的工具描述符。
 *
 * 形状是照着 dsh-tools 的 defineTool 产出物写的（parameters 是 JSON Schema，
 * output 必须有 schema 和 render），由 tools.register 负责校验。
 */
function stringTool({ name, description, parameter, parameterDescription, run }) {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: {
        [parameter]: { type: 'string', description: parameterDescription },
      },
      required: [parameter],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: (args) => run(args[parameter]),
  };
}

/**
 * 注册记忆变量，并按需挂上读写工具。
 * @param ctx - 主机插件上下文（已 inject systemPrompt）。
 */
export function apply(ctx) {
  // 读侧：人设里的 {{cyrene_memory}} 每轮现取，所以写完立刻对下一轮生效。
  ctx.systemPrompt.variable('cyrene_memory', () => injectText());

  // 写侧：可选挂载 —— 没有 tools 服务时插件照样能用，只是只读。
  ctx.inject(['tools'], (scope) => {
    scope.tools.register(
      stringTool({
        name: 'remember',
        description:
          '把一条关于对方的长期信息写进你自己的长期记忆，跨会话保留。'
          + '只在对方明确说「记住」、或主动告诉你一件明显的长期事实时使用。'
          + '不要记录一次性的、临时的、当轮就过期的内容。一次只记一件事，用一句话写。',
        parameter: 'text',
        parameterDescription: '要记住的那件事，一句话',
        run: remember,
      }),
    );
    scope.tools.register(
      stringTool({
        name: 'forget',
        description:
          '从你的长期记忆里删掉内容包含某关键词的条目。'
          + '在对方明确说「忘掉」「别记着」某件事时使用。',
        parameter: 'keyword',
        parameterDescription: '要忘掉的内容里包含的关键词',
        run: forget,
      }),
    );
  });
}
