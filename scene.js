/**
 * dsh-cyrene / scene.js —— 「角色扮演场景」开关（会话级，由 preset/chat 挂载）。
 *
 * ## 规则
 *
 * 这个模式默认是**普通对话**。当用户这一轮的消息里出现括号（`（）` 或 `()`）并且
 * 括号里写着内容时，就认为用户给了**场景 / 动作提示**，本轮切到角色扮演场景模式：
 * 括号外是台词或意图，括号里是环境与动作，用「叙述＋对话」推进。
 *
 * 下一轮没有括号了，就回到普通对话。
 *
 * ## 为什么用 pre-step，而不是 context()
 *
 * `systemPrompt.context()` 的 provider 在 `assemble()` 里被调用，而 assemble 跑在
 * **本轮用户消息落库之前**（见 worldbook/index.mjs 头部的图）。也就是说 context()
 * 根本看不到用户这一轮刚打的字 —— 用它判断"这轮有没有括号"必然永远判成没有。
 * `agent/pre-step` 的 `payload.messages` 才是本轮消息。
 *
 * ## 为什么只注入"切换"，不每轮注入场景
 *
 * 场景描述本来就在用户消息里，模型看得见；每轮再抄一遍只会让历史膨胀。
 * 所以这里是个状态机：只在 **普通 ↔ 场景** 状态变化时追加一条标记消息，
 * 状态不变时什么都不做。
 *
 * ## 括号的判定
 *
 * 不是所有括号都算场景：`（1）`、`print(x)` 这种明显不是。规则是
 *   - 中文括号：内容 ≥ 2 字；
 *   - 半角括号：内容 ≥ 6 个字符（避免代码 / 数学里的括号误触发）。
 * 两个条件都要求内容非空、去掉首尾空白。
 */
import { randomUUID } from 'node:crypto'

/** 中文全角括号。 */
const FULL = ['（', '）']
/** 半角括号。 */
const HALF = ['(', ')']

/**
 * 括号里的内容像不像场景 / 动作提示。
 * @param content - 已去空白的括号内容。
 * @returns 是否算作场景描述。
 */
export function isSceneLike(content) {
  const text = String(content ?? '').trim()
  if (text === '') return false
  // 含中文：2 个字就够（「雨夜」「她笑」都成立）
  if (/[\u4e00-\u9fff]/.test(text)) return text.length >= 2
  // 纯 ASCII：要求更长，避开 (1)、print(x)、a(b)
  return text.length >= 6
}

/**
 * 括号内容是不是在描述**你（昔涟）的动作** —— 例如「你亲了我一下」。
 *
 * 这类内容不是场景，而是**给角色的动作指令**：用户写「你…」，意思是"你来做这件事"。
 * 判据偏保守：
 *   - 以「你」开头；
 *   - 不以「吗 / 呢 / 嘛 / ？ / ?」结尾（那是问句，不是动作）；
 *   - 出现动作痕迹：我 / 了 / 把 / 着 / 过 / 给 / 地，或常见动作字。
 * 「你真好」这种夸奖不算；「你还记得吗」这种问句也不算。
 * @param content - 括号里的内容。
 * @returns 是否是一条动作指令。
 */
export function looksLikeHerAction(content) {
  const text = String(content ?? '').trim()
  if (!text.startsWith('你')) return false
  if (/[吗呢嘛？?]$/.test(text)) return false
  return /我|了|把|着|过|给|地|亲|抱|牵|摸|吻|拥|笑|哭|坐|站|走|跑|看|听|说|叹|靠|贴|蹭|抚|咬|推|拉|拽|搂/.test(text)
}

/**
 * 把括号内容分成两类：给她的动作指令、场景 / 环境。
 * @param text - 用户这一轮说的话。
 * @returns `{ found, actions, scenes }`（都是去重后的原文数组）。
 */
export function classifyScene(text) {
  const source = String(text ?? '')
  const actions = []
  const scenes = []
  for (const [open, close] of [FULL, HALF]) {
    let from = 0
    for (;;) {
      const start = source.indexOf(open, from)
      if (start === -1) break
      const end = source.indexOf(close, start + 1)
      if (end === -1) break
      const content = source.slice(start + 1, end).trim()
      if (isSceneLike(content)) {
        const bucket = looksLikeHerAction(content) ? actions : scenes
        if (!bucket.includes(content)) bucket.push(content)
      }
      from = end + 1
    }
  }
  return { found: actions.length > 0 || scenes.length > 0, actions, scenes }
}

