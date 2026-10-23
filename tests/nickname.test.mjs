/**
 * nickname.js（称呼）的单元测试。
 *
 * 覆盖四件事：
 *   1. 两个字段与优先级：`callPreference`（怎么叫）> `nickname`（名字）> 默认「伙伴」；
 *   2. 显式改口（「以后叫我小明」）——确定性解析、分流到正确字段，不依赖模型；
 *   3. 每轮注入的称呼规则（含「用多少」与关系称呼推回）；
 *   4. 设置接口 `/cyrene-nickname-api`（浏览器半边的读写通道）。
 *
 * 用临时 DSH_HOME，**绝不碰真实配置文件**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'cyrene-nickname-test-'))
process.env.DSH_HOME = HOME

const mod = await import('../nickname.js')
const {
  DEFAULT_NICKNAME,
  apply,
  extractAddressRequest,
  extractNicknameRequest,
  loadNickname,
  loadProfile,
  nicknameContext,
  sanitize,
  saveCallPreference,
  saveField,
  saveNickname
} = mod
const { handleNicknameApi } = await import('../index.js')
const STORE = join(HOME, 'dsha-brand-rename.json')

/** 用一个全新的状态文件开始。 */
function reset(content) {
  if (content === undefined) {
    if (existsSync(STORE)) rmSync(STORE)
  } else {
    writeFileSync(STORE, content, 'utf8')
  }
}

/** 假 ctx：捕获变量 provider、上下文、pre-step 与工具。 */
function mockCtx() {
  const variables = new Map()
  const contexts = []
  const listeners = []
  const tools = []
  const ctx = {
    systemPrompt: {
      variable: (name, provider) => variables.set(name, provider),
      context: (spec) => contexts.push(spec)
    },
    on: (name, fn) => { if (name === 'agent/pre-step') listeners.push(fn) },
    inject: (_deps, cb) => {
      cb({ tools: { register: (tool) => tools.push(tool) } })
    }
  }
  return { ctx, variables, contexts, listeners, tools }
}

/** 跑一轮 pre-step。 */
async function step(listener, text) {
  const messages = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }]
  return listener({ agent: { session: { id: 's1' } }, messages }, async () => ({ kind: 'enter', messages }))
}

/** 最小 req/res，用来直测设置接口。 */
function fakeReq(method, body) {
  const req = new EventEmitter()
  req.method = method
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
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = String(body ?? '') },
    get json() { return JSON.parse(this.body) }
  }
}

// ───────────────────────── 清洗与存取 ─────────────────────────

test('清洗：换行 / 花括号 / 控制字符 / 超长', () => {
  assert.equal(sanitize('  小明  '), '小明')
  assert.equal(sanitize('小\n明'), '小 明', '换行压成空格')
  assert.equal(sanitize('{{user}}'), 'user', '花括号必须去掉，否则能往提示词里插变量')
  assert.equal(sanitize('a\u0001b'), 'ab')
  assert.equal(sanitize(''), '')
  assert.equal(sanitize(null), '')
  assert.equal(sanitize('x'.repeat(50)).length, 24, '限长 24')
})

test('读取：没有文件 / 坏 JSON / 非法值都退回默认', () => {
  reset()
  assert.equal(loadNickname(), '伙伴')
  assert.deepEqual(loadProfile(), { nickname: '', callPreference: '', address: DEFAULT_NICKNAME })

  reset('{ 坏掉的 json')
  assert.equal(loadNickname(), '伙伴')

  reset('[]')
  assert.equal(loadNickname(), '伙伴')

  reset(JSON.stringify({ nickname: '   ' }))
  assert.equal(loadNickname(), '伙伴')

  reset(JSON.stringify({ nickname: '小明' }))
  assert.equal(loadNickname(), '小明')
})

test('优先级：称呼偏好 > 昵称 > 默认', () => {
  reset(JSON.stringify({ nickname: '小明', callPreference: '老师' }))
  assert.deepEqual(loadProfile(), { nickname: '小明', callPreference: '老师', address: '老师' }, '称呼偏好优先')
  assert.equal(loadNickname(), '老师')

  reset(JSON.stringify({ nickname: '小明', callPreference: '   ' }))
  assert.equal(loadNickname(), '小明', '称呼偏好是空白就回落到昵称')

  reset(JSON.stringify({ callPreference: '老师' }))
  assert.equal(loadNickname(), '老师', '没有昵称也能只用称呼偏好')
})

