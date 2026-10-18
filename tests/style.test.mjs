/**
 * style.js（表达风格档位）的单元测试。
 *
 * 分两层：
 *   - 纯函数：档位表 / 状态读写 / 会话解析 / 温度映射 / 注入块外壳
 *   - 接线：用假 ctx 跑 apply()，验证 context() 的 name+order、agent/request 只在
 *     非 default 时加温度、以及 /style 命令真的按会话写状态
 *
 * 状态文件与风格目录都用临时路径（config 注入），**绝不碰真实的 ~/.dsh**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  STYLES,
  apply,
  buildStyleBlock,
  chooseStyle,
  isStyleDisabled,
  isStyleId,
  labelOf,
  tierMarker,
  normalizeStyleId,
  presetIdOf,
  readState,
  readStyleText,
  resolveStyle,
  temperatureFor,
  writeState
} from '../style.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const STYLE_DIR = join(repoRoot, 'styles')
const TMP = mkdtempSync(join(tmpdir(), 'cyrene-style-test-'))

/** 每次测试一个干净的状态文件。 */
function freshStore(name) {
  return join(TMP, `${name}.json`)
}

/** 假 ctx：捕获 context 注册、钩子、命令。 */
function mockCtx() {
  const contexts = []
  const handlers = new Map()
  const commands = []
  const ctx = {
    systemPrompt: { context: (spec) => contexts.push(spec) },
    on: (name, fn) => { handlers.set(name, fn) },
    inject: (_deps, cb) => {
      cb({
        effect: (fn) => fn(),
        commands: { register: (definition) => { commands.push(definition); return () => {} } }
      })
    }
  }
  return { ctx, contexts, handlers, commands }
}

// ───────────────────────── 档位表 ─────────────────────────

test('档位表：五档内置 + custom，温度与上游一致', () => {
  assert.deepEqual(Object.keys(STYLES), ['default', 'lively', 'healing', 'focused', 'sweet', 'custom'])
  // 上游 BUILT_IN_STYLE_PRESETS：lively 0.90 / healing 0.55 / focused 0.40 / sweet 0.82；
  // default 在代码里被跳过（不设采样），所以这里是 null 而不是 0.65。
  assert.equal(STYLES.default.temperature, null)
  assert.equal(STYLES.lively.temperature, 0.9)
  assert.equal(STYLES.healing.temperature, 0.55)
  assert.equal(STYLES.focused.temperature, 0.4)
  assert.equal(STYLES.sweet.temperature, 0.82)
  assert.equal(STYLES.custom.temperature, null)
  assert.equal(STYLES.custom.file, null, 'custom 读用户自己的文件')
})

test('档位表：五份风格文件都在，且正文非空、标题对得上', () => {
  const expected = {
    default: '风格：温柔・和善',
    lively: '风格：元气・活泼',
    healing: '风格：治愈・安心',
    focused: '风格：知性・认真',
    sweet: '风格：撒娇・黏人'
  }
  for (const [id, heading] of Object.entries(expected)) {
    const text = readStyleText(id, { dir: STYLE_DIR })
    assert.ok(text.length > 100, `${id} 的风格文件太短，可能是空文件`)
    assert.ok(text.includes(heading), `${id} 的风格文件标题不对：${heading}`)
  }
})

test('档位归一：非法值一律退 default', () => {
  assert.equal(normalizeStyleId('lively'), 'lively')
  assert.equal(normalizeStyleId('LIVELY'), 'default', '大小写不同不算合法')
  assert.equal(normalizeStyleId(''), 'default')
  assert.equal(normalizeStyleId(undefined), 'default')
  assert.equal(normalizeStyleId(null), 'default')
  assert.equal(isStyleId('custom'), true)
  assert.equal(isStyleId('constructor'), false, '不能把原型链上的键当成合法档位')
})

// ───────────────────────── 注入块外壳 ─────────────────────────

test('注入块：外壳与上游 buildStylePromptBlock() 逐字一致', () => {
  const block = buildStyleBlock('正文内容')
  assert.deepEqual(block.split('\n'), [
    '[表达风格]',
    '以下内容仅用于控制措辞、句式、语气和信息密度。',
    '不得修改角色身份、事实记忆、工具规则、安全约束及硬性行为规则。',
    '',
    '正文内容'
  ])
})

