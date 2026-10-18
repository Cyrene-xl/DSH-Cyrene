/**
 * dsh-cyrene / nickname.js —— 「纯文本对话模式」里的称呼变量 `{{user_nickname}}`。
 *
 * 预设正文会写「用户的昵称是「{{user_nickname}}」……」。DSH 的 dsh-system-prompt
 * 只注册 provider / model / cwd 三个变量，引用未注册的变量会在**装配期直接抛错**
 * ——不是预设加载失败，而是之后每一轮对话都报错。所以这个变量必须由随包插件自己
 * 兜住，否则别人单独装本包会得到一个发不出话的对话模式。
 *
 * ## 称呼是**动态**的，两条入口
 *
 * 1. **设置里的自定义名称**：读 `<DSH_HOME>/dsha-brand-rename.json` 的 `nickname`
 *    （那是昵称插件惯用的存储位置）。provider 每轮装配现取，所以设置里改完下一轮就生效。
 * 2. **对话中改口**：两种说法都支持 ——
 *    - **显式**（「以后叫我小明」「称呼改成老师」）：`agent/pre-step` 里直接解析并落盘，
 *      不依赖模型的自觉；本轮装配就会用新名字；
 *    - **暗示**（「我们之间还用这么生分吗」）：模型自己判断后调用 `set_nickname` 工具。
 *
 * 两条入口写同一个文件，所以「设置」与「对话」不会各记一套。
 *
 * 为什么挂在预设里（而不是本包的 cordis.patch.yml 里）：
 *   `systemPrompt.variable()` 注册进调用作用域，而**同名的 scoped 注册会遮蔽全局注册**
 *   （dsh-system-prompt 装配时先铺全局、再按作用域层覆盖），且不会判定为重名冲突。
 *   于是：单独装本包时，这里提供默认值；若同时还装了别的昵称插件（它注册的是全局），
 *   这里会遮蔽它——所以下面去读它们惯用的那个配置文件，保证读出来是同一个值。
 *
 * 记忆相关的东西在 memory.js，跟这里分开，各自单一职责。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 认 DSH_HOME，跟预设安装位置同源。 */
const HOME = process.env.DSH_HOME || join(process.env.HOME || '.', '.dsh')
/**
 * 称呼的存储位置。**与昵称插件共用同一个文件**：存在就沿用它的值，
 * 这样「在别处改过称呼」不会失效，我们写进去它也读得到。
 */
const EXTERNAL_STORE = join(HOME, 'dsha-brand-rename.json')
/** 没设置过时的默认称呼。 */
export const DEFAULT_NICKNAME = '伙伴'
/** 称呼最长多少字符：太长会撑变形提示词，也更容易被当成指令。 */
const MAX_LENGTH = 24

export const inject = ['systemPrompt']

/**
 * 清洗称呼。它最终会拼进系统提示词，所以不能带换行、花括号或控制字符
 * —— 否则等于让一个配置文件能往提示词里插任意指令。
 * @param value - 原始输入。
 * @returns 可安全放进提示词的称呼；非法时返回空串。
 */
export function sanitize(value) {
  if (typeof value !== 'string') return ''
  const cleaned = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  return cleaned === '' ? '' : cleaned.slice(0, MAX_LENGTH)
}

/**
 * 读称呼：优先沿用昵称插件的设置，否则用默认值。
 * 整个过程绝不抛错 —— 装配期抛错会打掉整轮对话。
 * @returns 当前称呼。
 */
export function loadNickname() {
  try {
    if (existsSync(EXTERNAL_STORE)) {
      const value = sanitize(JSON.parse(readFileSync(EXTERNAL_STORE, 'utf8'))?.nickname)
      if (value !== '') return value
    }
  } catch {
    /* 没文件、坏文件、非法内容，都走默认值 */
  }
  return DEFAULT_NICKNAME
}