test('写入：读-改-写，不能把文件里别的字段冲掉', () => {
  reset(JSON.stringify({ nickname: '旧名字', petVisible: false, theme: 'rose' }))
  assert.equal(saveNickname('新名字'), '新名字')
  let saved = JSON.parse(readFileSync(STORE, 'utf8'))
  assert.equal(saved.nickname, '新名字')
  assert.equal(saved.petVisible, false, '别的字段必须保留')
  assert.equal(saved.theme, 'rose')

  assert.equal(saveCallPreference('老师'), '老师', '称呼偏好优先，返回值就是生效称呼')
  saved = JSON.parse(readFileSync(STORE, 'utf8'))
  assert.equal(saved.callPreference, '老师')
  assert.equal(saved.nickname, '新名字')
  assert.equal(saved.petVisible, false, '两个字段都写也不许丢别的字段')
})

test('写入：空串表示清除该字段（回落）', () => {
  reset(JSON.stringify({ nickname: '小明', callPreference: '老师' }))
  assert.equal(saveField('callPreference', ''), '小明', '清掉称呼偏好后回落到昵称')
  assert.equal(JSON.parse(readFileSync(STORE, 'utf8')).callPreference, undefined, '字段被删掉而不是留空串')
  assert.equal(loadNickname(), '小明')

  assert.equal(saveField('nickname', ''), DEFAULT_NICKNAME, '两个都清掉就是默认称呼')
  assert.equal(loadNickname(), '伙伴')
})

test('写入：非法字段名不写文件', () => {
  reset(JSON.stringify({ nickname: '小明' }))
  const before = readFileSync(STORE, 'utf8')
  assert.equal(saveField('callPreference2', '老师'), '')
  assert.equal(readFileSync(STORE, 'utf8'), before, '文件不能被改动')
  assert.equal(saveField('__proto__', 'x'), '', '原型链上的名字也不许写')
})

// ───────────────────────── 显式改口解析 ─────────────────────────

test('解析：明确说法能抓到名字', () => {
  assert.equal(extractNicknameRequest('以后叫我小明'), '小明')
  assert.equal(extractNicknameRequest('叫我小宝吧'), '小宝', '句尾语气词要剥掉')
  assert.equal(extractNicknameRequest('称呼改成老师'), '老师')
  assert.equal(extractNicknameRequest('昵称换成阿哲'), '阿哲')
  assert.equal(extractNicknameRequest('就叫我哥哥'), '哥哥')
  assert.equal(extractNicknameRequest('从现在起喊我队长'), '队长')
  assert.equal(extractNicknameRequest('喊我一声老师'), '老师', '要剥掉「一声」')
  assert.equal(extractNicknameRequest('以后叫我「小满」吧'), '小满', '引号要剥掉')
  assert.equal(extractNicknameRequest('我名字是阿哲'), '阿哲')
})

test('解析：分流到正确的字段（昵称 vs 称呼偏好）', () => {
  assert.deepEqual(extractAddressRequest('以后叫我小明'), { field: 'callPreference', value: '小明' },
    '「叫我X」是称呼偏好，不是名字')
  assert.deepEqual(extractAddressRequest('称呼改成老师'), { field: 'callPreference', value: '老师' })
  assert.deepEqual(extractAddressRequest('昵称换成阿哲'), { field: 'nickname', value: '阿哲' },
    '说了「昵称/名字」才写 nickname')
  assert.deepEqual(extractAddressRequest('我的名字叫阿哲'), { field: 'nickname', value: '阿哲' })
})

test('解析：不该改口的一律不动', () => {
  assert.equal(extractNicknameRequest('别再叫我先生了'), '', '否定句没给新名字')
  assert.equal(extractNicknameRequest('不要叫我宝贝'), '')
  assert.equal(extractNicknameRequest('你叫我什么'), '', '问句')
  assert.equal(extractNicknameRequest('我叫小明'), '', '自我介绍不算改口请求')
  assert.equal(extractNicknameRequest('叫我一声'), '', '没有名字')
  assert.equal(extractNicknameRequest('随便聊聊'), '')
  assert.equal(extractNicknameRequest(''), '')
  assert.equal(extractAddressRequest('别再叫我先生了'), null)
})

