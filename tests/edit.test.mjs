/**
 * 「编辑最后一条用户消息」——表面折叠 / 可编辑判定 / 设置接口。
 *
 * 这件事靠的是 DSH 会话的**表面替换**（`surfaceOp: { op:'replace', startSeq, endSeq }`）：
 * 旧事件留在 append-only 日志里，只是不再进入模型可见的历史。所以这里的测试重点：
 *   1. 折叠规则与 dsh-session 一致（替换后节点被顶掉、顺序不乱、日志-only 事件不参与）；
 *   2. 什么情况下**拒绝**编辑（还在跑工具 / 带附件 / 没消息）；
 *   3. 接口到底给 `session.append` 传了什么 —— 端点与 `sourceEventSeqs` 必须一个不差，
 *      否则 dsh-session 会当场抛错（缺被遮蔽节点）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

const { foldSurface, planEdit, handleEditApi } = await import('../index.js')

const userEv = (seq, text, source = { kind: 'user' }) => ({
  seq,
  type: 'user/message',
  data: { id: `u${seq}`, role: 'user', source, content: [{ type: 'text', text }] }
})
const assistantEv = (seq, text = '嗯。') => ({
  seq,
  type: 'assistant/message',
  data: { message: { id: `a${seq}`, role: 'assistant', content: [{ type: 'text', text }] } }
})
const toolEv = (seq) => ({
  seq,
  type: 'tool/result',
  data: { message: { id: `t${seq}`, role: 'tool', source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'tool-result', toolCallId: 'c1', content: [] }] } }
})
const markerEv = (seq) => ({ seq, type: 'agent-preset/selected', data: { agentPreset: 'chat' } })
const replaceEv = (seq, startSeq, endSeq, text) => ({
  ...userEv(seq, text),
  surfaceOp: { op: 'replace', startSeq, endSeq },
  sourceEventSeqs: Array.from({ length: endSeq - startSeq + 1 }, (_, i) => startSeq + i)
})

/** 造一个最小 session：只实现接口用到的 seq / snapshotEvents / append。 */
function fakeSession(events) {
  const appended = []
  return {
    seq: events.length,
    snapshotEvents: (from = 0, to = events.length) => events.slice(from, to),
    append: (type, data, opts) => {
      appended.push({ type, data, opts })
      return { seq: events.length, type, data }
    },
    appended
  }
}

function fakeReq(method, url, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body, 'utf8'))
    req.emit('end')
  })
  return req
}

function fakeRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; return this },
    end(body) { this.body = String(body ?? '') },
    get json() { return JSON.parse(this.body) }
  }
}

// ───────────────────────── 表面折叠 ─────────────────────────

test('折叠：纯追加，日志-only 事件不参与表面', () => {
  const events = [userEv(1, '你好'), markerEv(2), assistantEv(3)]
  assert.deepEqual(foldSurface(events), [1, 3])
})

test('折叠：替换把整段节点顶掉，新节点占据原位置', () => {
  const events = [userEv(1, '旧'), assistantEv(2), replaceEv(3, 1, 2, '新')]
  assert.deepEqual(foldSurface(events), [3], '表面只剩替换事件')
})

test('折叠：替换只盖前半段时，后半段保留', () => {
  const events = [userEv(1, 'A'), assistantEv(2), userEv(3, 'B'), assistantEv(4)]
  const events2 = [...events, replaceEv(5, 3, 4, 'B2')]
  assert.deepEqual(foldSurface(events2), [1, 2, 5], '前一轮保留，后一轮被换掉')
})

test('折叠：连续替换（改两次）只留最后一次', () => {
  const events = [userEv(1, '初稿'), assistantEv(2), replaceEv(3, 1, 2, '改一'), replaceEv(4, 3, 3, '改二')]
  assert.deepEqual(foldSurface(events), [4])
})

test('折叠：端点已被盖掉的坏替换被跳过，不抛错', () => {
  const events = [userEv(1, '甲'), assistantEv(2), replaceEv(3, 1, 2, '乙'), replaceEv(4, 1, 2, '丙')]
  assert.deepEqual(foldSurface(events), [3], '第二次替换的端点已不在表面，应被跳过')
})

