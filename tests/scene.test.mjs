/**
 * scene.js（角色扮演模式开关 + 形态切换）的单元测试。
 *
 * 重点变了：从「括号触发的状态机」变成**显式开关**——
 *   - 开关状态怎么读、怎么写、坏文件怎么兜；
 *   - 开着时注入块必须要求三样描述，关着时一个字符都不注入；
 *   - 开关只影响注入，不再往会话历史里插标记消息；
 *   - 形态切换仍然由本轮文本触发，且只影响当前会话。
 *
 * scene.js 在**模块加载时**就从 DSH_HOME 算出 SCENE_STORE，所以必须在 import 之前
 * 设好环境变量（因此用动态 import）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'cyrene-scene-test-'))
process.env.DSH_HOME = HOME

const scene = await import('../scene.js')
const { handleSceneApi } = await import('../index.js')

const STORE = join(HOME, 'cyrene-scene.json')
const {
  DEFAULT_STATE,
  FORMS,
  SCENE_STORE,
  apply,
  currentEnabled,
  extractFormRequest,
  formBlock,
  latestUserText,
  currentState,
  readState,
  resetStateCache,
  sceneBlock,
  sceneEnabled,
  writeState
} = scene

/** 造一条本轮用户消息。 */
const userMsg = (text) => ({
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text }]
})

/** 假 ctx：捕获 systemPrompt.context、agent/pre-step 与工具。 */
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

// ───────────────────────── 开关状态 ─────────────────────────

test('状态：没有文件时默认关', () => {
  assert.equal(readState().enabled, false)
  assert.equal(readState().trailblazer, false, '「默认对方是开拓者」也默认关')
  assert.equal(sceneEnabled(), false)
  assert.equal(DEFAULT_STATE.enabled, false)
  assert.equal(SCENE_STORE, STORE, '状态文件应该落在 DSH_HOME 下')
})

test('状态：只有显式 true 才算开', () => {
  for (const value of ['true', 1, 'yes', null, 0, undefined]) {
    writeFileSync(STORE, JSON.stringify({ version: 1, enabled: value }), 'utf8')
    assert.equal(readState().enabled, false, `enabled=${JSON.stringify(value)} 不该被当成开`)
  }
  writeFileSync(STORE, JSON.stringify({ enabled: true }), 'utf8')
  assert.equal(readState().enabled, true)

  for (const value of ['true', 1, null]) {
    writeFileSync(STORE, JSON.stringify({ trailblazer: value }), 'utf8')
    assert.equal(readState().trailblazer, false, `trailblazer=${JSON.stringify(value)} 不该被当成开`)
  }
  writeFileSync(STORE, JSON.stringify({ trailblazer: true }), 'utf8')
  assert.equal(readState().trailblazer, true)
})

test('状态：坏文件退回默认，不抛错', () => {
  writeFileSync(STORE, '{ 这不是 JSON', 'utf8')
  assert.equal(readState().enabled, false)
  writeFileSync(STORE, '', 'utf8')
  assert.equal(readState().enabled, false)
})

test('状态：写入能读回，并保留文件里的其它字段', () => {
  writeFileSync(STORE, JSON.stringify({ version: 1, enabled: false, note: '手写的备注' }), 'utf8')
  assert.equal(writeState({ enabled: true }), true)
  const parsed = JSON.parse(readFileSync(STORE, 'utf8'))
  assert.equal(parsed.enabled, true)
  assert.equal(parsed.note, '手写的备注', '读-改-写不该冲掉别的字段')
  assert.equal(parsed.version, 1)

  // 两个开关互不覆盖：只写 trailblazer 时 enabled 保持原样
  assert.equal(writeState({ trailblazer: true }), true)
  const both = JSON.parse(readFileSync(STORE, 'utf8'))
  assert.deepEqual({ enabled: both.enabled, trailblazer: both.trailblazer }, { enabled: true, trailblazer: true })
  assert.equal(both.note, '手写的备注')
  assert.ok(readFileSync(STORE, 'utf8').endsWith('\n'), '写回要带行尾换行')
})

test('状态：写不进去时返回 false（比如目标是目录）', () => {
  // 用「已存在的目录」当文件路径，写入必然失败
  const dir = join(HOME, 'a-directory')
  mkdirSync(dir, { recursive: true })
  assert.equal(writeState({ enabled: true }, dir), false)
})

test('缓存：1 秒内复用，之后看文件签名', () => {
  resetStateCache()
  writeState({ enabled: true, trailblazer: true })
  assert.equal(currentEnabled(1_000), true)
  assert.deepEqual(currentState(1_000), { enabled: true, trailblazer: true }, '整份状态一起缓存')

  writeState({ enabled: false, trailblazer: false }) // 长度不同 → mtime/size 签名必变
  assert.equal(currentEnabled(1_500), true, 'TTL 内仍用缓存')
  assert.equal(currentState(1_500).trailblazer, true)
  assert.equal(currentEnabled(2_500), false, '超过 TTL 且文件变了就该重读')
  assert.equal(currentState(2_500).trailblazer, false)
  assert.equal(currentEnabled(2_600), false, '再读仍然是关')
})