// ───────────────────────── 接线：变量 / 上下文 / 工具 ─────────────────────────

test('接线：变量每轮现取，写入后立刻反映', () => {
  reset(JSON.stringify({ nickname: '伙伴' }))
  const { ctx, variables } = mockCtx()
  apply(ctx)
  const provider = variables.get('user_nickname')
  assert.equal(typeof provider, 'function', '必须注册 user_nickname')
  assert.equal(provider(), '伙伴')
  saveNickname('小明')
  assert.equal(provider(), '小明', '必须现取，不能缓存')
  saveCallPreference('老师')
  assert.equal(provider(), '老师', '称呼偏好要盖过昵称')
})

test('接线：称呼规则上下文（排在风格/世界书之前）', () => {
  reset(JSON.stringify({ nickname: '伙伴' }))
  const { ctx, contexts } = mockCtx()
  apply(ctx)
  assert.equal(contexts.length, 1)
  const spec = contexts[0]
  assert.equal(spec.name, 'cyrene:nickname')
  assert.equal(spec.order, 120, '要排在风格 130 与常驻世界书 140 之前')

  let text = spec.text()
  assert.ok(text.includes('「伙伴」'), '规则里要带上当前称呼')
  assert.ok(text.includes('来自昵称'), '要说明称呼是从哪来的')

  // 「用多少」—— 上游环境块里的那条规则，现在进每轮上下文
  assert.ok(text.includes('强调重点'), '要写清什么时候叫')
  assert.ok(text.includes('0–1 次'), '短回复的频率')
  assert.ok(text.includes('1–2 次'), '中长回复的频率')
  assert.ok(text.includes('不要每条回复都叫'), '别每句都叫')
  assert.ok(text.includes('「X，……」开头'), '别用固定开头')
  assert.ok(text.includes('降频'), '连续叫过之后要降频')
  assert.ok(text.includes('自然度优先'))

  // 「怎么变」—— 关系称呼与明确改口
  assert.ok(text.includes('老婆') && text.includes('老公'), '必须写明关系称呼的对应关系')
  assert.ok(text.includes('当轮就用新称呼'))

  saveCallPreference('老师')
  text = spec.text()
  assert.ok(text.includes('「老师」') && text.includes('来自称呼偏好'), '改完立刻反映，且说明来源')
})

test('接线：显式改口在本轮 pre-step 就落盘（分流到两个字段）', async () => {
  reset(JSON.stringify({ nickname: '伙伴' }))
  const { ctx, listeners, variables } = mockCtx()
  apply(ctx)
  assert.equal(listeners.length, 1)

  await step(listeners[0], '以后叫我小明')
  assert.deepEqual(loadProfile(), { nickname: '伙伴', callPreference: '小明', address: '小明' },
    '「叫我X」写称呼偏好')
  assert.equal(variables.get('user_nickname')(), '小明', '本轮装配就能用新称呼')

  await step(listeners[0], '昵称换成阿哲')
  assert.deepEqual(loadProfile(), { nickname: '阿哲', callPreference: '小明', address: '小明' },
    '「昵称换成X」写 nickname；生效称呼仍由称呼偏好决定')

  await step(listeners[0], '今天天气不错')
  assert.equal(loadNickname(), '小明', '没提改口就不动')
})

test('接线：插件自己注入的消息不算用户输入', async () => {
  reset(JSON.stringify({ nickname: '伙伴' }))
  const { ctx, listeners } = mockCtx()
  apply(ctx)
  const marker = {
    role: 'user',
    source: { kind: 'plugin:dsh-cyrene/scene' },
    content: [{ type: 'text', text: '以后叫我坏人' }]
  }
  await listeners[0]({ agent: { session: { id: 's1' } }, messages: [marker] }, async () => ({ kind: 'enter', messages: [marker] }))
  assert.equal(loadNickname(), '伙伴', '插件消息里出现的「叫我…」不能被当真')
})

