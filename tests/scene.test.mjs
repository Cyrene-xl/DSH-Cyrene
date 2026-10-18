/**
 * scene.js（角色扮演场景开关）的单元测试。
 *
 * 重点不是"能不能识别括号"，而是**状态机**：默认聊天、出现括号切场景、连续括号不再
 * 重复注入、没有括号了插一条"回到对话"、不同会话互不影响。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EXIT_MARKER,
  FORMS,
  apply,
  classifyScene,
  extractFormRequest,
  formBlock,
  enterMarker,
  extractScene,
  isSceneLike,
  latestUserText,
  looksLikeHerAction
} from '../scene.js'

/** 造一条本轮用户消息。 */
const userMsg = (text) => ({
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text }]
})

/** 假 ctx：捕获 agent/pre-step。 */
function mockCtx() {
  const listeners = []
  const contexts = []
  const tools = []
  const ctx = {
    systemPrompt: { context: (spec) => contexts.push(spec) },
    on: (name, fn) => { if (name === 'agent/pre-step') listeners.push(fn) },
    inject: (_deps, cb) => { cb({ tools: { register: (tool) => tools.push(tool) } }) }
  }
  return { ctx, listeners, contexts, tools }
}

/** 跑一轮 pre-step，返回它给出的 decision。 */
async function step(listener, messages, sessionId = 's1') {
  const decision = { kind: 'enter', messages: [...messages] }
  return listener({ agent: { session: { id: sessionId } }, messages }, async () => decision)
}

test('识别：括号内容像不像场景', () => {
  assert.equal(isSceneLike('雨夜'), true)
  assert.equal(isSceneLike('她笑'), true)
  assert.equal(isSceneLike('  雨夜  '), true, '首尾空白不算长度')
  assert.equal(isSceneLike('笑'), false, '单字中文太短（多半是表情提示）')
  assert.equal(isSceneLike('1'), false)
  assert.equal(isSceneLike('x'), false, 'print(x) 这类代码不应触发')
  assert.equal(isSceneLike('night, rain'), true, '纯 ASCII 要求更长，但长句仍然算')
  assert.equal(isSceneLike(''), false)
  assert.equal(isSceneLike('   '), false)
})

test('抽取：全角 / 半角 / 多段 / 去重 / 未闭合', () => {
  assert.deepEqual(extractScene('（雨夜，屋里只有一盏灯）你还记得这里吗').scenes, ['雨夜，屋里只有一盏灯'])
  assert.equal(extractScene('（雨夜，屋里只有一盏灯）你还记得这里吗').found, true)

  const half = extractScene('(a quiet night, rain outside) hello')
  assert.deepEqual(half.scenes, ['a quiet night, rain outside'])

  assert.deepEqual(extractScene('（她笑）（她笑）').scenes, ['她笑'], '同一段去重')
  assert.deepEqual(extractScene('（雨夜）（她把窗关上）').scenes, ['雨夜', '她把窗关上'], '多段都要')
  assert.equal(extractScene('（没闭合的括号').found, false)
  assert.equal(extractScene('没有括号').found, false)
  assert.equal(extractScene('').found, false)
  assert.equal(extractScene(undefined).found, false)
})

test('动作指令：括号里用「你」说的是她要做的事', () => {
  assert.equal(looksLikeHerAction('你亲了我一下'), true)
  assert.equal(looksLikeHerAction('你笑了'), true, '有动作痕迹就算')
  assert.equal(looksLikeHerAction('你在窗边坐下'), true)
  assert.equal(looksLikeHerAction('你真好'), false, '单纯夸奖不是动作')
  assert.equal(looksLikeHerAction('你还记得吗'), false, '问句不是动作')
  assert.equal(looksLikeHerAction('你愿意听我说吗？'), false)
  assert.equal(looksLikeHerAction('她亲了我一下'), false, '主语不是「你」')
  assert.equal(looksLikeHerAction('雨夜'), false)
  assert.equal(looksLikeHerAction(''), false)
})

test('动作指令：场景与动作能分开归类', () => {
  const one = classifyScene('（你亲了我一下）')
  assert.deepEqual(one.actions, ['你亲了我一下'])
  assert.deepEqual(one.scenes, [])

  const both = classifyScene('（雨夜，屋里只有一盏灯）（你把我抱住）')
  assert.deepEqual(both.scenes, ['雨夜，屋里只有一盏灯'])
  assert.deepEqual(both.actions, ['你把我抱住'])
  assert.equal(both.found, true)

  assert.equal(classifyScene('没有括号').found, false)
})