test('注入块：空内容返回空串（不注入空壳）', () => {
  assert.equal(buildStyleBlock(''), '')
  assert.equal(buildStyleBlock('   \n\t '), '')
  assert.equal(buildStyleBlock(undefined), '')
})

// ───────────────────────── 状态 ─────────────────────────

test('状态：文件不存在 → 空状态，不抛', () => {
  const state = readState(freshStore('missing'))
  assert.equal(state.default, 'default')
  assert.deepEqual(state.sessions, {})
  assert.equal(state.customTemperature, null)
})

test('状态：坏 JSON / 形状不对 → 空状态，不抛', () => {
  const file = freshStore('corrupt')
  writeFileSync(file, '{ 这不是 json', 'utf8')
  assert.equal(readState(file).default, 'default')
  writeFileSync(file, '[]', 'utf8')
  assert.equal(readState(file).default, 'default')
  writeFileSync(file, 'null', 'utf8')
  assert.equal(readState(file).default, 'default')
})

test('状态：非法档位、非法时间戳在读取时被过滤掉', () => {
  const file = freshStore('sanitize')
  writeFileSync(file, JSON.stringify({
    default: 'nonsense',
    customTemperature: 9,
    sessions: {
      good: { style: 'lively', at: 123 },
      badStyle: { style: 'nonsense', at: 1 },
      badShape: 'lively',
      '': { style: 'sweet', at: 2 }
    }
  }), 'utf8')
  const state = readState(file)
  assert.equal(state.default, 'default')
  assert.equal(state.customTemperature, null, '超出 0–2 的温度视为非法')
  assert.deepEqual(Object.keys(state.sessions), ['good'])
  assert.deepEqual(state.sessions.good, { style: 'lively', at: 123 })
})

test('状态：customTemperature 的 null / 0 / 字符串三态必须分清', () => {
  // 这条是一个真实 bug 的回归：以前用 Number(raw.customTemperature) 归一，
  // null 会被转成 0，而 0 是**合法**温度（确定性采样）—— 于是"没配温度"被读成
  // "温度=0"，custom 档静默变成全确定输出。
  const file = freshStore('custom-temp')
  writeFileSync(file, JSON.stringify({ customTemperature: null }), 'utf8')
  assert.equal(readState(file).customTemperature, null, 'null 依然是"没配"')

  writeFileSync(file, JSON.stringify({ customTemperature: 0 }), 'utf8')
  assert.equal(readState(file).customTemperature, 0, '0 是合法温度，必须保留')

  writeFileSync(file, JSON.stringify({ customTemperature: '0.8' }), 'utf8')
  assert.equal(readState(file).customTemperature, null, '字符串不算配了温度')

  writeFileSync(file, JSON.stringify({ customTemperature: 2.5 }), 'utf8')
  assert.equal(readState(file).customTemperature, null, '越界仍是非法')
});

test('状态：写进去能读回来', () => {
  const file = freshStore('roundtrip')
  const state = chooseStyle(readState(file), 'sess-1', 'sweet', 1000)
  assert.equal(writeState(file, state), true)
  const back = readState(file)
  assert.deepEqual(back.sessions['sess-1'], { style: 'sweet', at: 1000 })
})

test('会话解析：会话自己的选择优先，其次状态 default', () => {
  const state = { default: 'focused', customTemperature: null, sessions: { s1: { style: 'lively', at: 1 } } }
  assert.equal(resolveStyle(state, 's1'), 'lively')
  assert.equal(resolveStyle(state, 's2'), 'focused', '没有条目的会话用状态 default')
  assert.equal(resolveStyle(state, ''), 'focused', '拿不到会话 id 时退回 default')
  assert.equal(resolveStyle({ sessions: {} }, 's3'), 'default')
})

test('温度映射：default 不写、内置档给值、custom 看配置', () => {
  assert.equal(temperatureFor('default', {}), undefined, 'default 必须返回 undefined（不写 temperature）')
  assert.equal(temperatureFor('lively', {}), 0.9)
  assert.equal(temperatureFor('healing', {}), 0.55)
  assert.equal(temperatureFor('focused', {}), 0.4)
  assert.equal(temperatureFor('sweet', {}), 0.82)
  assert.equal(temperatureFor('custom', {}), undefined, 'custom 没配温度就不写')
  assert.equal(temperatureFor('custom', { customTemperature: 1.2 }), 1.2)
  assert.equal(temperatureFor('custom', { customTemperature: 5 }), undefined, '越界视为没配')
  assert.equal(temperatureFor('nonsense', {}), undefined)
})

