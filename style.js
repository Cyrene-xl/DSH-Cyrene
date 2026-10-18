/**
 * dsh-cyrene / style.js —— 「表达风格档位」插件（会话级，由 preset/chat 挂载）。
 *
 * ## 它补的是什么
 *
 * 上游 Cyrene-Agent 的语气不只有一份静态人设：**每档风格 = 一段风格提示词 + 一组采样参数**
 * （`prompts/styles/0X_*.md` + `BUILT_IN_STYLE_PRESETS`）。本插件把这条绑定接进 DSH：
 *
 *   - 风格提示词 → `systemPrompt.context()`（**请求尾部**、每轮重算）
 *   - 温度       → `agent/request` 瀑布里改 `LlmCallConfig.temperature`
 *   - 档位选择   → **每个会话各自一个**，存在 `<DSH_HOME>/cyrene-style.json`
 *
 * ## 为什么这样接（每条都对应一处查证过的事实）
 *
 * 1. **走 `context()` 而不是改人设正文**：上游的 stylePromptBlock 就在请求尾部（`soulRuntimeContext`
 *    第 5 项），靠"越靠后越近"生效；而且尾部内容不进 stablePrefix，不打断厂商侧提示词缓存。
 *    `order: 130` 刻意排在常驻世界书（`order: 140`）之前 —— 对齐上游顺序。
 *
 * 2. **温度只能走 `agent/request`**：`dsh-agent-loop` 的 Config schema 里**没有** temperature
 *    （只有 maxParallelToolCalls 与 agents[]），预设行设不了。但它每轮会把 seed config 交给
 *    `dispatch.waterfall('agent/request', …)`，插件在该钩子里 `next()` 之后返回改写后的 config
 *    即可 —— DSH 自己的 `dsh-webhook` 就是这么改 reasoningEffort 的，这里照同一范式。
 *    该类配置会写进会话的 `request/header` 事件（冻结后的真实请求头），可离线核验。
 *
 * 3. **`default` 档不写温度**：上游也是 `styleId === 'default'` 时走厂商默认采样
 *    （`soulSampling` 只在非 default 时才解析）。顺带避免与全局采样类插件互相覆盖。
 *
 * 4. **不碰 `top_p` / 重复惩罚**：`LlmCallConfig` 只暴露 `provider / model / reasoningEffort /
 *    temperature / maxTokens / stop`。上游那张表里的 OpenAI `frequency_penalty`、
 *    Qwen `repetition_penalty` 在 DSH 这层无处可放 —— 这是能力边界，不是没做。
 *
 * 5. **状态走文件、不走 settings**：`ctx.settings` 是全局服务，而本插件只由 chat 预设挂载、
 *    作用域是"这个会话"。用 `<DSH_HOME>/cyrene-style.json` 与 memory.js / nickname.js 一致，
 *    也不需要额外依赖。
 *
 * ## 与上游的差异（有意）
 *
 * - 上游把风格**档位**存在应用设置里（`saved.currentStyleId`），我们按会话存：换档只影响当前会话。
 * - 上游 `custom` 档的采样可配 temperature 或 top-p；DSH 没有 top-p 通道，所以只支持温度。
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOME = process.env.DSH_HOME || join(process.env.HOME || '.', '.dsh')

/** 会话表最多留多少条，超出按时间淘汰（防止状态文件无限长）。 */
const MAX_SESSIONS = 50

/**
 * 风格档位表 —— 上游 `prompts/styles/` 五档 + custom。
 *
 * `temperature` 为 `null` 表示**不写**该字段（跟随模型默认），不是 0。
 * 数值与上游 `BUILT_IN_STYLE_PRESETS` 一致：lively 0.90 / healing 0.55 /
 * focused 0.40 / sweet 0.82；default 上游不设采样（虽然表里有个 0.65，但代码里被跳过）。
 */
export const STYLES = Object.freeze({
  default: { file: '01_default.md', label: '温柔・和善（默认）', temperature: null },
  lively: { file: '02_lively.md', label: '元气・活泼', temperature: 0.9 },
  healing: { file: '03_healing.md', label: '治愈・安心', temperature: 0.55 },
  focused: { file: '04_focused.md', label: '知性・认真', temperature: 0.4 },
  sweet: { file: '05_sweet.md', label: '撒娇・黏人', temperature: 0.82 },
  custom: { file: null, label: '自定义', temperature: null }
})

/** 状态文件里没写时用哪档。 */
const DEFAULT_STYLE = 'default'

/**
 * 在这些预设里**禁用风格**。
 *
 * 为什么单独一条：风格只改"怎么说"，但它毕竟是往提示词里塞话；而工作模式带
 * shell / 文件 / 网络这些能真正动东西的工具，一份带着强烈依恋感的写作风格配上权限
 * 就是"越权操作"的诱因。上游本来也不给 work / code 注入风格，这里是第二道保险
 * —— 就算哪天有人把本插件误挂到工作模式，运行时也会自己拒掉。
 */
