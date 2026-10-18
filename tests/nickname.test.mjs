/**
 * nickname.js（称呼）的单元测试。
 *
 * 覆盖三件事：
 *   1. 设置里的自定义名称（读文件、坏文件回退）
 *   2. 显式改口（「以后叫我小明」）——确定性解析，不依赖模型
 *   3. 暗示改口（工具 set_nickname）——由模型判断后调用
 *
 * 用临时 DSH_HOME，**绝不碰真实配置文件**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'cyrene-nickname-test-'))
process.env.DSH_HOME = HOME

const mod = await import('../nickname.js')
const { apply, extractNicknameRequest, loadNickname, sanitize, saveNickname } = mod
const STORE = join(HOME, 'dsha-brand-rename.json')

/** 用一个全新的空文件开始。 */
function reset(content) {
  if (content === undefined) {
    if (existsSync(STORE)) rmSync(STORE)
  } else {
    writeFileSync(STORE, content, 'utf8')
  }
}

/** 假 ctx：捕获变量 provider、pre-step 与工具。 */
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
  const decision = { kind: 'enter', messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }] }
  return listener({ agent: { session: { id: 's1' } }, messages: decision.messages }, async () => decision)
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

  reset('{ 坏掉的 json')
  assert.equal(loadNickname(), '伙伴')

  reset('[]')
  assert.equal(loadNickname(), '伙伴')

  reset(JSON.stringify({ nickname: '   ' }))
  assert.equal(loadNickname(), '伙伴')

  reset(JSON.stringify({ nickname: '小明' }))
  assert.equal(loadNickname(), '小明')
})

test('写入：读-改-写，不能把文件里别的字段冲掉', () => {
  reset(JSON.stringify({ nickname: '旧名字', petVisible: false, theme: 'rose' }))
  assert.equal(saveNickname('新名字'), '新名字')
  const saved = JSON.parse(readFileSync(STORE, 'utf8'))
  assert.equal(saved.nickname, '新名字')
  assert.equal(saved.petVisible, false, '别的字段必须保留')
  assert.equal(saved.theme, 'rose')
  assert.equal(saveNickname('   '), '', '空名字写不进去')
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
})

test('解析：不该改口的一律不动', () => {
  assert.equal(extractNicknameRequest('别再叫我先生了'), '', '否定句没给新名字')
  assert.equal(extractNicknameRequest('不要叫我宝贝'), '')
  assert.equal(extractNicknameRequest('你叫我什么'), '', '问句')
  assert.equal(extractNicknameRequest('我叫小明'), '', '自我介绍不算改口请求')
  assert.equal(extractNicknameRequest('叫我一声'), '', '没有名字')
  assert.equal(extractNicknameRequest('随便聊聊'), '')
  assert.equal(extractNicknameRequest(''), '')
})

// ───────────────────────── 接线：变量 / pre-step / 工具 ─────────────────────────

test('接线：变量每轮现取，写入后立刻反映', () => {
  reset(JSON.stringify({ nickname: '伙伴' }))
  const { ctx, variables } = mockCtx()
  apply(ctx)
  const provider = variables.get('user_nickname')
  assert.equal(typeof provider, 'function', '必须注册 user_nickname')
  assert.equal(provider(), '伙伴')
  saveNickname('小明')
  assert.equal(provider(), '小明', '必须现取，不能缓存')
})

test('接线：注册「称呼规则」上下文（排在风格/世界书之前）', () => {
  reset(JSON.stringify({ nickname: '伙伴' }))
  const { ctx, contexts } = mockCtx()
  apply(ctx)
  assert.equal(contexts.length, 1)
  const spec = contexts[0]
  assert.equal(spec.name, 'cyrene:nickname')
  assert.equal(spec.order, 120, '要排在风格 130 与常驻世界书 140 之前')
  const text = spec.text()
  assert.ok(text.includes('「伙伴」'), '规则里要带上当前称呼')
  assert.ok(text.includes('老婆') && text.includes('老公'), '必须写明关系称呼的对应关系')
  assert.ok(text.includes('当轮就用新称呼'), '要说明换完立刻用')
});

test('接线：显式改口在本轮 pre-step 就落盘', async () => {
  reset(JSON.stringify({ nickname: '伙伴' }))
  const { ctx, listeners, variables } = mockCtx()
  apply(ctx)
  assert.equal(listeners.length, 1)

  await step(listeners[0], '以后叫我小明')
  assert.equal(loadNickname(), '小明')
  assert.equal(variables.get('user_nickname')(), '小明', '本轮装配就能用新名字')

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

test('接线：工具 set_nickname 能改称呼（暗示类请求用）', () => {
  reset(JSON.stringify({ nickname: '伙伴' }))
  const { ctx, tools } = mockCtx()
  apply(ctx)
  assert.equal(tools.length, 1)
  const tool = tools[0]
  assert.equal(tool.name, 'set_nickname')
  assert.ok(tool.description.includes('暗示'), '描述里要写清什么时候用')
  assert.ok(tool.description.includes('老婆'), '关系称呼的场景要写进工具描述')

  const ok = tool.execute({ name: '老师' })
  assert.ok(ok.includes('老师'))
  assert.equal(loadNickname(), '老师')

  const bad = tool.execute({ name: '   ' })
  assert.ok(bad.includes('没有改成功'))
  assert.equal(loadNickname(), '老师', '失败时不能把旧称呼冲掉')
})

test('清理临时目录', () => {
  assert.ok(existsSync(HOME))
  rmSync(HOME, { recursive: true, force: true })
  assert.ok(!existsSync(HOME))
})