test('选择记录：会话表按时间淘汰，最多 50 条', () => {
  let state = { default: 'default', customTemperature: null, sessions: {} }
  for (let i = 0; i < 55; i++) state = chooseStyle(state, `s${i}`, 'lively', 1000 + i)
  const keys = Object.keys(state.sessions)
  assert.equal(keys.length, 50)
  assert.ok(!keys.includes('s0'), '最老的应被淘汰')
  assert.ok(keys.includes('s54'), '最新的必须留着')
})

test('选择记录：非法档位或空会话 id 直接抛', () => {
  assert.throws(() => chooseStyle({ sessions: {} }, 's1', 'nonsense'), TypeError)
  assert.throws(() => chooseStyle({ sessions: {} }, '', 'lively'), TypeError)
})

// ───────────────────────── 工作模式禁用（安全保险） ─────────────────────────

test('预设识别：从会话日志取最后一次 agent-preset/selected', () => {
  const session = (events) => ({ snapshotEvents: () => events })
  assert.equal(presetIdOf(session([
    { type: 'agent-preset/selected', data: { agentPreset: 'cyrene-work' } },
    { type: 'agent-preset/selected', data: { agentPreset: 'chat' } }
  ])), 'chat', '取最后一次，不是第一次')
  assert.equal(presetIdOf(session([])), '', '没有事件就是未知')
  assert.equal(presetIdOf(session([{ type: 'user/message', data: {} }])), '')
  assert.equal(presetIdOf(session([{ type: 'agent-preset/selected', data: {} }])), '')
  assert.equal(presetIdOf(undefined), '', '没有会话不能抛')
  assert.equal(presetIdOf({ snapshotEvents: () => { throw new Error('boom') } }), '')
})

test('禁用判定：工作模式禁用，对话模式不禁用', () => {
  assert.equal(isStyleDisabled('cyrene-work'), true)
  assert.equal(isStyleDisabled('chat'), false)
  assert.equal(isStyleDisabled(''), false, '未知（空串）不应该被当成禁用')
  assert.equal(isStyleDisabled(undefined), false)
  assert.equal(isStyleDisabled('whatever'), false)
  assert.equal(isStyleDisabled('other', ['other']), true, '清单可由配置覆盖')
})

test('接线：工作模式的会话既拿不到风格文本，也不会被改温度', async () => {
  const { ctx, contexts, handlers } = mockCtx()
  const storePath = freshStore('wire-disabled')
  // 故意存成 sweet，确认是被预设拦掉的，而不是因为"默认档"
  writeState(storePath, chooseStyle(readState(storePath), 'work-1', 'sweet', 1))
  apply(ctx, { storePath, dir: STYLE_DIR, customPath: join(TMP, 'none.md') })

  const workSession = {
    id: 'work-1',
    snapshotEvents: () => [{ type: 'agent-preset/selected', data: { agentPreset: 'cyrene-work' } }]
  }
  assert.equal(contexts[0].text({ agent: { session: workSession } }), '', '工作模式禁止注入风格')
  const config = { provider: 'p', model: 'm', reasoningEffort: 'high' }
  const out = await handlers.get('agent/request')({ agent: { session: workSession } }, async () => config)
  assert.equal(out, config, '工作模式禁止改温度')

  const chatSession = {
    id: 'work-1',
    snapshotEvents: () => [{ type: 'agent-preset/selected', data: { agentPreset: 'chat' } }]
  }
  assert.ok(contexts[0].text({ agent: { session: chatSession } }).includes('风格：撒娇'), '同一个会话换到对话预设就生效')
  const out2 = await handlers.get('agent/request')({ agent: { session: chatSession } }, async () => config)
  assert.equal(out2.temperature, 0.82)
})

