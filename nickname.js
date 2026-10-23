/**
 * dsh-cyrene / nickname.js —— 「纯文本对话模式」里的称呼（`{{user_nickname}}` + 每轮规则）。
 *
 * 预设正文引用 `{{user_nickname}}`。DSH 的 dsh-system-prompt 只注册 provider / model /
 * cwd 三个变量，引用未注册的变量会在**装配期直接抛错** —— 不是预设加载失败，而是之后
 * 每一轮对话都报错。所以这个变量必须由随包插件兜住。
 *
 * ## 两个字段，一个称呼（对齐上游 Cyrene-Agent）
 *
 * 上游把「名字」和「怎么叫」分开存（`UserProfile.nickname` / `UserProfile.callPreference`），
 * 注入时 `callPreference` **优先**于 `nickname`，都没有就退回默认的「伙伴」。这里照做：
 *
 *     dsha-brand-rename.json
 *     {
 *       "nickname": "小明",          ← 名字（昵称插件的设置面板写这个）
 *       "callPreference": "老师",    ← 称呼偏好：她想怎么叫你就用它，优先于昵称
 *       ...其它插件自己的字段（读-改-写，不碰）
 *     }
 *
 * `{{user_nickname}}` 注入的是**生效称呼**：`callPreference || nickname || 伙伴`。
 * 之所以仍叫这个名字，是因为预设正文（含上游 soul.md 原文）引用的就是它，改名等于改正文。
 *
 * ## 称呼是**动态**的，两条入口
 *
 * 1. **设置里改**：读同一个文件；provider 每轮现取，改完下一轮生效。
 *    设置页那一行由本包浏览器半边（client.js）+ `/cyrene-nickname-api` 提供。
 * 2. **对话中改口**：显式说法（「以后叫我小明」）在 `agent/pre-step` 里直接解析并落盘，
 *    不依赖模型自觉；暗示（「我们之间还用这么生分吗」）交给模型调 `set_address` 工具。
 *
 * 显式说法会分流到两个字段：「昵称换成 X / 我名字是 X」写 `nickname`；
 * 「叫我 X / 称呼改成 X」写 `callPreference`（上游把后者归到 preferredName）。
 *
 * ## 为什么挂在预设里而不是 cordis.patch.yml
 *
 *   `systemPrompt.variable()` 注册进调用作用域，而**同名的 scoped 注册会遮蔽全局注册**，
 *   且不会被判定为重名冲突。于是单独装本包时这里提供默认值；若同时装了别的昵称插件
 *   （它注册全局），这里会遮蔽它 —— 所以去读它们惯用的那个配置文件，保证读到同一个值。
 *
 * 记忆相关的东西在 memory.js，跟这里分开，各自单一职责。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 认 DSH_HOME，跟预设安装位置同源。 */
const HOME = process.env.DSH_HOME || join(process.env.HOME || '.', '.dsh')
/** 称呼的存储位置。**与昵称插件共用同一个文件**（读-改-写，不冲掉它的字段）。 */
const STORE = join(HOME, 'dsha-brand-rename.json')
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
 * 读整个状态文件。坏文件 / 数组 / 不存在都当成空对象 —— 装配期抛错会打掉整轮对话。
 * @returns 原始字段对象。
 */
