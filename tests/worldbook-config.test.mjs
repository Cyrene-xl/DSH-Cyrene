/**
 * 世界书配置层：归一化、热更新、目录签名缓存。
 *
 * 这几条都是「配置文件是给人手改的」这个前提推出来的：
 *   - 类型写错不能让她静默失效（`"enabled": "false"` 曾被当成开着）；
 *   - 数值越界不能原样传进匹配器；
 *   - 改完不该等 30 秒、也不该重启。
 *
 * 用临时 DSH_HOME，绝不碰真实配置与世界书。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'cyrene-wb-config-'))
process.env.DSH_HOME = HOME

const { apply, normalizeConfig, currentConfig } = await import('../worldbook/index.mjs')
const { worldbookDirectorySignature } = await import('../worldbook/parse.mjs')

const CONFIG = join(HOME, 'cyrene-worldbook.json')

/** 写一份配置。 */
const writeConfig = (value) => writeFileSync(CONFIG, typeof value === 'string' ? value : JSON.stringify(value), 'utf8')

/** 造一份只有一条常驻条目的世界书。 */
function makeBook(dir, body) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'a.md'), [
    '# 测试书', '', '---', '',
    '## 条目甲', '- 触发词: 甲', '- 常驻: 是', '- 内在价值: 60', '- 优先级: 200', '- 连带触发词: 无', '',
    body, ''
  ].join('\n'), 'utf8')
}

/**
 * 配置缓存是**模块级**的，跨用例会串。这里用一个单调前进的假时钟把它推到未来，
 * 逼下一次 currentConfig() 真的重读 —— 之后真实时间调用都会命中这个缓存。
 * （刚踩过：两次都用 `Date.now() + 固定值`，时间戳几乎一样，等于没推。）
 */
let clock = Date.now();
const forceReload = () => {
  clock += 10_000;
  return currentConfig(clock);
};

/** 假 ctx：抓 context() 注册的 spec。 */
function mockCtx() {
  const contexts = []
  const ctx = {
    systemPrompt: { context: (spec) => contexts.push(spec), variable: () => {} },
    on: () => {},
    inject: () => {}
  }
  return { ctx, contexts }
}

// ───────────────────────── 归一化 ─────────────────────────

test('配置归一化：类型不对退回默认，数值夹到区间', () => {
  const d = normalizeConfig(undefined)
  assert.equal(d.enabled, true)
  assert.equal(d.scanDepth, 3)
  assert.equal(d.maxActive, 8)
  assert.equal(d.trace, false)
  assert.equal(d.dir.includes('worldbook'), true, '默认 dir 应指向随包数据')

  const bad = normalizeConfig({ enabled: 'false', scanDepth: 'abc', maxActive: null, trace: 'yes', dir: '   ' })
  assert.equal(bad.enabled, true, '只有显式 false 才关；字符串 "false" 不算')
  assert.equal(bad.scanDepth, 3, '非数字退回默认')
  assert.equal(bad.maxActive, 8)
  assert.equal(bad.trace, false, '只有显式 true 才算开')
  assert.equal(bad.dir, d.dir, '空白 dir 退回默认')

  const clamped = normalizeConfig({ maxActive: 999, scanDepth: 0 })
  assert.equal(clamped.maxActive, 50, 'maxActive 上限 50')
  assert.equal(clamped.scanDepth, 1, 'scanDepth 下限 1')

  const ok = normalizeConfig({ enabled: false, scanDepth: 5, maxActive: 3, trace: true, dir: '/tmp/x' })
  assert.deepEqual(
    { enabled: ok.enabled, scanDepth: ok.scanDepth, maxActive: ok.maxActive, trace: ok.trace, dir: ok.dir },
    { enabled: false, scanDepth: 5, maxActive: 3, trace: true, dir: '/tmp/x' },
  )

  assert.equal(normalizeConfig([]).enabled, true, '数组当垃圾处理')
  assert.equal(normalizeConfig('nonsense').scanDepth, 3)
})

test('配置热更新：2 秒内复用缓存，超过就重读', () => {
  writeConfig({ scanDepth: 4 })
  assert.equal(currentConfig(1_000_000).scanDepth, 4)

  writeConfig({ scanDepth: 2 })
  assert.equal(currentConfig(1_001_000).scanDepth, 4, '2 秒内不重读')
  assert.equal(currentConfig(1_003_000).scanDepth, 2, '超过 2 秒后重读')

  writeConfig('{ 坏掉的 json')
  assert.equal(currentConfig(1_006_000).scanDepth, 3, '坏配置退回默认，不抛')
})

// ───────────────────────── 目录签名 ─────────────────────────

test('目录签名：文件改动会变，空目录与读不到要区分', () => {
  const dir = join(HOME, 'book-sig')
  makeBook(dir, '第一版正文')
  const first = worldbookDirectorySignature(dir)
  assert.ok(first.includes('a.md'), '签名里应含文件名')

  makeBook(dir, '第二版正文，长一点点')
  assert.notEqual(worldbookDirectorySignature(dir), first, '内容变了签名要变')

  const empty = join(HOME, 'book-empty')
  mkdirSync(empty, { recursive: true })
  assert.equal(worldbookDirectorySignature(empty), '__empty__', '空目录要有稳定签名')
  assert.equal(worldbookDirectorySignature(join(HOME, 'no-such-dir')), '', '读不到返回空串')
})

// ───────────────────────── 注入层 ─────────────────────────

test('注入层：改了世界书文件，下一轮立即生效（不用等 TTL、不用重启）', () => {
  const dir = join(HOME, 'book-live')
  makeBook(dir, '这是第一版的正文。')
  writeConfig({ dir })
  forceReload()

  const { ctx, contexts } = mockCtx()
  apply(ctx)
  assert.equal(contexts.length, 1, '必须注册常驻块的 context')
  const spec = contexts[0]

  const before = spec.text()
  assert.ok(before.includes('这是第一版的正文'), '第一版应注入')

  makeBook(dir, '这是第二版的正文。')
  const after = spec.text()
  assert.ok(after.includes('这是第二版的正文'), '文件一改，下一次取就该是新内容')
  assert.ok(!after.includes('这是第一版的正文'))
})

test('注入层：配置改成 enabled:false 后停止注入（2 秒后）', () => {
  const dir = join(HOME, 'book-off')
  makeBook(dir, '一些正文。')
  writeConfig({ dir, enabled: true })
  forceReload()

  const { ctx, contexts } = mockCtx()
  apply(ctx)
  const spec = contexts[0]
  assert.ok(spec.text().includes('一些正文'))

  // 真实时间无法注入到 provider 里，所以这里直接推模块缓存的时间窗口：
  // 写 false 后，用一次「很久以后」的 currentConfig 让缓存失效。
  writeConfig({ dir, enabled: false })
  forceReload()
  assert.equal(spec.text(), '', '关掉后常驻块应为空串')
})

test('清理临时目录', () => {
  rmSync(HOME, { recursive: true, force: true })
  assert.equal(existsSync(HOME), false)
  // 顺带确认测试没在仓库里留文件
  assert.equal(existsSync(join(process.cwd(), 'cyrene-worldbook.json')), false)
})