// ───────────────────────── 能不能改 ─────────────────────────

test('判定：已回复的一轮 → 可改，替换范围到表面末尾', () => {
  const plan = planEdit([userEv(1, '你好'), assistantEv(2)])
  assert.equal(plan.ok, true)
  assert.equal(plan.text, '你好')
  assert.equal(plan.startSeq, 1)
  assert.equal(plan.endSeq, 2)
  assert.deepEqual(plan.shadowed, [1, 2], 'truncate 要连回复一起盖掉')
  assert.deepEqual(plan.singleShadowed, [1], 'keep 只盖这一条')
  assert.equal(plan.singleStartSeq, 1)
  assert.equal(plan.singleEndSeq, 1)
  assert.deepEqual(plan.source, { kind: 'user' })
})

test('判定：还没回复（表面最后就是用户消息）→ 也能改', () => {
  const plan = planEdit([userEv(1, '第一句'), assistantEv(2), userEv(3, '还没回')])
  assert.equal(plan.ok, true)
  assert.equal(plan.startSeq, 3)
  assert.equal(plan.endSeq, 3)
})

test('判定：只认最后一条用户消息（前面的不动）', () => {
  const plan = planEdit([userEv(1, '旧'), assistantEv(2), userEv(3, '新'), assistantEv(4)])
  assert.equal(plan.startSeq, 3, '必须是最新那条')
  assert.deepEqual(plan.shadowed, [3, 4])
})

test('判定：插件注入的消息不算用户输入', () => {
  const plan = planEdit([
    userEv(1, '真话'),
    assistantEv(2),
    userEv(3, '【场景】', { kind: 'plugin:dsh-cyrene/scene' })
  ])
  assert.equal(plan.ok, true)
  assert.equal(plan.text, '真话', '插件消息要跳过')
  assert.equal(plan.startSeq, 1)
})

test('判定：还在跑工具 → 拒绝', () => {
  const plan = planEdit([userEv(1, '查一下'), toolEv(2)])
  assert.equal(plan.ok, false)
  assert.ok(plan.reason.includes('工具'))
})

test('判定：带图片 / 文件的消息 → 拒绝（替换只带文本，附件会丢）', () => {
  const event = userEv(1, '看这个')
  event.data.content = [{ type: 'text', text: '看这个' }, { type: 'image', attachmentId: 'x' }]
  const plan = planEdit([event, assistantEv(2)])
  assert.equal(plan.ok, false)
  assert.ok(plan.reason.includes('图片'))
})

test('判定：没有消息 / 只有助手消息 → 拒绝并说清楚', () => {
  assert.equal(planEdit([]).ok, false)
  const plan = planEdit([assistantEv(1)])
  assert.equal(plan.ok, false)
  assert.ok(plan.reason.includes('你发的消息'))
})

test('判定：编辑过的会话还能再编辑（在替换后的表面上）', () => {
  const events = [userEv(1, '初稿'), assistantEv(2), replaceEv(3, 1, 2, '改一')]
  const plan = planEdit(events)
  assert.equal(plan.ok, true)
  assert.equal(plan.text, '改一')
  assert.equal(plan.startSeq, 3)
  assert.equal(plan.endSeq, 3)
  assert.deepEqual(plan.shadowed, [3])
})

// ───────────────────────── 接口 ─────────────────────────

test('接口：GET 返回最后一条用户消息与可编辑性', async () => {
  const session = fakeSession([userEv(1, '你好'), assistantEv(2)])
  const res = fakeRes()
  await handleEditApi(fakeReq('GET', '/cyrene-edit-api?session=s1'), res, { get: (id) => (id === 's1' ? session : undefined) })
  assert.equal(res.status, 200)
  assert.deepEqual({ canEdit: res.json.canEdit, text: res.json.text }, { canEdit: true, text: '你好' })
})

test('接口：GET 不可编辑时也回 200，附原因', async () => {
  const session = fakeSession([userEv(1, '查'), toolEv(2)])
  const res = fakeRes()
  await handleEditApi(fakeReq('GET', '/cyrene-edit-api?session=s1'), res, { get: () => session })
  assert.equal(res.status, 200)
  assert.equal(res.json.canEdit, false)
  assert.ok(res.json.reason.includes('工具'))
})