/**
 * 写称呼。**读-改-写**：那个文件里可能还有别的字段（昵称插件自己的），不能整份覆盖。
 * @param value - 新称呼（内部会再清洗一次）。
 * @returns 写入后的称呼；非法或写失败返回空串。
 */
export function saveNickname(value) {
  const name = sanitize(value)
  if (name === '') return ''
  let current = {}
  try {
    if (existsSync(EXTERNAL_STORE)) {
      const parsed = JSON.parse(readFileSync(EXTERNAL_STORE, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed
    }
  } catch {
    /* 坏文件就当空的，下面重建 */
  }
  try {
    writeFileSync(EXTERNAL_STORE, `${JSON.stringify({ ...current, nickname: name }, null, 2)}\n`, 'utf8')
    return name
  } catch {
    return ''
  }
}

/** 捕获到的候选词里出现这些，说明多半是在问「叫什么」而不是给名字。 */
const NOT_A_NAME = new Set(['什么', '啥', '谁', '哪个', '名字', '一声', '一下'])
/** 句尾的语气词 / 标点，从候选名字上剥掉。 */
const TAIL_NOISE = /[吧呀啊哦嘛呢啦哈咯～~\s了。．.!！?？,，、;；:：]+$/u

/**
 * 从用户这句话里解析**显式**的改口请求。
 *
 * 只认明确说法（「以后叫我小明」「称呼改成老师」）；模糊的（「还用这么生分吗」）
 * 交给模型判断后调工具。否定句（「别再叫我先生」）一律不解析 —— 它没有给出新名字，
 * 该由模型自己决定是换称呼还是恢复默认。
 * @param text - 用户这一轮说的话。
 * @returns 新称呼；没有明确请求返回空串。
 */
export function extractNicknameRequest(text) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (source === '') return ''
  // 否定句先排除：「别再叫我先生」不是在给新名字
  if (/(?:别|不要|不用|甭)(?:再)?\s*(?:叫我|喊我|称呼我)/.test(source)) return ''

  const patterns = [
    // 以后叫我小明 / 就叫我小明吧 / 喊我一声老师
    /(?:以后|往后|从现在(?:起|开始)|从今天(?:起|开始))?\s*(?:就)?(?:叫我|喊我|称呼我|管我叫)\s*[「『"'“]?([^」』"'”\s，。！？,.!?；;：:（()）]{1,12})/u,
    // 把称呼改成 X / 昵称换成 X
    /(?:把|将)?(?:对我的)?(?:称呼|昵称)(?:改成|换成|改为|换为|叫成)\s*[「『"'“]?([^」』"'”\s，。！？,.!?；;：:（()）]{1,12})/u,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(source)
    if (!match) continue
    // 「喊我一声老师」这种中间会带量词，先剥掉再判
    const name = match[1].trim().replace(TAIL_NOISE, '').replace(/^(?:一声|一下)/u, '').trim()
    if (name === '' || NOT_A_NAME.has(name)) continue
    if (/[什么啥谁吗呢]/u.test(name)) continue
    const clean = sanitize(name)
    if (clean !== '') return clean
  }
  return ''
}

/**
 * 取本轮最后一条**真实用户消息**（插件自己注入的标记要排除）。
 * @param messages - pre-step 收到的本轮消息数组。
 * @returns 文本；没有则空串。
 */
function latestUserText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== 'user' || message?.source?.kind !== 'user') continue
    const text = (Array.isArray(message.content) ? message.content : [])
      .filter((block) => block?.type === 'text')
      .map((block) => String(block.text ?? ''))
      .join('\n')
      .trim()
    if (text !== '') return text
  }
  return ''
}

/**
 * 注入给模型的「称呼规则」。**运行时上下文**，每轮现取，所以名字改了立刻反映。
 *
 * 为什么要单独写这条：光有一个「当前称呼是 X」的变量，模型只会一直用 X ——
 * 用户用关系称呼暗示（求婚后那句「老婆？」）时，它不会主动推回去。这里把两件事说明白：
 * 关系称呼要**推回对应的那个**，以及改口之后要落盘（调工具）。
 * @returns 规则文本。
 */
