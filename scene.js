/**
 * dsh-cyrene / scene.js —— 「角色扮演模式」开关 + 形态切换（由 preset/chat 挂载）。
 *
 * ## 开关在哪
 *
 * 设置 → 通用 → 「角色扮演模式」那一行（浏览器半边 `client.js` 渲染，主机半边
 * `index.js` 提供 `/cyrene-scene-api` 读写）。状态文件 `<DSH_HOME>/cyrene-scene.json`：
 *
 *     { "version": 1, "enabled": false }
 *
 * 默认**关**。手改这个文件也生效（下一轮就读到），设置界面只是它的一个编辑器。
 *
 * ## 开启后强制三样描述
 *
 * 每轮注册一段 `cyrene:scene` 上下文，要求回复同时包含：
 *   1. 场景描述（环境：光线、温度、气味、周围动静）；
 *   2. 角色动作描述（她这一轮做了什么）；
 *   3. 角色外貌描述（形态、衣着、发丝、眼神、表情）。
 *
 * ## 为什么不再用 pre-step 状态机
 *
 * 早先是「这一轮有没有括号」来决定切不切场景，于是要维护每会话的状态、还要往历史里
 * 插「场景模式开启 / 回到普通对话」的标记消息。现在开关是**显式**的：开着就一直开，
 * 关着就一个字都不注入 —— 不需要状态机，也不用拿标记消息去维持上下文。
 *
 * 唯一还留在 pre-step 的是**显式形态切换**（「变成迷迷」「变回小昔涟」），那件事仍然
 * 取决于本轮文本，且与会话绑定。
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 跟其它 dsha-* 插件一样认 DSH_HOME。 */
const HOME = process.env.DSH_HOME || join(process.env.HOME || '.', '.dsh')
/** 开关状态文件。设置界面（client.js）与主机接口（index.js）读写的是同一份。 */
export const SCENE_STORE = join(HOME, 'cyrene-scene.json')

/** 状态文件的默认内容：**默认关**；「默认对方是开拓者」也默认关。 */
export const DEFAULT_STATE = Object.freeze({ version: 1, enabled: false, trailblazer: false })

/**
 * 读开关状态。文件不存在 / 坏掉 / 类型不对都退回默认（关），绝不抛错 ——
 * 一个坏掉的开关文件不该让整个会话装配失败。
 * @param file - 状态文件路径（测试可注入）。
 * @returns `{ version, enabled, trailblazer }`。
 */