// ───────────────────────── 注入块 ─────────────────────────

test('注入：关着时一个字符都不占', () => {
  assert.equal(sceneBlock(false), '')
  assert.equal(sceneBlock(undefined), '')
  assert.equal(sceneBlock('true'), '', '非布尔也不算开')
})

test('注入：开着时强制要求场景 / 动作 / 外貌三样', () => {
  const text = sceneBlock(true)
  assert.ok(text.includes('【角色扮演模式：开】'))
  assert.ok(text.includes('场景描述'))
  assert.ok(text.includes('动作描述'))
  assert.ok(text.includes('外貌描述'))
  assert.ok(text.includes('缺一样就算没做完'), '要把「必须三样」说死')
  assert.ok(text.includes('不要复述原句'), '括号里的指令要照做而不是复述')
  assert.ok(text.includes('不要提「角色扮演模式」'), '别出戏')
})

test('注入：输出格式规范 —— 描述进括号、台词不进', () => {
  const text = sceneBlock(true)
  assert.ok(text.includes('输出格式（硬性）'), '格式段必须存在')
  assert.ok(text.includes('所有描述都放进中文全角括号（）里'), '描述统一进括号')
  assert.ok(text.includes('台词不放进括号'), '台词要在括号外')
  assert.ok(text.includes('省略主语'), '括号里的动作省略主语、对象称「你」')
  assert.ok(text.includes('不要嵌套括号'), '禁止嵌套括号')
  // 示例本身必须符合这条规则：括号里没有台词，台词在括号外
  const example = text.split('\n').find((line) => line.includes('窗外的雨敲在玻璃上'))
  assert.ok(example !== undefined, '要有示例')
  assert.ok(example.includes('（窗外的雨敲在玻璃上，屋里只亮着一盏灯）'), '场景在括号里')
  assert.ok(example.includes('你回来得比我想的早呀。'), '台词在括号外')
  assert.ok(example.includes('（把茶杯推到你面前'), '动作用括号')
})

test('注入：剧情推进是硬性要求（每轮至少一小步 + 主动递钩子）', () => {
  const text = sceneBlock(true)
  assert.ok(text.includes('剧情推进（硬性）'), '推进段必须存在')
  assert.ok(text.includes('至少前进一小步'), '每轮要有可感知的变化')
  assert.ok(text.includes('主动递出下一轮的钩子'), '不能描述完就停')
  assert.ok(text.includes('你可以主动行动'), '允许她主动带节奏')
  assert.ok(text.includes('对方在带方向时就跟着推进'), '用户带方向时不要抢主导权')
})

test('注入：默认不预设身份，开了才有「开拓者」那段', () => {
  const plain = sceneBlock(true)
  assert.ok(!plain.includes('开拓者'), '不开启时一个字都不提身份')
  assert.equal(sceneBlock(true, false), plain, '显式 false 与默认一致')

  const withTrail = sceneBlock(true, true)
  assert.ok(withTrail.includes('【默认身份】'))
  assert.ok(withTrail.includes('开拓者'))
  assert.ok(withTrail.includes('不要问「你是谁」'), '要写清"别问他是谁"')
  assert.ok(withTrail.includes('不要硬套'), '对方想换身份时要照办')
  assert.ok(withTrail.startsWith(plain.split('\n')[0]), '前置的三样描述要求不能被顶掉')

  assert.equal(sceneBlock(false, true), '', '模式关着时，身份开关也不注入')
})

test('注入：两段关系是"追加"的，三样要求仍在', () => {
  const text = sceneBlock(true, true)
  assert.ok(text.includes('场景描述') && text.includes('动作描述') && text.includes('外貌描述'))
})

test('注入：apply 注册 cyrene:scene，文本跟着开关走', () => {
  const { ctx, contexts } = mockCtx()
  resetStateCache()
  writeState({ enabled: false })
  apply(ctx)
  const spec = contexts.find((c) => c.name === 'cyrene:scene')
  assert.ok(spec, '必须注册 cyrene:scene 上下文')
  assert.equal(spec.order, 126, '要夹在形态 125 与风格 130 之间')
  assert.equal(spec.text({}), '', '默认关 → 不注入')

  writeState({ enabled: true })
  resetStateCache()
  assert.ok(spec.text({}).includes('【角色扮演模式：开】'), '开了就该注入')
  assert.ok(!spec.text({}).includes('开拓者'), '第二个开关没开就不提身份')

  writeState({ trailblazer: true })
  resetStateCache()
  assert.ok(spec.text({}).includes('开拓者'), '开了第二个开关才提身份')
})

test('注入：开关不再往会话历史里插消息', async () => {
  const { ctx, listeners } = mockCtx()
  writeState({ enabled: true })
  resetStateCache()
  apply(ctx)
  const out = await step(listeners[0], [userMsg('（雨夜，屋里只有一盏灯）你还记得这里吗')])
  assert.equal(out.messages.length, 1, '不该再追加「场景模式开启」标记')
  assert.equal(out.kind, 'enter')
})

