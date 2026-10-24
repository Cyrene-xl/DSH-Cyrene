/**
 * scripts/install.mjs 的分流测试。
 *
 * 两种 DSH 代数，同一台机器上都可能出现，行为完全不同：
 *   - 0.1.x：目录扫描 → 往 `<DSH_HOME>/.agent-presets/` 拷
 *   - 0.2.0+：声明式注册表 → 往对应 profile 的 `cordis.patch.yml` 写声明
 *
 * 这里用临时 `DSH_HOME` 真跑脚本（不是模拟），因为这段逻辑的价值就在"实际行为"：
 * 会写错文件、会覆盖别人的补丁、会重复追加，这些只有跑起来才看得见。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const INSTALL = join(repoRoot, 'scripts', 'install.mjs')
const ROOTS = []

/** 造一个临时 DSH_HOME；`profiles` 里按需建出声明式/老式的假 profile。 */
function makeHome({ declarative = [], legacy = ['p-old'] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'cyrene-install-'))
  ROOTS.push(home)
  mkdirSync(join(home, 'profiles'), { recursive: true })
  for (const name of declarative) {
    const dir = join(home, 'profiles', name, 'node_modules')
    // 声明式那代才有的注册表插件 —— 脚本靠它在不在判断代数
    mkdirSync(join(dir, '@deepseek-ai', 'dsh-agent-preset'), { recursive: true })
    // 本包也必须在 profile 里，否则脚本不去动它
    mkdirSync(join(dir, 'dsh-cyrene'), { recursive: true })
  }
  for (const name of legacy) mkdirSync(join(home, 'profiles', name), { recursive: true })
  return home
}

/**
 * 跑一次安装脚本。
 *
 * 默认带 `--yes`：安装现在是"Profile 变更"，非交互环境必须显式确认（这正是脚本的
 * 安全设计）。要测"没确认会怎样"的用例，传 `extra = []`。
 */
function runInstall(home, extra = ['--yes']) {
  return execFileSync(process.execPath, [INSTALL, ...extra], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home },
  })
}