export function nicknameContext() {
  return [
    '【称呼】',
    `你现在称呼对方为「${loadNickname()}」。这个称呼会随关系变化：`,
    '- 对方用**关系称呼**暗示时（例如求婚/婚礼之后叫你「老婆」「老公」「亲爱的」，',
    '  或者说「是不是该改口了」「那个啦」），把称呼换成**对应的那一个**：',
    '  他叫你「老婆」，你就叫他「老公」；他叫你「老公」，你就叫他「老婆」。',
    '  换完当轮就用新称呼，不要再去问「那我该叫你什么」。',
    '- 对方**明确**要求改口（「以后叫我 ××」「称呼改成 ××」）时，直接用新称呼。',
    '- 称呼只在对方愿意的前提下变；对方没往这个方向走，就别自己往关系上推。'
  ].join('\n')
}

/**
 * 造一个「一个字符串参数、返回一段文本」的工具描述符（与 memory.js 同款）。
 * @param input - `{ name, description, parameter, parameterDescription, run }`
 * @returns 工具描述符。
 */
function stringTool({ name, description, parameter, parameterDescription, run }) {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: {
        [parameter]: { type: 'string', description: parameterDescription }
      },
      required: [parameter]
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }]
    },
    execute: (args) => run(args[parameter])
  }
}

/**
 * 设置称呼的工具：处理「暗示」类请求（模型自己判断该叫什么）。
 * @param value - 新称呼。
 * @returns 结果文本。
 */
function setNicknameTool(value) {
  const name = saveNickname(value)
  if (name === '') return '称呼没有改成功：名字不能为空，也不能带换行或花括号。'
  return `称呼已改为「${name}」。从这个称呼开始，之后都这么叫。`
}

/**
 * 注册称呼变量、改口工具，以及「显式改口」的解析。
 * @param ctx - 主机插件上下文（已 inject systemPrompt）。
 * @param config - 可选 `trace`。
 */
export function apply(ctx, config = {}) {
  // 读侧：每轮装配现取 —— 设置里改、对话里改，下一轮都生效。
  ctx.systemPrompt.variable('user_nickname', () => loadNickname())

  // 称呼规则：排在风格（130）与常驻世界书（140）之前，紧跟在人设之后进入上下文。
  ctx.systemPrompt.context({
    name: 'cyrene:nickname',
    order: 120,
    text: () => nicknameContext()
  })

  // 写侧 ①：显式说法直接落盘，不依赖模型自觉。
  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      const decision = await next()
      if (decision?.kind !== 'enter') return decision
      const text = latestUserText(payload?.messages)
      if (text === '') return decision
      const wanted = extractNicknameRequest(text)
      if (wanted === '') return decision
      const before = loadNickname()
      if (wanted === before) return decision
      const saved = saveNickname(wanted)
      if (config.trace) {
        console.log(`[cyrene-nickname] 显式改口：${before} → ${saved || '(写入失败)'}`)
      }
      // 不追加消息：变量在装配期现取，本轮就会带上新名字。
      return decision
    },
    { prepend: true }
  )

  // 写侧 ②：暗示类请求交给模型判断（没有 tools 服务时只读，不影响变量）。
  ctx.inject(['tools'], (scope) => {
    scope.tools.register(
      stringTool({
        name: 'set_nickname',
        description:
          '更改你称呼对方的方式。当对方明确要求改口（「以后叫我老师」），'
          + '用暗示表达希望被换一种称呼（「我们之间还用这么生分吗」），'
          + '或用**关系称呼**暗示关系已经变化（求婚后叫你「老婆」/「老公」，'
          + '意思是让你反过来叫她/他对应的那个）时使用。'
          + '只在确实要改的时候调用，不要因为一句玩笑就改；改完当轮就用新称呼。',
        parameter: 'name',
        parameterDescription: '新称呼，例如「老师」「小明」',
        run: setNicknameTool
      })
    )
  })
}