const DISABLED_PRESETS = Object.freeze(['cyrene-work'])

/**
 * 从会话日志里取当前预设 id（取最后一次 `agent-preset/selected`）。
 * @param session - 会话对象。
 * @returns 预设 id；拿不到返回空串。
 */
export function presetIdOf(session) {
  try {
    const events = session?.snapshotEvents?.()
    if (!Array.isArray(events)) return ''
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event?.type !== 'agent-preset/selected') continue
      const id = event?.data?.agentPreset
      if (typeof id === 'string' && id !== '') return id
    }
  } catch {
    /* 读不到就当未知，交给调用方决定 */
  }
  return ''
}

/**
 * 这个预设下是否禁用风格。
 * @param presetId - 预设 id（`presetIdOf()` 的结果）。
 * @param disabled - 禁用清单，默认 `DISABLED_PRESETS`。
 * @returns 是否禁用。
 */
export function isStyleDisabled(presetId, disabled = DISABLED_PRESETS) {
  return typeof presetId === 'string' && presetId !== '' && disabled.includes(presetId)
}

/**
 * 判断是不是合法档位名。
 * @param value - 任意值。
 * @returns 是否合法。
 */
export function isStyleId(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STYLES, value)
}

/**
 * 把任意输入归一成合法档位名（非法一律退 default）。
 * @param value - 任意值。
 * @returns 档位名。
 */
export function normalizeStyleId(value) {
  return isStyleId(value) ? value : DEFAULT_STYLE
}

/**
 * 空状态。
 * @returns 状态对象。
 */
function emptyState() {
  return { version: 1, default: DEFAULT_STYLE, customTemperature: null, customLabel: null, customTier: 1, sessions: {} }
}

/**
 * 读状态文件。**任何异常都退回空状态** —— 一个配置文件不能让对话发不出去。
 * @param file - 状态文件路径。
 * @returns 归一后的状态。
 */
export function readState(file) {
  try {
    if (!existsSync(file)) return emptyState()
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyState()
    const sessions = {}
    const source = raw.sessions
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      for (const [id, entry] of Object.entries(source)) {
        if (id === '' || entry === null || typeof entry !== 'object') continue
        if (!isStyleId(entry.style)) continue
        sessions[id] = { style: entry.style, at: Number.isFinite(entry.at) ? entry.at : 0 }
      }
    }
    // ⚠️ 不能写 `Number(raw.customTemperature)`：null → 0，而 0 是**合法**温度
    // （确定性采样）。那样一来"没配温度"会被读成"温度=0"，custom 档会静默变成
    // 全确定输出。只接受真正的 number。
    const custom = raw.customTemperature
    const customOk = typeof custom === 'number' && Number.isFinite(custom) && custom >= 0 && custom <= 2
    // custom 档的**显示名**可以改（比如把这一档叫成自己的风格名）。它只用于界面与
    // 命令提示，不参与任何逻辑判断，所以清洗得简单：去空白、限长、空串视为没设。
    const label = typeof raw.customLabel === 'string' ? raw.customLabel.trim().slice(0, 16) : ''
    return {
      version: 1,
      default: isStyleId(raw.default) ? raw.default : DEFAULT_STYLE,
      customTemperature: customOk ? custom : null,
      customLabel: label === '' ? null : label,
      // 强度档：1 = 默认（第一档），2 = 用户**在设置里显式开启**的第二档。
      // 这是硬开关：注入时由插件写授权标记，不让模型去猜"用户有没有点头"。
      customTier: Number(raw.customTier) === 2 ? 2 : 1,
      sessions
    }
  } catch {
    return emptyState()
  }
}

/**
 * 写状态文件（自动建目录）。失败不抛 —— 顶多这一轮的选择没保存。
 * @param file - 状态文件路径。
 * @param state - 状态。
 */