test('接口：GET 找不到会话 → 404', async () => {
  const res = fakeRes()
  await handleEditApi(fakeReq('GET', '/cyrene-edit-api?session=nope'), res, { get: () => undefined })
  assert.equal(res.status, 404)
})

test('接口：POST 默认 keep —— 只换这一条，后续回复保留', async () => {
  const session = fakeSession([userEv(1, '旧话'), assistantEv(2), markerEv(3)])
  const res = fakeRes()
  await handleEditApi(
    fakeReq('POST', '/cyrene-edit-api', JSON.stringify({ sessionId: 's1', text: '新话' })),
    res,
    { get: () => session }
  )
  assert.equal(res.status, 200)
  assert.equal(res.json.mode, 'keep')
  assert.equal(session.appended.length, 1)
  const { type, data, opts } = session.appended[0]
  assert.equal(type, 'user/message')
  assert.equal(data.role, 'user')
  assert.equal(data.content[0].text, '新话')
  assert.equal(typeof data.id, 'string')
  assert.ok(data.id.length > 0, '必须带非空 id，否则事件校验会抛错')
  assert.equal(data.source.kind, 'user', 'source 沿用原消息')
  assert.deepEqual(opts.surfaceOp, { op: 'replace', startSeq: 1, endSeq: 1 }, '只替换那一条用户消息')
  assert.deepEqual(opts.sourceEventSeqs, [1], '只遮蔽它自己')
})

test('接口：POST mode=truncate —— 连同后续一起撤回', async () => {
  const session = fakeSession([userEv(1, '旧话'), assistantEv(2), markerEv(3)])
  const res = fakeRes()
  await handleEditApi(
    fakeReq('POST', '/cyrene-edit-api', JSON.stringify({ sessionId: 's1', text: '新话', mode: 'truncate' })),
    res,
    { get: () => session }
  )
  assert.equal(res.status, 200)
  assert.equal(res.json.mode, 'truncate')
  const { opts } = session.appended[0]
  assert.deepEqual(opts.surfaceOp, { op: 'replace', startSeq: 1, endSeq: 2 }, '范围 = 那条消息到表面末尾')
  assert.deepEqual(opts.sourceEventSeqs, [1, 2], '被遮蔽的表面节点一个不能少')
})

test('接口：mode 写错 → 400，且不写日志', async () => {
  const session = fakeSession([userEv(1, '旧话'), assistantEv(2)])
  const res = fakeRes()
  await handleEditApi(
    fakeReq('POST', '/cyrene-edit-api', JSON.stringify({ sessionId: 's1', text: '新话', mode: 'replace' })),
    res,
    { get: () => session }
  )
  assert.equal(res.status, 400)
  assert.equal(session.appended.length, 0)
})

test('接口：POST 空文本 / 未知会话 / 不可编辑各有回应', async () => {
  const session = fakeSession([userEv(1, '查'), toolEv(2)])
  const empty = fakeRes()
  await handleEditApi(fakeReq('POST', '/cyrene-edit-api', JSON.stringify({ sessionId: 's1', text: '   ' })), empty, { get: () => session })
  assert.equal(empty.status, 400)

  const missing = fakeRes()
  await handleEditApi(fakeReq('POST', '/cyrene-edit-api', JSON.stringify({ sessionId: 'x', text: '你好' })), missing, { get: () => undefined })
  assert.equal(missing.status, 404)

  const busy = fakeRes()
  await handleEditApi(fakeReq('POST', '/cyrene-edit-api', JSON.stringify({ sessionId: 's1', text: '你好' })), busy, { get: () => session })
  assert.equal(busy.status, 409)
  assert.equal(session.appended.length, 0, '拒绝时不能写日志')
})

test('接口：坏 JSON / 错误方法', async () => {
  const bad = fakeRes()
  await handleEditApi(fakeReq('POST', '/cyrene-edit-api', '{不是 JSON'), bad, { get: () => fakeSession([]) })
  assert.equal(bad.status, 400)

  const wrong = fakeRes()
  await handleEditApi(fakeReq('PUT', '/cyrene-edit-api'), wrong, { get: () => fakeSession([]) })
  assert.equal(wrong.status, 405)
})