test('显示名：custom 档可以用 customLabel 改名（只影响显示）', () => {
  const file = freshStore('custom-label')
  writeFileSync(file, JSON.stringify({ customLabel: '  我的风格  ' }), 'utf8')
  const state = readState(file)
  assert.equal(state.customLabel, '我的风格', '前后空白应被裁掉')
  assert.equal(labelOf(state, 'custom'), '我的风格')
  assert.equal(labelOf(state, 'lively'), '元气・活泼', '内置档位不受影响')

  writeFileSync(file, JSON.stringify({ customLabel: '' }), 'utf8')
  assert.equal(readState(file).customLabel, null, '空串视为没设')
  assert.equal(labelOf(readState(file), 'custom'), '自定义', '没设时用默认显示名')

  writeFileSync(file, JSON.stringify({ customLabel: 'x'.repeat(40) }), 'utf8')
  assert.equal(readState(file).customLabel.length, 16, '显示名限长 16')
})

test('显示名：选择记录会保留 customLabel', () => {
  const state = chooseStyle({ customLabel: '我的风格', sessions: {} }, 's1', 'lively', 1)
  assert.equal(state.customLabel, '我的风格')
})

test('强度档：customTier 只认 2，其余一律当第一档', () => {
  const file = freshStore('tier')
  writeFileSync(file, JSON.stringify({ customTier: 2 }), 'utf8')
  assert.equal(readState(file).customTier, 2)
  writeFileSync(file, JSON.stringify({ customTier: 3 }), 'utf8')
  assert.equal(readState(file).customTier, 1, '越界视为第一档')
  writeFileSync(file, JSON.stringify({ customTier: '2' }), 'utf8')
  assert.equal(readState(file).customTier, 2, '数字字符串也认（手改 JSON 常见）')
  writeFileSync(file, JSON.stringify({}), 'utf8')
  assert.equal(readState(file).customTier, 1, '没写就是第一档')
})

test('强度档：授权标记由插件写死，两档文字不同', () => {
  const on = tierMarker(2)
  const off = tierMarker(1)
  assert.ok(on.includes('已在设置中显式开启第二档'))
  assert.ok(off.includes('未开启第二档'))
  assert.notEqual(on, off)
})

test('强度档：注入块里的标记只在 custom 档出现，且两档可区分', () => {
  const customPath = join(TMP, 'tier-custom.md')
  writeFileSync(customPath, '# 我的风格\n说话短一点。\n', 'utf8')
  const { ctx, contexts } = mockCtx()
  const storePath = freshStore('tier-inject')
  writeState(storePath, chooseStyle(readState(storePath), 's1', 'custom', 1))
  apply(ctx, { storePath, dir: STYLE_DIR, customPath })

  const session = { id: 's1', snapshotEvents: () => [{ type: 'agent-preset/selected', data: { agentPreset: 'chat' } }] }
  const block = contexts[0].text({ agent: { session } })
  assert.ok(block.includes('【授权状态】'), 'custom 档必须带授权标记')
  assert.ok(block.includes('未开启第二档'), '默认是第一档')
  assert.ok(block.includes('我的风格'), '正文仍要在')

  writeState(storePath, { ...readState(storePath), customTier: 2 })
  const block2 = contexts[0].text({ agent: { session } })
  assert.ok(block2.includes('已在设置中显式开启第二档'), '打开第二档后标记应改变')
});

test('强度档：内置五档不带授权标记', () => {
  const { ctx, contexts } = mockCtx()
  const storePath = freshStore('tier-builtin')
  writeState(storePath, chooseStyle(readState(storePath), 's1', 'lively', 1))
  apply(ctx, { storePath, dir: STYLE_DIR, customPath: join(TMP, 'none.md') })
  const session = { id: 's1', snapshotEvents: () => [{ type: 'agent-preset/selected', data: { agentPreset: 'chat' } }] }
  const block = contexts[0].text({ agent: { session } })
  assert.ok(!block.includes('【授权状态】'), '内置档不需要授权标记')
})

// ───────────────────────── 接线 ─────────────────────────

test('接线：context() 注册名与 order（必须排在常驻世界书 140 之前）', () => {
  const { ctx, contexts } = mockCtx()
  apply(ctx, { storePath: freshStore('wire-context'), dir: STYLE_DIR, customPath: join(TMP, 'none.md') })
  assert.equal(contexts.length, 1)
  assert.equal(contexts[0].name, 'cyrene:style')
  assert.equal(contexts[0].order, 130)
  assert.equal(typeof contexts[0].text, 'function')
})