export function writeState(file, state) {
  try {
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 这个会话用哪档风格：会话自己的选择 → 状态里的 default → 'default'。
 * @param state - 状态。
 * @param sessionId - 会话 id（拿不到就传空串）。
 * @returns 档位名。
 */
export function resolveStyle(state, sessionId) {
  const id = String(sessionId ?? '')
  if (id !== '') {
    const entry = state?.sessions?.[id]
    if (entry && isStyleId(entry.style)) return entry.style
  }
  return isStyleId(state?.default) ? state.default : DEFAULT_STYLE
}

/**
 * 档位的**显示名**。custom 档允许在状态文件里用 `customLabel` 改名
 * （只影响界面与命令提示，不参与逻辑）。
 * @param state - 状态（可空）。
 * @param styleId - 档位名。
 * @returns 显示名。
 */
export function labelOf(state, styleId) {
  const id = normalizeStyleId(styleId)
  if (id === 'custom' && typeof state?.customLabel === 'string' && state.customLabel !== '') {
    return state.customLabel
  }
  return STYLES[id].label
}

/**
 * 这档风格该用多少温度。
 * @param styleId - 档位名。
 * @param state - 状态（custom 档的温度从这里读）。
 * @returns 温度；`undefined` 表示**不要写** temperature 字段。
 */
export function temperatureFor(styleId, state) {
  if (styleId === 'custom') {
    const custom = state?.customTemperature
    return Number.isFinite(custom) && custom >= 0 && custom <= 2 ? custom : undefined
  }
  const temperature = STYLES[normalizeStyleId(styleId)]?.temperature
  return typeof temperature === 'number' ? temperature : undefined
}

/**
 * 记录某个会话的选择（纯函数，返回新状态）。
 * @param state - 旧状态。
 * @param sessionId - 会话 id。
 * @param styleId - 档位名。
 * @param now - 当前时间戳（注入便于测试）。
 * @returns 新状态。
 */
export function chooseStyle(state, sessionId, styleId, now = Date.now()) {
  if (!isStyleId(styleId)) throw new TypeError(`unknown style: ${String(styleId)}`)
  const id = String(sessionId ?? '')
  if (id === '') throw new TypeError('sessionId is required')
  const sessions = { ...(state?.sessions ?? {}), [id]: { style: styleId, at: Number(now) || 0 } }
  const kept = Object.entries(sessions)
    .sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0))
    .slice(0, MAX_SESSIONS)
  return {
    version: 1,
    default: isStyleId(state?.default) ? state.default : DEFAULT_STYLE,
    customTemperature: state?.customTemperature ?? null,
    customLabel: state?.customLabel ?? null,
    customTier: state?.customTier === 2 ? 2 : 1,
    sessions: Object.fromEntries(kept)
  }
}

/**
 * 把风格文件正文包成注入块 —— **外壳与上游 `buildStylePromptBlock()` 逐字一致**。
 *
 * 那两行"不得修改角色身份、事实记忆、工具规则、安全约束"很关键：它把"风格"限定在
 * 措辞 / 句式 / 语气 / 信息密度上，避免和本轮任务事实打架。
 * @param markdown - 风格文件正文。
 * @returns 注入文本；空内容返回空串。
 */
export function buildStyleBlock(markdown, marker) {
  const trimmed = String(markdown ?? '').trim()
  if (trimmed === '') return ''
  const lines = [
    '[表达风格]',
    '以下内容仅用于控制措辞、句式、语气和信息密度。',
    '不得修改角色身份、事实记忆、工具规则、安全约束及硬性行为规则。',
    ''
  ]
  const note = String(marker ?? '').trim()
  if (note !== '') lines.push(note, '')
  lines.push(trimmed)
  return lines.join('\n')
}

/**
 * 强度档的**授权标记**：由插件按状态文件里的 `customTier` 写死，不靠模型判断。
 *
 * 为什么要有它：只说"用户明确同意才进第二档"是把判断交给模型，而模型很容易把
 * 一句玩笑当成点头。写进标记后，模型看到的是确定的事实（已授权 / 未授权）。
 * @param tier - 1 或 2。
 * @returns 一行标记文本。
 */
export function tierMarker(tier) {
  return Number(tier) === 2
    ? '【授权状态】用户已在设置中显式开启第二档：可以使用更直接、更冷的占有表达；「底线」仍然适用。'
    : '【授权状态】当前为第一档（未开启第二档）：不要使用第二档的表达（直接宣告独占、压迫感台词、冷下来的语气）。'
}

/** 风格文件正文缓存：path+mtime+size → 文本。文件小、读得也不频繁，够用。 */
const textCache = new Map()

/**
 * 读某档的风格正文。custom 档读用户自己的文件（没有就当空，即"不注入"）。
 * @param styleId - 档位名。
 * @param options - `{ dir, customPath }`。
 * @returns 正文；读不到返回空串。
 */
export function readStyleText(styleId, options) {
  const id = normalizeStyleId(styleId)
  const file = id === 'custom' ? options?.customPath : join(options?.dir ?? '', STYLES[id].file)
  if (typeof file !== 'string' || file === '') return ''
  try {
    if (!existsSync(file)) return ''
    const stat = statSync(file)
    const key = `${file}:${stat.mtimeMs}:${stat.size}`
    const cached = textCache.get(key)
    if (cached !== undefined) return cached
    const text = readFileSync(file, 'utf8')
    textCache.set(key, text)
    return text
  } catch {
    return ''
  }
}