test('动作指令：标记里要写清"照做 + 用括号写出动作"', () => {
  const marker = enterMarker([{ raw: '你亲了我一下', kind: 'action' }])
  assert.ok(marker.includes('你的动作：你亲了我一下'))
  assert.ok(marker.includes('动作指令'))
  assert.ok(marker.includes('（亲了你一下）'), '要给出格式示例')
  assert.ok(marker.includes('不复述他的原句'))
})

test('动作指令：混合输入时场景与动作分别列在标记里', () => {
  const marker = enterMarker([
    { raw: '雨夜，屋里只有一盏灯', kind: 'scene' },
    { raw: '你把我抱住', kind: 'action' }
  ])
  assert.ok(marker.includes('- 场景：雨夜，屋里只有一盏灯'))
  assert.ok(marker.includes('- 你的动作：你把我抱住'))
})

test('取本轮用户文本：必须按 source 过滤掉插件标记', () => {
  const marker = {
    role: 'user',
    source: { kind: 'plugin:dsh-cyrene/scene' },
    content: [{ type: 'text', text: '【场景模式开启】…' }]
  }
  assert.equal(latestUserText([userMsg('第一句'), marker]), '第一句')
  assert.equal(latestUserText([marker]), '', '只有标记时没有用户输入')
  assert.equal(latestUserText([{ role: 'user', source: { kind: 'user' }, content: [{ type: 'image' }] }]), '')
  assert.equal(latestUserText([]), '')
  assert.equal(latestUserText(undefined), '')
})

test('标记：进场景 / 退场景两段文案不同，且都不复述提示', () => {
  const enter = enterMarker(['雨夜'])
  assert.ok(enter.includes('【场景模式开启】'))
  assert.ok(enter.includes('雨夜'))
  assert.ok(enter.includes('不要出戏'))
  assert.ok(EXIT_MARKER.includes('【回到普通对话】'))
  assert.notEqual(enter, EXIT_MARKER)
})

test('状态机：默认聊天 → 出现括号进场景 → 连续括号不重复 → 没括号回对话', async () => {
  const { ctx, listeners } = mockCtx()
  apply(ctx)
  assert.equal(listeners.length, 1, '必须注册 agent/pre-step')
  const listener = listeners[0]

  // 第 1 轮：普通对话，不注入任何东西
  const t1 = await step(listener, [userMsg('今天好累啊')])
  assert.equal(t1.messages.length, 1, '默认是聊天，不该插消息')

  // 第 2 轮：有场景括号 → 进场景
  const t2 = await step(listener, [userMsg('（雨夜，屋里只有一盏灯）你还记得这里吗')])
  assert.equal(t2.messages.length, 2, '应追加一条场景标记')
  const marker = t2.messages[1]
  assert.equal(typeof marker.id, 'string')
  assert.ok(marker.id.length > 0, 'id 不能为空（否则会话历史加载失败）')
  assert.equal(marker.source.kind, 'plugin:dsh-cyrene/scene', '必须是生产者自有的 kind')
  assert.notEqual(marker.source.kind, 'plugin')
  assert.ok(marker.content[0].text.includes('【场景模式开启】'))
  assert.ok(marker.content[0].text.includes('雨夜，屋里只有一盏灯'), '要把场景原文带进去')

  // 第 3 轮：还是场景 → 状态没变，不重复注入
  const t3 = await step(listener, [userMsg('（她把窗关上）嗯，我记得')])
  assert.equal(t3.messages.length, 1, '状态没变不该重复插标记')

  // 第 4 轮：没有括号 → 回普通对话
  const t4 = await step(listener, [userMsg('刚才那个话题继续')])
  assert.equal(t4.messages.length, 2)
  assert.ok(t4.messages[1].content[0].text.includes('【回到普通对话】'))

  // 第 5 轮：继续普通 → 不再插
  const t5 = await step(listener, [userMsg('嗯嗯')])
  assert.equal(t5.messages.length, 1)
})

test('状态机：不同会话各自独立', async () => {
  const { ctx, listeners } = mockCtx()
  apply(ctx)
  const listener = listeners[0]

  await step(listener, [userMsg('（雨夜）你好')], 'a')
  const b = await step(listener, [userMsg('（雨夜）你好')], 'b')
  assert.equal(b.messages.length, 2, 'b 自己的第一次进场景也要注入')
  const a2 = await step(listener, [userMsg('（雨夜）继续')], 'a')
  assert.equal(a2.messages.length, 1, 'a 已经在场景里，不该重复')
})