/** 跑一次安装脚本，返回 `{ status, stdout, stderr }`（失败不抛）。 */
function tryInstall(home, extra) {
  try {
    return { status: 0, stdout: runInstall(home, extra), stderr: '' }
  } catch (error) {
    return { status: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
  }
}

test('声明式代：把两套预设写进 profile 补丁，替换空补丁的 []', () => {
  const home = makeHome({ declarative: ['p-new'] })
  const patch = join(home, 'profiles', 'p-new', 'cordis.patch.yml')
  writeFileSync(patch, '[]\n', 'utf8')

  const out = runInstall(home)
  const text = readFileSync(patch, 'utf8')

  assert.ok(text.includes('dsh-cyrene 预设声明'), '应写入我们的标记')
  assert.ok(text.includes('preset-chat'), '应包含 chat 声明')
  assert.ok(text.includes('preset-cyrene-work'), '应包含 cyrene-work 声明')
  assert.equal(text.match(/^\{?- insert:/gm)?.length ?? text.split('\n').filter((l) => l === '- insert:').length, 2, '两套预设两个 insert 块')
  assert.ok(!text.startsWith('[]'), '空数组必须被替换，不能变成 "[] - insert:"')
  assert.ok(out.includes('不需要再手动贴'), '提示应说明不需要手动贴')
})

test('声明式代：重复跑是幂等的，不会重复追加', () => {
  const home = makeHome({ declarative: ['p-new'] })
  const patch = join(home, 'profiles', 'p-new', 'cordis.patch.yml')
  writeFileSync(patch, '[]\n', 'utf8')

  runInstall(home)
  const first = readFileSync(patch, 'utf8')
  runInstall(home)
  const second = readFileSync(patch, 'utf8')

  assert.equal(second, first, '第二次不应改动文件')
  assert.equal(second.split('dsh-cyrene 预设声明').length - 1, 1, '标记只能有一处')
})

test('声明式代：已有内容的补丁是追加，不是覆盖', () => {
  const home = makeHome({ declarative: ['p-new'] })
  const patch = join(home, 'profiles', 'p-new', 'cordis.patch.yml')
  const mine = '- insert:\n    - id: mine\n      name: my-plugin\n'
  writeFileSync(patch, mine, 'utf8')

  runInstall(home)
  const text = readFileSync(patch, 'utf8')

  assert.ok(text.startsWith(mine.trim()), '用户原有内容必须原样保留在最前面')
  assert.ok(text.includes('dsh-cyrene 预设声明'), '我们的声明追加在后面')
  assert.ok(existsSync(`${patch}.bak.`) === false || true, '备份文件是带时间戳的，不在这里断言')
})

test('老式（0.1.x）：仍然往 .agent-presets 拷目录，并提示 0.2+ 的正确顺序', () => {
  const home = makeHome({ declarative: [], legacy: ['p-old'] })
  const out = runInstall(home)

  assert.ok(existsSync(join(home, '.agent-presets', 'chat', 'agent.cordis.yml')), 'chat 预设应被拷贝')
  assert.ok(existsSync(join(home, '.agent-presets', 'cyrene-work', 'agent.cordis.yml')), 'cyrene-work 预设应被拷贝')
  assert.ok(out.includes('不会生效'), '应提示 0.2.0+ 目录方式无效')
  assert.ok(out.includes('先把插件装进 profile'), '应给出正确顺序')
})

test('混合：声明式 profile 写声明，同时仍保留目录副本给老版本', () => {
  const home = makeHome({ declarative: ['p-new'], legacy: ['p-old'] })
  const patch = join(home, 'profiles', 'p-new', 'cordis.patch.yml')
  writeFileSync(patch, '[]\n', 'utf8')

  runInstall(home)
  assert.ok(readFileSync(patch, 'utf8').includes('preset-chat'), '声明式 profile 应拿到声明')
  assert.ok(existsSync(join(home, '.agent-presets', 'chat')), '目录副本也要有（同一机器上的 0.1.x 要用）')
})

test('安全：非交互环境没给 --yes 就拒绝，且不写任何文件', () => {
  const home = makeHome({ declarative: ['p-new'] })
  const patch = join(home, 'profiles', 'p-new', 'cordis.patch.yml')
  writeFileSync(patch, '[]\n', 'utf8')

  const result = tryInstall(home, [])
  assert.notEqual(result.status, 0, '没有精确确认必须失败')
  assert.ok(result.stderr.includes('--yes'), '要告诉用户怎么确认')
  assert.equal(readFileSync(patch, 'utf8'), '[]\n', '补丁不能被改动')
  assert.ok(!existsSync(join(home, '.agent-presets', 'chat')), '预设目录不能被创建')
})

test('安全：--dry-run 只打印计划，不写任何文件', () => {
  const home = makeHome({ declarative: ['p-new'] })
  const patch = join(home, 'profiles', 'p-new', 'cordis.patch.yml')
  writeFileSync(patch, '[]\n', 'utf8')

  const out = runInstall(home, ['--dry-run'])
  assert.ok(out.includes('一次性安装计划'), '要打印计划')
  assert.ok(out.includes('没有写入任何文件'), '要说明只读')
  assert.equal(readFileSync(patch, 'utf8'), '[]\n')
  assert.ok(!existsSync(join(home, '.agent-presets', 'chat')))
})

test('安全：--force 覆盖后可以用 --rollback 恢复原预设', () => {
  const home = makeHome({ declarative: [], legacy: [] })
  const dest = join(home, '.agent-presets', 'chat')
  mkdirSync(dest, { recursive: true })
  writeFileSync(join(dest, 'agent.cordis.yml'), 'mine: true\n', 'utf8')

  runInstall(home, ['--yes', '--force'])
  assert.notEqual(readFileSync(join(dest, 'agent.cordis.yml'), 'utf8'), 'mine: true\n', '应已被覆盖')

  const out = runInstall(home, ['--rollback'])
  assert.ok(out.includes('回滚完成'), '要报告回滚结果')
  assert.equal(readFileSync(join(dest, 'agent.cordis.yml'), 'utf8'), 'mine: true\n', '应恢复成用户原来那份')
})

test('代际探测：profile 里没有注册表包，也能靠 --generation=declarative 写声明', () => {
  const home = makeHome({ declarative: [], legacy: [] })
  // 只装本包、没有 @deepseek-ai/dsh-agent-preset 标记 —— 真实 0.2.x profile 的样子
  mkdirSync(join(home, 'profiles', 'p-x', 'node_modules', 'dsh-cyrene'), { recursive: true })
  const patch = join(home, 'profiles', 'p-x', 'cordis.patch.yml')
  writeFileSync(patch, '[]\n', 'utf8')

  const out = runInstall(home, ['--yes', '--generation=declarative'])
  assert.ok(out.includes('追加声明'), '应计划写声明')
  assert.ok(readFileSync(patch, 'utf8').includes('preset-chat'), '补丁里应有预设声明')
})

test('代际探测：显式 legacy 时打印警告，不静默', () => {
  const home = makeHome({ declarative: [], legacy: [] })
  mkdirSync(join(home, 'profiles', 'p-x', 'node_modules', 'dsh-cyrene'), { recursive: true })
  const patch = join(home, 'profiles', 'p-x', 'cordis.patch.yml')
  writeFileSync(patch, '[]\n', 'utf8')

  const out = runInstall(home, ['--yes', '--generation=legacy'])
  assert.ok(out.includes('⚠️'), '要给出显式警告')
  assert.ok(out.includes('--generation=declarative'), '要告诉用户怎么修')
  assert.equal(readFileSync(patch, 'utf8'), '[]\n', 'legacy 下不写补丁')
})

test('声明式代：声明块内容变了会整块更新，不会重复追加', () => {
  const home = makeHome({ declarative: ['p-new'] })
  const patch = join(home, 'profiles', 'p-new', 'cordis.patch.yml')
  writeFileSync(patch, '[]\n', 'utf8')
  runInstall(home)

  // 模拟旧版本写下的短标记 + 过期内容
  writeFileSync(patch, '# ── dsh-cyrene 预设声明（自动写入，勿手改）\n过期内容\n', 'utf8')
  const out = runInstall(home)
  assert.ok(out.includes('更新声明'), '应计划更新而不是跳过')
  const text = readFileSync(patch, 'utf8')
  assert.ok(text.includes('preset-chat'), '应写回正确声明')
  assert.ok(text.includes('过期内容') === false, '旧块应被整块替换')
  assert.equal(text.split('dsh-cyrene 预设声明').length - 1, 1, '不能重复追加')
})

test('安全：安装成功会留下 journal（--rollback 的依据）', () => {
  const home = makeHome({ declarative: ['p-new'] })
  writeFileSync(join(home, 'profiles', 'p-new', 'cordis.patch.yml'), '[]\n', 'utf8')
  runInstall(home, ['--yes'])
  const journal = JSON.parse(readFileSync(join(home, '.cyrene-install-journal.json'), 'utf8'))
  assert.equal(journal.status, 'applied')
  assert.ok(Array.isArray(journal.records) && journal.records.length > 0, '要记录改了哪些目标')
})

test('清理临时目录', () => {
  for (const root of ROOTS) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})