test('非 enter 的决策原样返回（别的插件接管了 pre-step 时不抢）', async () => {
  const { ctx, listeners } = mockCtx()
  apply(ctx)
  const decision = { kind: 'skip' }
  const out = await listeners[0](
    { agent: { session: { id: 's1' } }, messages: [userMsg('（雨夜）你好')] },
    async () => decision
  )
  assert.equal(out, decision)
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

test('形态：注入块只在有形态时出现，且写明「人格不变」', () => {
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

test('取本轮用户文本：必须按 source 过滤掉插件消息', () => {
  const marker = {
    role: 'user',
    source: { kind: 'plugin:dsh-cyrene/scene' },
    content: [{ type: 'text', text: '【角色扮演模式：开】…' }]
  }
  assert.equal(latestUserText([userMsg('第一句'), marker]), '第一句')
  assert.equal(latestUserText([marker]), '', '只有插件消息时没有用户输入')
  assert.equal(latestUserText([{ role: 'user', source: { kind: 'user' }, content: [{ type: 'image' }] }]), '')
  assert.equal(latestUserText([]), '')
  assert.equal(latestUserText(undefined), '')
})

// ───────────────────────── 设置接口 ─────────────────────────

/** 造一个最小 req（只需要 method、url 与可读流）。 */
function fakeReq(method, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = '/cyrene-scene-api'
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body, 'utf8'))
    req.emit('end')
  })
  return req
}

/** 造一个最小 res，收集状态码与响应体。 */
function fakeRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = String(body ?? '')
    },
    get json() {
      return JSON.parse(this.body)
    }
  }
}

test('接口：GET 返回当前状态与文件路径', async () => {
  writeState({ enabled: true })
  const res = fakeRes()
  await handleSceneApi(fakeReq('GET'), res)
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  assert.equal(res.json.enabled, true)
  assert.equal(res.json.path, STORE)
  assert.equal(res.headers['Cache-Control'], 'no-store')
})

test('接口：GET 同时返回两个开关', async () => {
  writeState({ enabled: true, trailblazer: true })
  const res = fakeRes()
  await handleSceneApi(fakeReq('GET'), res)
  assert.deepEqual({ enabled: res.json.enabled, trailblazer: res.json.trailblazer }, { enabled: true, trailblazer: true })
})

test('接口：只写代表身份的开关，不动主开关', async () => {
  writeState({ enabled: true, trailblazer: false })
  const res = fakeRes()
  await handleSceneApi(fakeReq('POST', JSON.stringify({ trailblazer: true })), res)
  assert.equal(res.status, 200)
  assert.deepEqual({ enabled: res.json.enabled, trailblazer: res.json.trailblazer }, { enabled: true, trailblazer: true })
  assert.equal(readState().trailblazer, true)
})

test('接口：两个开关可以一次写', async () => {
  writeState({ enabled: false, trailblazer: false })
  const res = fakeRes()
  await handleSceneApi(fakeReq('POST', JSON.stringify({ enabled: true, trailblazer: true })), res)
  assert.equal(res.status, 200)
  assert.deepEqual(readState(), { version: 1, enabled: true, trailblazer: true })
})

test('接口：POST 写入并回读确认', async () => {
  writeState({ enabled: true })
  const res = fakeRes()
  await handleSceneApi(fakeReq('POST', JSON.stringify({ enabled: false })), res)
  assert.equal(res.status, 200)
  assert.equal(res.json.enabled, false)
  assert.equal(readState().enabled, false, '文件里也要真的改掉')
})

test('接口：只收真正的布尔值', async () => {
  writeState({ enabled: false })
  for (const value of ['true', 1, 'yes', null]) {
    const res = fakeRes()
    await handleSceneApi(fakeReq('POST', JSON.stringify({ enabled: value })), res)
    assert.equal(res.status, 400, `enabled=${JSON.stringify(value)} 应被拒绝`)
    assert.equal(readState().enabled, false, '被拒绝时不能改文件')
  }
})

test('接口：坏 JSON / 错误方法各有明确回应', async () => {
  const bad = fakeRes()
  await handleSceneApi(fakeReq('POST', '{不是 JSON'), bad)
  assert.equal(bad.status, 400)
  assert.ok(bad.json.error.includes('JSON'))

  const wrong = fakeRes()
  await handleSceneApi(fakeReq('PUT', ''), wrong)
  assert.equal(wrong.status, 405)
  assert.ok(wrong.json.error.includes('GET'))
})

test('接口：缺少两个字段都不会被当成关', async () => {
  writeState({ enabled: true })
  const res = fakeRes()
  await handleSceneApi(fakeReq('POST', JSON.stringify({})), res)
  assert.equal(res.status, 400)
  assert.equal(readState().enabled, true, '原状态必须留着')
})

test('清理临时目录', () => {
  assert.ok(existsSync(HOME))
  rmSync(HOME, { recursive: true, force: true })
  assert.ok(!existsSync(HOME))
})