test('开关：enabled=false 时完全不动', async () => {
  const { ctx, listeners } = mockCtx()
  apply(ctx, { enabled: false })
  const out = await step(listeners[0], [userMsg('（雨夜）你还记得吗')])
  assert.equal(out.messages.length, 1)
})

// ───────────────────────── 形态切换 ─────────────────────────

test('形态：显式说法能解析（括号里的动作指令也算）', () => {
  assert.deepEqual(extractFormRequest('（你变成迷迷）'), { id: 'mimi', label: '迷迷' })
  assert.deepEqual(extractFormRequest('变回小昔涟吧'), { id: 'small', label: '小昔涟' })
  assert.deepEqual(extractFormRequest('切换成大昔涟'), { id: 'big', label: '大昔涟' })
  assert.deepEqual(extractFormRequest('现在你是迷迷了'), { id: 'mimi', label: '迷迷' })
  assert.deepEqual(extractFormRequest('用大昔涟的样子说话'), { id: 'big', label: '大昔涟' })
  assert.deepEqual(extractFormRequest('恢复原来的样子'), { id: '', label: '默认形态' })
  assert.equal(extractFormRequest('今天天气不错'), null)
  assert.equal(extractFormRequest('迷迷是谁'), null, '只提名字不算切换')
  assert.equal(extractFormRequest(''), null)
})

test('形态：注入块只在有形态时出现，且写明"人格不变"', () => {
  assert.equal(formBlock(''), '')
  assert.equal(formBlock('unknown'), '')
  assert.ok(formBlock('mimi').includes('【当前形态：迷迷】'))
  assert.ok(formBlock('big').includes('【当前形态：大昔涟】'))
  assert.ok(formBlock('small').includes('人格内核不变'))
  for (const id of Object.keys(FORMS)) {
    assert.ok(formBlock(id).includes('不要解释「我在切换形态」'))
  }
})

test('形态：切了之后按会话注入，换会话不受影响', async () => {
  const { ctx, listeners, contexts } = mockCtx()
  apply(ctx)
  const spec = contexts.find((c) => c.name === 'cyrene:form')
  assert.ok(spec, '必须注册 cyrene:form 上下文')
  assert.equal(spec.order, 125, '要夹在称呼 120 与风格 130 之间')

  const agentOf = (id) => ({ agent: { session: { id } } })
  assert.equal(spec.text(agentOf('a')), '', '默认形态不注入')

  await step(listeners[0], [userMsg('（你变成迷迷）')], 'a')
  assert.ok(spec.text(agentOf('a')).includes('【当前形态：迷迷】'), '本轮就应注入')
  assert.equal(spec.text(agentOf('b')), '', '别的会话不受影响')

  await step(listeners[0], [userMsg('恢复原来的样子')], 'a')
  assert.equal(spec.text(agentOf('a')), '', '恢复后不再注入')
})

test('形态：工具 set_form 处理暗示（拿得到会话 id）', () => {
  const { ctx, tools, contexts } = mockCtx()
  apply(ctx)
  const tool = tools.find((t) => t.name === 'set_form')
  assert.ok(tool, '必须注册 set_form')
  assert.ok(tool.description.includes('迷迷') && tool.description.includes('大昔涟'))

  const ok = tool.execute({ form: '迷迷' }, { agent: { session: { id: 'x' } } })
  assert.ok(ok.includes('迷迷'))
  const spec = contexts.find((c) => c.name === 'cyrene:form')
  assert.ok(spec.text({ agent: { session: { id: 'x' } } }).includes('【当前形态：迷迷】'))

  const bad = tool.execute({ form: '巨龙' }, { agent: { session: { id: 'x' } } })
  assert.ok(bad.includes('没有这个形态'))

  const noSession = tool.execute({ form: 'big' }, {})
  assert.ok(noSession.includes('拿不到当前会话'))
})

test('非 enter 的决策原样返回（别的插件接管了 pre-step 时不抢）', async () => {
  const { ctx, listeners } = mockCtx()
  apply(ctx)
  const decision = { kind: 'skip' }
  const out = await listeners[0](
    { agent: { session: { id: 's1' } }, messages: [userMsg('（雨夜）你好')] },
    async () => decision,
  )
  assert.equal(out, decision)
})
