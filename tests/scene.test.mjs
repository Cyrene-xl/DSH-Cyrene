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
  apply,
  enterMarker,
  extractScene,
  isSceneLike,
  latestUserText
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
  const ctx = { on: (name, fn) => { if (name === 'agent/pre-step') listeners.push(fn) } }
  return { ctx, listeners }
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