/**
 * 从一段文本里抽出所有括号内容。
 * @param text - 用户这一轮说的话。
 * @returns `{ found, scenes }`（`scenes` 为去重后的原文顺序数组）。
 */
export function extractScene(text) {
  const { found, actions, scenes } = classifyScene(text)
  return { found, scenes: [...scenes, ...actions] }
}

/**
 * 取本轮最后一条**真实用户消息**（`source.kind === 'user'`）。
 * 插件自己注入的标记也算 user 角色，所以必须按 source 过滤，否则会把标记当用户输入。
 * @param messages - pre-step 收到的本轮消息数组。
 * @returns 文本；没有则空串。
 */
export function latestUserText(messages) {
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
 * 进场景时追加的标记。
 * @param scenes - 抽到的场景描述。
 * @returns 纯文本。
 */
export function enterMarker(items) {
  const normalized = (Array.isArray(items) ? items : []).map((item) => {
    if (typeof item === 'string') {
      return { raw: item, kind: looksLikeHerAction(item) ? 'action' : 'scene' }
    }
    return { raw: String(item?.raw ?? ''), kind: item?.kind === 'action' ? 'action' : 'scene' }
  }).filter((item) => item.raw !== '')

  const actions = normalized.filter((item) => item.kind === 'action').map((item) => item.raw)
  const scenes = normalized.filter((item) => item.kind === 'scene').map((item) => item.raw)

  const lines = ['【场景模式开启】', '用户这一轮用括号给出了场景 / 动作提示：']
  if (scenes.length > 0) lines.push('- 场景：' + scenes.join(' / '))
  if (actions.length > 0) lines.push('- 你的动作：' + actions.join(' / '))
  lines.push('本轮开始按角色扮演场景处理：')
  lines.push('- 括号外的话是他的台词或意图；')
  if (scenes.length > 0) lines.push('- 上面「场景」那条是环境与氛围，用叙述自然带出来；')
  if (actions.length > 0) {
    lines.push('- 上面「你的动作」那条是**给你的动作指令**：你要真的做出来，并在回复里用括号写出做完的动作，')
    lines.push('  格式如：（亲了你一下）—— 动作对象称「你」，不复述他的原句；')
  }
  lines.push('- 用「叙述＋对话」推进，台词保持昔涟的语气；')
  lines.push('- 不要出戏、不要解释规则、不要把这段提示复述出来。')
  return lines.join('\n')
}

/** 退出场景时追加的标记。 */
export const EXIT_MARKER = [
  '【回到普通对话】',
  '用户这一轮没有再给场景描述。按平常聊天回复，不要继续旁白体，也不要提「刚才在扮演」这件事。'
].join('\n')

/**
 * 插件入口。
 * @param ctx - 插件上下文。
 * @param config - 可选 `trace`：把状态变化打到控制台。
 */
export function apply(ctx, config = {}) {
  /** 每个会话当前处于哪种模式：'chat' | 'scene'。没记录过就是 chat。 */
  const modes = new Map()

  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      const decision = await next()
      if (decision?.kind !== 'enter') return decision
      if (config.enabled === false) return decision

      const session = payload?.agent?.session
      const sessionId = String(session?.id ?? payload?.agent?.id ?? '')
      const text = latestUserText(payload?.messages)
      if (text === '') return decision

      const { found, actions, scenes } = classifyScene(text)
      const nextMode = found ? 'scene' : 'chat'
      const previousMode = modes.get(sessionId) ?? 'chat'
      if (nextMode === previousMode) return decision
      modes.set(sessionId, nextMode)

      const marker = {
        id: randomUUID(),
        role: 'user',
        content: [{
          type: 'text',
          text: nextMode === 'scene'
            ? enterMarker([...scenes.map((raw) => ({ raw, kind: 'scene' })), ...actions.map((raw) => ({ raw, kind: 'action' }))])
            : EXIT_MARKER
        }],
        // 与 worldbook 一致：v4 要求生产者自有的 kind，不能写裸 'plugin'。
        source: { kind: 'plugin:dsh-cyrene/scene', form: 'snapshot' }
      }
      if (config.trace) {
        console.log(`[cyrene-scene] ${sessionId || '(无会话)'} ${previousMode} → ${nextMode}`)
      }
      return { kind: 'enter', messages: [...decision.messages, marker] }
    },
    { prepend: true }
  )
}