/**
 * 命令里列出可选档位。
 * @param state - 状态。
 * @param sessionId - 会话 id。
 * @returns 人读的文本。
 */
function listStyles(state, sessionId) {
  const current = resolveStyle(state, sessionId)
  const lines = ['当前表达风格：' + STYLES[current].label, '', '可选：']
  for (const [id, style] of Object.entries(STYLES)) {
    const t = temperatureFor(id, state)
    const mark = id === current ? ' ←当前' : ''
    const temp = t === undefined ? '温度跟随模型默认' : `温度 ${t}`
    lines.push(`  /style ${id}  ${style.label}（${temp}）${mark}`)
  }
  lines.push('', '切换只影响当前会话；/style default 可回到默认档。')
  return lines.join('\n')
}

/**
 * 插件入口（会话级）。
 * @param ctx - 插件上下文。
 * @param config - 可选覆盖：`storePath` / `dir` / `customPath`（测试与自用改路径）。
 */
export function apply(ctx, config = {}) {
  const disabledPresets = Array.isArray(config.disabledPresets) ? config.disabledPresets : DISABLED_PRESETS
  const storePath = config.storePath || join(HOME, 'cyrene-style.json')
  const styleDir = config.dir || join(HERE, 'styles')
  const customPath = config.customPath || join(HOME, 'cyrene-style-custom.md')

  // ── 风格提示词：请求尾部，每轮重算 ──────────────────────────────────────
  ctx.systemPrompt.context({
    name: 'cyrene:style',
    // 常驻世界书是 140；上游顺序里风格在常驻世界书之前。
    order: 130,
    text: (context) => {
      const session = context?.agent?.session
      if (isStyleDisabled(presetIdOf(session), disabledPresets)) return ''
      const sessionId = session?.id ?? ''
      const state = readState(storePath)
      const styleId = resolveStyle(state, sessionId)
      const text = readStyleText(styleId, { dir: styleDir, customPath })
      // 两档强度只对 custom 档有意义；内置五档不带标记。
      const marker = styleId === 'custom' ? tierMarker(state.customTier) : ''
      return buildStyleBlock(text, marker)
    }
  })

  // ── 温度：agent/request 瀑布 ────────────────────────────────────────────
  ctx.on('agent/request', async (payload, next) => {
    const callConfig = await next()
    if (callConfig === null || typeof callConfig !== 'object') return callConfig
    const session = payload?.agent?.session
    if (isStyleDisabled(presetIdOf(session), disabledPresets)) return callConfig
    const sessionId = session?.id ?? ''
    const state = readState(storePath)
    const temperature = temperatureFor(resolveStyle(state, sessionId), state)
    // default 档 / custom 未设温度：**原样返回**，不要写成 temperature: undefined
    // （DSH 的请求头是冻结对象，多一个键也算变化，会平白产生 change 事件）。
    if (temperature === undefined) return callConfig
    return { ...callConfig, temperature }
  })

  // ── /style 命令：每会话切换（commands 服务不存在时只是没有入口，不影响注入）──
  ctx.inject(['commands'], (commandsCtx) => {
    commandsCtx.effect(
      () => commandsCtx.commands.register({
        name: 'style',
        description: '切换昔涟的表达风格（按会话生效，例如 /style lively）',
        input: { hint: '(default| lively|healing|focused|sweet|custom)，留空列出全部' },
        handler: (invocation) => {
          const sessionId = String(invocation?.agent?.session?.id ?? '')
          const raw = String(invocation?.rawInput ?? '').trim().toLowerCase()
          const state = readState(storePath)

          if (raw === '' || raw === 'list') {
            return { kind: 'success', text: listStyles(state, sessionId) }
          }
          if (!isStyleId(raw)) {
            return {
              kind: 'error',
              text: `没有「${raw}」这个风格。可选：${Object.keys(STYLES).join(' / ')}`
            }
          }
          if (raw === 'custom' && readStyleText('custom', { customPath }) === '') {
            return {
              kind: 'error',
              text: `自定义档需要先写 ${customPath}（内容会原样作为风格提示词注入）。`
            }
          }
          if (sessionId === '') {
            return { kind: 'error', text: '拿不到当前会话 id，无法设置风格。' }
          }
          if (!writeState(storePath, chooseStyle(state, sessionId, raw))) {
            return { kind: 'error', text: `写入 ${storePath} 失败，风格未切换。` }
          }
          const t = temperatureFor(raw, state)
          const tail = t === undefined
            ? '温度跟随模型默认。'
            : `温度 ${t}（若当前模型开着思考，温度可能不生效）。`
          return { kind: 'success', text: `已切换到「${labelOf(state, raw)}」，只影响当前会话。${tail}` }
        }
      }),
      'cyrene-style command'
    )
  })
}

export const inject = ['systemPrompt']