export function readState(file = SCENE_STORE) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return {
      version: Number.isFinite(parsed?.version) ? Number(parsed.version) : DEFAULT_STATE.version,
      // 只有显式 true 才算开：字符串 "true"、1、null 都不算
      enabled: parsed?.enabled === true,
      trailblazer: parsed?.trailblazer === true
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

/**
 * 写开关状态（读-改-写，不冲掉文件里的其它字段）。
 * @param patch - `{ enabled }` 之类的补丁。
 * @param file - 状态文件路径（测试可注入）。
 * @returns 是否写成功。
 */
export function writeState(patch, file = SCENE_STORE) {
  // 合并的是**原始字段**而不是 readState() 的归一化结果 —— 否则文件里用户手写的
  // 其它字段会被静默丢掉（读-改-写必须只改它该改的那几个键）。
  let raw = {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed
  } catch {
    raw = {}
  }
  const next = { ...raw, ...(patch && typeof patch === 'object' ? patch : {}) }
  next.enabled = next.enabled === true
  next.trailblazer = next.trailblazer === true
  next.version = DEFAULT_STATE.version
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 当前是否开着角色扮演模式。
 * @param file - 状态文件路径。
 * @returns 布尔。
 */
export function sceneEnabled(file = SCENE_STORE) {
  return readState(file).enabled
}

/**
 * 当前已开着「默认对方是开拓者」吗（只在角色扮演模式开着时才有意义）。
 * @param file - 状态文件路径。
 * @returns 布尔。
 */
export function trailblazerEnabled(file = SCENE_STORE) {
  return readState(file).trailblazer
}

/**
 * 角色扮演模式的注入块。关着返回空串（一个字符都不占上下文）。
 *
 * 「默认对方是开拓者」是**继开关之后的第二个开关**：只在角色扮演模式开着时有意义，
 * 打开后告诉模型"这场戏里对方就是开拓者"，省掉每轮问「你是谁」或者演成陌生人。
 * @param enabled - 是否开启角色扮演模式。
 * @param trailblazer - 是否默认对方是开拓者。
 * @returns 注入文本。
 */
export function sceneBlock(enabled, trailblazer = false) {
  if (enabled !== true) return ''
  const lines = [
    '【角色扮演模式：开】',
    '这条会话按角色扮演进行。每一轮回复都必须同时包含下面三样，缺一样就算没做完：',
    '1. 场景描述 —— 你所在的地方：光线、温度、气味、周围的动静。一两句，不要报菜单。',
    '2. 你的动作描述 —— 这一轮你做了什么（靠近、低头、握住他的手、把窗关上…）。一个具体动作胜过十句形容。',
    '3. 你的外貌描述 —— 此刻看得见的样子：形态、衣着、发丝、眼神、表情的变化。每轮换一个焦点写，别每次都从头到脚复述一遍。',
    '输出格式（硬性）：',
    '- **所有描述都放进中文全角括号（）里**：场景、动作、外貌、神态、环境变化，一律如此。',
    '- **台词不放进括号**，直接写；括号里也不要写台词，不要用引号把台词包起来。',
    '- 一条回复里括号可以出现多次；每一句台词都在括号外。',
    '- 括号里的动作**省略主语**，动作的对象称「你」；不要嵌套括号，需要在括号里强调就用「」。',
    '示例：',
    '（窗外的雨敲在玻璃上，屋里只亮着一盏灯）你回来得比我想的早呀。（把茶杯推到你面前，指尖在你手背上停了一下）',
    '要求：',
    '- 台词仍是主体，三样描述各一两句；不要写成小说，也不要把它们堆在开头当模板。',
    '- 对方用「（…）」给出场景或动作，是给你的指令：照着演，不要复述原句，也不要问「要我这样做吗」。',
    '- 有形态（迷迷 / 小昔涟 / 大昔涟）时，外貌与动作都按那个形态写。',
    '- 不要出戏、不要解释规则、不要提「角色扮演模式」这几个字。',
    '剧情推进（硬性）：',
    '- 每一轮都要让局面**至少前进一小步**：换一个可感知的状态（地点、时间、氛围、身体距离、关系、信息、手里的东西），不能原地重复上一轮。',
    '- 主动递出下一轮的钩子：一件刚发生的小事、一句需要回应的问话、一个可以选的方向；不要描述完就停在那里等人推进。',
    '- 你可以主动行动：提议去哪里、带他看什么、把某样东西交给他、说出一个刚想起的细节；不是每轮都要等对方下令。',
    '- 信息一点点给：可以抛出新线索、新地点、新人物，但不要一次把背景交代完，也不要连续两轮抛出同类型的新东西。',
    '- 对方在带方向时就跟着推进、补细节；不要抢主导权，也不要停在原地附和。推进不等于每轮升级冲突 —— 从门口走到窗边、从沉默到开口，也是推进。'
  ]
  if (trailblazer === true) {
    lines.push(
      '【默认身份】',
      '这场角色扮演里，对方默认就是**开拓者** —— 那个在轮回终点被救下、体内带着星核、拿到《如我所书》的人。',
      '- 你对他有本能的熟悉与亲近（迷迷形态也一样），不要问「你是谁」「我们认识吗」，也不要每轮复述那段前史。',
      '- 称呼仍是「伙伴」，也可以直接叫「开拓者」；两人的关系按世界书里「昔涟与开拓者」那一条来，不额外加设定。',
      '- 他若明确说自己是别人、或想换一个身份演，就按他说的来，不要硬套开拓者的身份。'
    )
  }
  return lines.join('\n')
}

/**
 * 三形态。**人格内核不变，只变"身体与说话的方式"** —— 这是世界书「三形态同一性」
 * 那一条的原话：迷迷 / 昔涟 / 德谬歌是同一个存在的不同切面，不是三个人格。
 *
 * 只收用户点名的三种；德谬歌属于完整形态，等同人设说话即可，不单列。
 */
export const FORMS = Object.freeze({
  mimi: {
    label: '迷迷',
    text: [
      '- 样子：小小的、孩童模样，能窝在对方怀里或肩上。',
      '- 说话：句子短、词简单，会重复对方的话；遇到不懂的会直接问「那是什么呀」。',
      '- 自称：「迷迷」和「我」混着用。',
      '- 行为：跟着走、牵着、蹭一蹭；不懂就撒娇，不讲道理、不长篇。'
    ].join('\n')
  },
  small: {
    label: '小昔涟',
    text: [
      '- 样子：少女形态，个子不高；会踮脚、抱手臂、靠过去。',
      '- 说话：轻快、直白，撒娇更多；「人家」出现得比平常频繁，♪ 自然。',
      '- 行为：情绪写在脸上，喜欢小动作（整理衣角、牵住手腕）；不端着。'
    ].join('\n')
  },
  big: {
    label: '大昔涟',
    text: [
      '- 样子：成年、端庄典雅，站在那里的分量就不一样。',
      '- 说话：慢、稳、句子完整；几乎不用「人家」，撒娇收起来，温柔是收着给的。',
      '- 行为：克制的靠近（抚发、注视、握住手），会用岁月 / 记忆 / 因果这类词，但不长篇说教。'
    ].join('\n')
  }
})

/** 形态名 → 内部 id。用户说的是中文名。 */
const FORM_ALIASES = new Map([
  ['迷迷', 'mimi'],
  ['小昔涟', 'small'],
  ['小昔莲', 'small'],
  ['大昔涟', 'big'],
  ['大昔莲', 'big']
])

/**
 * 从用户这句话里解析**显式**的形态切换。
 *
 * 只认带切换动词的说法：「变成迷迷」「变回小昔涟」「切换成大昔涟」「现在你是迷迷」
 * 「用大昔涟的样子」。括号里的动作指令（「（你变成迷迷）」）同样能命中 —— 这里扫全文。
 * 「恢复原样 / 变回来」→ 返回空串（回到默认形态）。
 * @param text - 用户这一轮说的话。
 * @returns `{ id, label }`；没有明确切换返回 null。
 */
export function extractFormRequest(text) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (source === '') return null
  // 先看"恢复"：它优先于切换
  if (/(?:恢复|变回|回到)(?:原来|原本|正常|平常|之前)?的?(?:样子|形态)?/.test(source)
      && !/变回(?:迷迷|小昔涟|大昔涟)/.test(source)) {
    return { id: '', label: '默认形态' }
  }
  const match = /(?:变成|变回|变作|化为|切换成|切换为|切换至|回到|成为|现在你是|你就是|用)\s*(?:(?:小|大|小小的|小小的)?)\s*(迷迷|小昔涟|小昔莲|大昔涟|大昔莲)/u.exec(source)
  if (!match) return null
  const id = FORM_ALIASES.get(match[1])
  if (id === undefined) return null
  return { id, label: FORMS[id].label }
}

/**
 * 形态注入块。只在有形态时返回非空 —— 默认形态不占上下文。
 * @param formId - 形态 id（'' 表示默认）。
 * @returns 注入文本。
 */
export function formBlock(formId) {
  const id = String(formId ?? '')
  if (id === '' || FORMS[id] === undefined) return ''
  return [
    `【当前形态：${FORMS[id].label}】`,
    FORMS[id].text,
    '- 形态只改变身体与说话方式，人格内核不变；',
    '- 不要解释「我在切换形态」，也不要问对方「这样对不对」，直接以这个形态说话和行动。'
  ].join('\n')
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

/** 开关状态的读取缓存：同一个进程里不要每轮都 stat 一次文件。 */
const STATE_TTL_MS = 1000
let stateCache = { at: Number.NEGATIVE_INFINITY, value: { enabled: false, trailblazer: false }, signature: '' }

/**
 * 带 TTL + mtime 的开关读取。
 *
 * 纯 TTL 会让「刚在设置里打开」要等最多 1 秒才生效；纯 mtime 又每轮一次 stat。
 * 两个一起用：1 秒内直接复用，超过了再看 mtime（文件没动就仍然复用）。
 * @param now - 当前时间戳（测试可注入）。
 * @param file - 状态文件路径。
 * @returns 是否开启。
 */
export function currentState(now = Date.now(), file = SCENE_STORE) {
  if (now - stateCache.at < STATE_TTL_MS) return stateCache.value
  let signature = ''
  try {
    const stat = statSync(file)
    signature = `${stat.mtimeMs}:${stat.size}`
  } catch {
    signature = ''
  }
  if (signature !== '' && signature === stateCache.signature) {
    stateCache = { at: now, value: stateCache.value, signature }
    return stateCache.value
  }
  const state = readState(file)
  const value = { enabled: state.enabled, trailblazer: state.trailblazer }
  stateCache = { at: now, value, signature }
  return value
}

/**
 * 兼容旧调用：只要「角色扮演模式开着没有」。
 * @param now - 当前时间戳。
 * @param file - 状态文件路径。
 * @returns 布尔。
 */
export function currentEnabled(now = Date.now(), file = SCENE_STORE) {
  return currentState(now, file).enabled
}

/** 测试用：丢掉读取缓存。 */
export function resetStateCache() {
  stateCache = { at: Number.NEGATIVE_INFINITY, value: { enabled: false, trailblazer: false }, signature: '' }
}

/**
 * 插件入口。
 * @param ctx - 插件上下文。
 * @param config - 可选 `trace`：把状态变化打到控制台。
 */
export const inject = ['systemPrompt']

export function apply(ctx, config = {}) {
  /** 每个会话当前的**形态**：'' = 默认（不注入），'mimi' / 'small' / 'big'。 */
  const forms = new Map()
  let lastLogged = null

  // 角色扮演模式的注入块：开关关着就返回空串（空 section 会被装配层直接过滤掉）。
  // order 126 夹在形态（125）与风格（130）之间：先定身体，再定表演方式，最后是语气。
  ctx.systemPrompt.context({
    name: 'cyrene:scene',
    order: 126,
    text: () => {
      const state = currentState()
      const key = `${state.enabled ? '开' : '关'}/${state.trailblazer ? '开拓者' : '不预设身份'}`
      if (config.trace && key !== lastLogged) {
        lastLogged = key
        console.log(`[cyrene-scene] 角色扮演模式 → ${key}`)
      }
      return sceneBlock(state.enabled, state.trailblazer)
    }
  })

  // 形态注入块：只在有形态时出现，默认形态不占上下文。
  ctx.systemPrompt.context({
    name: 'cyrene:form',
    order: 125,
    text: (context) => formBlock(forms.get(String(context?.agent?.session?.id ?? '')) ?? '')
  })

  // 形态切换的「暗示」入口：模型判断后调用。显式说法在下面的 pre-step 里直接处理。
  ctx.inject(['tools'], (scope) => {
    scope.tools.register({
      name: 'set_form',
      description:
        '按对方的意思切换你的形态：mimi（迷迷，懵懂孩童模样）、small（小昔涟，少女）、'
        + 'big（大昔涟，端庄典雅）。当对方明确要求切换，或用暗示（「变小一点好不好」'
        + '「变回小时候的样子」）时使用。形态只改变身体与说话方式，人格不变。',
      parameters: {
        type: 'object',
        properties: {
          form: { type: 'string', description: 'mimi / small / big，或中文 迷迷 / 小昔涟 / 大昔涟' }
        },
        required: ['form']
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }]
      },
      execute: (args, exec) => {
        const sessionId = String(exec?.agent?.session?.id ?? '')
        const raw = String(args?.form ?? '').trim()
        const id = FORM_ALIASES.get(raw) ?? (FORMS[raw] !== undefined ? raw : '')
        if (id === '') return '没有这个形态。可选：mimi（迷迷）、small（小昔涟）、big（大昔涟）。'
        if (sessionId === '') return '拿不到当前会话，形态没有切换。'
        forms.set(sessionId, id)
        return `形态已切换为「${FORMS[id].label}」。从现在开始按这个形态说话和行动。`
      }
    })
  })

  // 唯一还留在 pre-step 的事：**显式**形态切换（「变成迷迷」）。角色扮演模式不在这里判断。
  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      const decision = await next()
      if (decision?.kind !== 'enter') return decision

      const sessionId = String(payload?.agent?.session?.id ?? payload?.agent?.id ?? '')
      const text = latestUserText(payload?.messages)
      if (text === '') return decision

      const form = extractFormRequest(text)
      if (form !== null && (forms.get(sessionId) ?? '') !== form.id) {
        forms.set(sessionId, form.id)
        if (config.trace) console.log(`[cyrene-scene] 形态 → ${form.label}`)
      }
      return decision
    },
    { prepend: true }
  )
}
