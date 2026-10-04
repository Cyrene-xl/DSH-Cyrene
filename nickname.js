/**
 * dsh-cyrene-chat / nickname.js —— 「纯文本对话模式」里的称呼变量 `{{user_nickname}}`。
 *
 * 预设正文会写「用户的昵称是「{{user_nickname}}」……」。DSH 的 dsh-system-prompt
 * 只注册 provider / model / cwd 三个变量，引用未注册的变量会在**装配期直接抛错**
 * ——不是预设加载失败，而是之后每一轮对话都报错。所以这个变量必须由随包插件自己
 * 兜住，否则别人单独装本包会得到一个发不出话的对话模式。
 *
 * 为什么不干脆把预设里的变量改成字面称呼：
 *   可配置的称呼是有用的，而且改字面会让「用户改了称呼」这件事静默失效。
 *
 * 为什么挂在预设里（而不是本包的 cordis.patch.yml 里）：
 *   `systemPrompt.variable()` 注册进调用作用域，而**同名的 scoped 注册会遮蔽全局注册**
 *   （dsh-system-prompt 装配时先铺全局、再按作用域层覆盖），且不会判定为重名冲突。
 *   于是：单独装本包时，这里提供默认值；若同时还装了别的昵称插件（它注册的是全局），
 *   这里会遮蔽它——所以下面去读它们惯用的那个配置文件，保证读出来是同一个值。
 *
 * 记忆相关的东西在 memory.js，跟这里分开，各自单一职责。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 认 DSH_HOME，跟预设安装位置同源。 */
const HOME = process.env.DSH_HOME || join(process.env.HOME || '.', '.dsh');
/**
 * 昵称插件的惯用存储位置。存在就沿用它的值，这样「在别处改过称呼」不会失效。
 * 这只是个软读取：文件不在、坏了、内容非法，都退回默认值。
 */
const EXTERNAL_STORE = join(HOME, 'dsha-brand-rename.json');
/** 没设置过时的默认称呼。 */
const DEFAULT_NICKNAME = '伙伴';
/** 昵称最长多少字符：太长会撑变形提示词，也更容易被当成指令。 */
const MAX_LENGTH = 24;

export const inject = ['systemPrompt'];

/**
 * 清洗昵称。它最终会拼进系统提示词，所以不能带换行、花括号或控制字符
 * —— 否则等于让一个配置文件能往提示词里插任意指令。
 * @param value - 原始输入。
 * @returns 可安全放进提示词的昵称；非法时返回空串。
 */
function sanitize(value) {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return cleaned === '' ? '' : cleaned.slice(0, MAX_LENGTH);
}

/**
 * 读称呼：优先沿用昵称插件的设置，否则用默认值。
 * 整个过程绝不抛错 —— 装配期抛错会打掉整轮对话。
 * @returns 当前称呼。
 */
function loadNickname() {
  try {
    if (existsSync(EXTERNAL_STORE)) {
      const value = sanitize(JSON.parse(readFileSync(EXTERNAL_STORE, 'utf8'))?.nickname);
      if (value !== '') return value;
    }
  } catch {
    /* 没文件、坏文件、非法内容，都走默认值 */
  }
  return DEFAULT_NICKNAME;
}

/**
 * 注册称呼变量。
 * @param ctx - 主机插件上下文（已 inject systemPrompt）。
 */
export function apply(ctx) {
  // provider 每轮装配现取，所以改了称呼下一轮就生效，不用重启、不用新建会话。
  ctx.systemPrompt.variable('user_nickname', () => loadNickname());
}