test('接线：注入内容按会话取档，默认档是 01_default 的正文', () => {
  const { ctx, contexts } = mockCtx()
  const storePath = freshStore('wire-inject')
  apply(ctx, { storePath, dir: STYLE_DIR, customPath: join(TMP, 'none.md') })
  const spec = contexts[0]

  const asDefault = spec.text({ agent: { session: { id: 's1' } } })
  assert.ok(asDefault.startsWith('[表达风格]\n'), '必须带外壳')
  assert.ok(asDefault.includes('风格：温柔・和善'), '默认档应注入 01_default')

  writeState(storePath, chooseStyle(readState(storePath), 's1', 'sweet', 1))
  const asSweet = spec.text({ agent: { session: { id: 's1' } } })
  assert.ok(asSweet.includes('风格：撒娇・黏人'), '切换后应立即生效（每轮重算）')
  const otherSession = spec.text({ agent: { session: { id: 's2' } } })
  assert.ok(otherSession.includes('风格：温柔・和善'), '别的会话不受影响')
})

test('接线：agent/request 只在非 default 档写温度，default 原样返回同一个对象', async () => {
  const { ctx, handlers } = mockCtx()
  const storePath = freshStore('wire-request')
  apply(ctx, { storePath, dir: STYLE_DIR, customPath: join(TMP, 'none.md') })
  const handler = handlers.get('agent/request')
  assert.equal(typeof handler, 'function', '必须注册 agent/request')

  const config = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }
  const call = () => handler({ agent: { session: { id: 's1' } } }, async () => config)

  const asDefault = await call()
  assert.equal(asDefault, config, 'default 档不应产生新对象（多一个键也算请求头变化）')
  assert.equal('temperature' in asDefault, false)

  writeState(storePath, chooseStyle(readState(storePath), 's1', 'lively', 1))
  const asLively = await call()
  assert.equal(asLively.temperature, 0.9)
  assert.equal(asLively.model, config.model, '其它字段必须原样保留')
  assert.equal(asLively.provider, config.provider)
  assert.equal(config.temperature, undefined, '不能改动传入的 config 对象')
})

test('接线：/style 命令 —— 列档位、切档、拒绝未知档位', () => {
  const { ctx, commands } = mockCtx()
  const storePath = freshStore('wire-command')
  apply(ctx, { storePath, dir: STYLE_DIR, customPath: join(TMP, 'none.md') })
  assert.equal(commands.length, 1)
  const command = commands[0]
  assert.equal(command.name, 'style')
  const invocation = (rawInput) => ({ agent: { session: { id: 'sess-cmd' } }, rawInput })

  const listed = command.handler(invocation(''))
  assert.equal(listed.kind, 'success')
  assert.ok(listed.text.includes('/style custom'), '列表里应含 custom 档')
  for (const id of Object.keys(STYLES)) assert.ok(listed.text.includes(`/style ${id}`), `列表里缺 ${id}`)

  const switched = command.handler(invocation('focused'))
  assert.equal(switched.kind, 'success')
  assert.equal(readState(storePath).sessions['sess-cmd'].style, 'focused')

  const unknown = command.handler(invocation('nonsense'))
  assert.equal(unknown.kind, 'error')

  const customWithoutFile = command.handler(invocation('custom'))
  assert.equal(customWithoutFile.kind, 'error', 'custom 没写文件时应报错而不是静默不注入')
})

test('接线：custom 档读用户文件，内容原样进注入块', () => {
  const customPath = join(TMP, 'custom.md')
  writeFileSync(customPath, '## 我自己的风格\n说话简短。\n', 'utf8')
  const { ctx, contexts } = mockCtx()
  const storePath = freshStore('wire-custom')
  writeState(storePath, chooseStyle(readState(storePath), 's1', 'custom', 1))
  apply(ctx, { storePath, dir: STYLE_DIR, customPath })
  const text = contexts[0].text({ agent: { session: { id: 's1' } } })
  assert.ok(text.includes('## 我自己的风格'))
  assert.ok(text.startsWith('[表达风格]'))
})

test('清理临时目录', () => {
  assert.ok(existsSync(TMP))
  rmSync(TMP, { recursive: true, force: true })
  assert.ok(!existsSync(TMP))
  // 顺带确认测试没有污染真实状态文件
  assert.equal(existsSync(join(repoRoot, 'cyrene-style.json')), false)
})