function readStore() {
  try {
    if (!existsSync(STORE)) return {}
    const parsed = JSON.parse(readFileSync(STORE, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    /* 坏文件按空的处理 */
  }
  return {}
}

/**
 * 读称呼配置。
 * @returns `{ nickname, callPreference, address }`（都清洗过；address 已含默认值）。
 */
export function loadProfile() {
  const raw = readStore()
  const nickname = sanitize(raw.nickname)
  const callPreference = sanitize(raw.callPreference)
  return {
    nickname,
    callPreference,
    // 上游的优先级：称呼偏好 > 昵称 > 默认
    address: callPreference || nickname || DEFAULT_NICKNAME
  }
}

/**
 * 当前生效的称呼（`callPreference || nickname || 伙伴`）。
 * @returns 称呼。
 */
export function loadNickname() {
  return loadProfile().address
}

/**
 * 写一个字段。**读-改-写**：文件里可能还有别的字段（昵称插件自己的），不能整份覆盖。
 * 空字符串表示清除该字段（回落到另一个 / 默认称呼）。
 * @param field - `'nickname'` 或 `'callPreference'`。
 * @param value - 新值（内部会再清洗一次）。
 * @returns 写入后的**生效称呼**；失败返回空串。
 */
export function saveField(field, value) {
  if (field !== 'nickname' && field !== 'callPreference') return ''
  const clean = sanitize(value)
  const next = { ...readStore() }
  if (clean === '') delete next[field]
  else next[field] = clean
  try {
    writeFileSync(STORE, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return loadProfile().address
  } catch {
    return ''
  }
}

/**
 * 写昵称（名字）。保留这个函数名，因为「昵称」是它最自然的叫法。
 * @param value - 新昵称。
 * @returns 生效称呼；失败返回空串。
 */
export function saveNickname(value) {
  return saveField('nickname', value)
}

/**
 * 写称呼偏好（怎么叫她称呼你）。优先于昵称。
 * @param value - 新称呼偏好。
 * @returns 生效称呼；失败返回空串。
 */
export function saveCallPreference(value) {
  return saveField('callPreference', value)
}

/** 捕获到的候选词里出现这些，说明多半是在问「叫什么」而不是给名字。 */
const NOT_A_NAME = new Set(['什么', '啥', '谁', '哪个', '名字', '一声', '一下'])
/** 句尾的语气词 / 标点，从候选名字上剥掉。 */
const TAIL_NOISE = /[吧呀啊哦嘛呢啦哈咯～~\s了。．.!！?？,，、;；:：]+$/u

/**
 * 从用户这句话里解析**显式**的改口请求。
 *
 * 只认明确说法；模糊的（「还用这么生分吗」）交给模型判断后调工具。否定句
 * （「别再叫我先生」）一律不解析 —— 它没有给出新名字。
 *
 * 分流规则对齐上游的两个字段：
 *   - 说「昵称 / 名字」→ 写 `nickname`（那是名字本身）；
 *   - 说「叫我 / 喊我 / 称呼我 / 管我叫 / 称呼改成」→ 写 `callPreference`。
 * @param text - 用户这一轮说的话。
 * @returns `{ field, value }`；没有明确请求返回 null。
 */
export function extractAddressRequest(text) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (source === '') return null
  // 否定句先排除：「别再叫我先生」不是在给新名字
  if (/(?:别|不要|不用|甭)(?:再)?\s*(?:叫我|喊我|称呼我)/.test(source)) return null

  /** @type {Array<[RegExp, 'nickname' | 'callPreference']>} */
  const patterns = [
    // 昵称换成 X / 我名字是 X / 我的名字叫 X
    [/(?:把|将)?(?:我的)?(?:昵称|名字)(?:改成|换成|改为|换为|叫成|是|叫)\s*[「『"'“]?([^」』"'”\s，。！？,.!?；;：:（()）]{1,12})/u, 'nickname'],
    // 把称呼改成 X / 称呼换成 X
    [/(?:把|将)?(?:对我的)?(?:称呼)(?:改成|换成|改为|换为|叫成|是)\s*[「『"'“]?([^」』"'”\s，。！？,.!?；;：:（()）]{1,12})/u, 'callPreference'],
    // 以后叫我小明 / 就叫我小明吧 / 喊我一声老师 / 管我叫队长
    [/(?:以后|往后|从现在(?:起|开始)|从今天(?:起|开始))?\s*(?:就)?(?:叫我|喊我|称呼我|管我叫)\s*[「『"'“]?([^」』"'”\s，。！？,.!?；;：:（()）]{1,12})/u, 'callPreference']
  ]
  for (const [pattern, field] of patterns) {
    const match = pattern.exec(source)
    if (!match) continue
    // 「喊我一声老师」这种中间会带量词，先剥掉再判
    const name = match[1].trim().replace(TAIL_NOISE, '').replace(/^(?:一声|一下)/u, '').trim()
    if (name === '' || NOT_A_NAME.has(name)) continue
    if (/[什么啥谁吗呢]/u.test(name)) continue
    const clean = sanitize(name)
    if (clean !== '') return { field, value: clean }
  }
  return null
}

/**
 * 只要名字、不关心落到哪个字段的版本（兼容旧调用与测试）。
 * @param text - 用户这一轮说的话。
 * @returns 名字；没有明确请求返回空串。
 */
export function extractNicknameRequest(text) {
  const request = extractAddressRequest(text)
  return request === null ? '' : request.value
}

/**
 * 取本轮最后一条**真实用户消息**（插件自己注入的标记要排除）。
 * @param messages - pre-step 收到的本轮消息数组。
 * @returns 文本；没有则空串。
 */
function latestUserText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i -= 1) {
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
 * 注入给模型的「称呼规则」。**运行时上下文**，每轮现取。
 *
 * 为什么不能只靠人设正文里那段：正文是静态的（读的是 `{{user_nickname}}` 插值后的结果，
 * 但规则本身不会随"称呼刚被改过""称呼来源是偏好而不是昵称"变化）。这里把三件事说明白：
 *
 *   1. 现在叫的是什么、从哪来的（称呼偏好 / 昵称 / 默认）；
 *   2. **用多少**：强调、回应情绪、提醒、赞同或反驳时叫一次；短回复 0–1 次、
 *      中长 1–2 次；别每句都叫、别固定「X，……」开头；叫过之后降频（上游 env 块里
 *      的「称呼使用」那条规则，我们把它放进每轮上下文，别指望模型自己记得）；
 *   3. **怎么变**：关系称呼要推回对应的那一个；明确改口直接换、并当轮就用。
 * @returns 规则文本。
 */
export function nicknameContext() {
  const { address, callPreference } = loadProfile()
  const from = callPreference !== '' ? '称呼偏好' : '昵称'
  return [
    '【称呼】',
    `你现在称呼对方为「${address}」（来自${from}）。`,
    '用多少：',
    '- 在强调重点、回应情绪、提醒、赞同或反驳时，自然地叫一次；',
    '- 短回复 0–1 次，中长回复 1–2 次，不必严格计数；',
    '- 不要每条回复都叫，也不要固定用「X，……」开头；连续叫过之后要降频；',
    '- 自然度优先：让对方偶尔明显感觉到「你在叫我」，而不是感觉到系统在要求你用称呼。',
    '怎么变：',
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
 *
 * 写的是**称呼偏好**（`callPreference`）而不是昵称 —— 模型判断的是"该怎么叫"，
 * 不是"名字是什么"，这也与上游 `preferredName` 的语义一致。
 * @param value - 新称呼。
 * @returns 结果文本。
 */
function setAddressTool(value) {
  // 空值不是「清除」的意思 —— 模型传空是 bug，不能顺手把已有的称呼删掉。
  if (sanitize(value) === '') return '称呼没有改成功：名字不能为空，也不能带换行或花括号。'
  const address = saveCallPreference(value)
  if (address === '') return '称呼没有改成功：名字不能为空，也不能带换行或花括号。'
  return `称呼已改为「${address}」。从这个称呼开始，之后都这么叫；不用向对方播报你改了什么。`
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
      const request = extractAddressRequest(text)
      if (request === null) return decision
      const before = loadProfile()
      const current = request.field === 'nickname' ? before.nickname : before.callPreference
      if (request.value === current) return decision
      const address = saveField(request.field, request.value)
      if (config.trace) {
        console.log(`[cyrene-nickname] 显式改口：${request.field} ${current || '(空)'} → ${address || '(写入失败)'}`)
      }
      // 不追加消息：变量在装配期现取，本轮就会带上新称呼。
      return decision
    },
    { prepend: true }
  )

  // 写侧 ②：暗示类请求交给模型判断（没有 tools 服务时只读，不影响变量）。
  ctx.inject(['tools'], (scope) => {
    scope.tools.register(
      stringTool({
        name: 'set_address',
        description:
          '更改你称呼对方的方式（写入「称呼偏好」，优先于设置里的昵称）。'
          + '当对方明确要求改口（「以后叫我老师」），用暗示表达希望被换一种称呼'
          + '（「我们之间还用这么生分吗」），或用**关系称呼**暗示关系已经变化'
          + '（求婚后叫你「老婆」/「老公」，意思是让你反过来叫他对应的那个）时使用。'
          + '只在确实要改的时候调用，不要因为一句玩笑就改；改完当轮就用新称呼，也不用向对方播报。',
        parameter: 'name',
        parameterDescription: '新称呼，例如「老师」「小明」',
        run: setAddressTool
      })
    )
  })
}