test('接线：工具 set_address 写称呼偏好（暗示类请求用）', () => {
  reset(JSON.stringify({ nickname: '伙伴' }))
  const { ctx, tools } = mockCtx()
  apply(ctx)
  assert.equal(tools.length, 1)
  const tool = tools[0]
  assert.equal(tool.name, 'set_address')
  assert.ok(tool.description.includes('暗示'), '描述里要写清什么时候用')
  assert.ok(tool.description.includes('老婆'), '关系称呼的场景要写进工具描述')
  assert.ok(tool.description.includes('称呼偏好'), '要说明它写的是哪个字段')

  const ok = tool.execute({ name: '老师' })
  assert.ok(ok.includes('老师'))
  assert.equal(loadProfile().callPreference, '老师', '写的是称呼偏好')
  assert.equal(loadNickname(), '老师')

  const bad = tool.execute({ name: '   ' })
  assert.ok(bad.includes('没有改成功'))
  assert.equal(loadNickname(), '老师', '失败时不能把旧称呼冲掉')
})

// ───────────────────────── 设置接口 ─────────────────────────

test('接口：GET 返回两个字段与生效称呼', async () => {
  reset(JSON.stringify({ nickname: '小明', callPreference: '老师' }))
  const res = fakeRes()
  await handleNicknameApi(fakeReq('GET'), res)
  assert.equal(res.status, 200)
  assert.deepEqual(
    { nickname: res.json.nickname, callPreference: res.json.callPreference, address: res.json.address, fallback: res.json.default },
    { nickname: '小明', callPreference: '老师', address: '老师', fallback: '伙伴' }
  )
  assert.equal(res.headers['Cache-Control'], 'no-store')
})

test('接口：POST 写称呼偏好并回读确认', async () => {
  reset(JSON.stringify({ nickname: '小明' }))
  const res = fakeRes()
  await handleNicknameApi(fakeReq('POST', JSON.stringify({ field: 'callPreference', value: '老师' })), res)
  assert.equal(res.status, 200)
  assert.equal(res.json.callPreference, '老师')
  assert.equal(res.json.address, '老师')
  assert.equal(JSON.parse(readFileSync(STORE, 'utf8')).callPreference, '老师', '文件里也要真的写进去')
  assert.equal(JSON.parse(readFileSync(STORE, 'utf8')).nickname, '小明', '别把昵称冲掉')
})

test('接口：POST 空串 = 清除该字段', async () => {
  reset(JSON.stringify({ nickname: '小明', callPreference: '老师' }))
  const res = fakeRes()
  await handleNicknameApi(fakeReq('POST', JSON.stringify({ field: 'callPreference', value: '' })), res)
  assert.equal(res.status, 200)
  assert.equal(res.json.callPreference, '')
  assert.equal(res.json.address, '小明', '回落到昵称')
})

test('接口：非法字段 / 非字符串 / 非法内容都拒绝，且不改文件', async () => {
  reset(JSON.stringify({ nickname: '小明', callPreference: '老师' }))
  const cases = [
    [{ field: 'nickName', value: 'x' }, 400],
    [{ field: 'callPreference', value: 42 }, 400],
    [{ field: 'callPreference', value: '{}' }, 400],
    [{ field: 'callPreference', value: 'a\u0001b' }, 400]
  ]
  for (const [payload, status] of cases) {
    const res = fakeRes()
    await handleNicknameApi(fakeReq('POST', JSON.stringify(payload)), res)
    assert.equal(res.status, status, `payload=${JSON.stringify(payload)} 应被拒绝`)
    assert.equal(res.json.ok, false)
  }
  assert.deepEqual(JSON.parse(readFileSync(STORE, 'utf8')), { nickname: '小明', callPreference: '老师' })
})

test('接口：坏 JSON / 错误方法各有明确回应', async () => {
  const bad = fakeRes()
  await handleNicknameApi(fakeReq('POST', '{不是 JSON'), bad)
  assert.equal(bad.status, 400)
  assert.ok(bad.json.error.includes('JSON'))

  const wrong = fakeRes()
  await handleNicknameApi(fakeReq('PUT', ''), wrong)
  assert.equal(wrong.status, 405)
  assert.ok(wrong.json.error.includes('GET'))
})

test('清理临时目录', () => {
  assert.ok(existsSync(HOME))
  rmSync(HOME, { recursive: true, force: true })
  assert.ok(!existsSync(HOME))
})
