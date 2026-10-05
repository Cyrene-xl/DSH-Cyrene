/**
 * 预设结构与**上游同步性**的测试。
 *
 * 运行：`npm test`（等价于 `node --test tests/*.mjs`）
 *
 * ## 这个文件为什么存在
 *
 * `preset/cyrene-work/agent.cordis.yml` 的工具行是**整段抄自内置 standard 预设**的
 * （只替换 persona 那一条）。抄本没有自动同步机制：DSH 升级后内置 standard 的工具行
 * 会变，这份拷贝不会变，**也不会报错** —— 最多表现为少挂一个工具，或者某条
 * `!!js process.platform === …` 在新版本里语义不同。
 *
 * 这个仓库在别处（版本号散落、文档过时断言）都做了防静默失效的功课，
 * 抄本漂移是唯一一处原本没有护栏的地方。下面的断言就是那道护栏。
 *
 * ## 为什么可能被 skip
 *
 * 本仓库**零依赖**（没有 package.json 依赖、没有 lockfile），所以这里不 import `yaml`，
 * 而是**从 DSH 安装处**用 createRequire 解析它 —— 内置 standard 预设本来也只有在装了
 * DSH 的机器上才存在，两者同源。CI 上没有 DSH，于是整个文件跳过；本机有，就会真跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** DSH 安装位置。可用 `DSH_INSTALL` 覆盖（比如换了全局安装目录）。 */
const DSH_INSTALL = process.env.DSH_INSTALL || '/usr/local/lib/node_modules/@deepseek-ai/dsh';

/**
 * 解析测试所需的两样东西：`yaml` 解析器，以及内置 standard 预设的路径。
 * 任一样拿不到就返回 undefined —— 调用方据此整条跳过。
 */
function loadUpstream() {
  if (!existsSync(join(DSH_INSTALL, 'package.json'))) return undefined;
  let YAML;
  let stdPath;
  try {
    const req = createRequire(join(DSH_INSTALL, 'package.json'));
    YAML = req('yaml');
    const presetsPkg = req.resolve('@deepseek-ai/dsh-agent-presets/package.json');
    stdPath = join(dirname(presetsPkg), 'presets', 'standard', 'agent.cordis.yml');
  } catch {
    return undefined;
  }
  if (typeof YAML?.parse !== 'function' || !existsSync(stdPath)) return undefined;
  return { YAML, stdPath };
}

const upstream = loadUpstream();
const skipUpstream = upstream === undefined
  ? '本机没有 DSH 安装（或解析不到 yaml / 内置预设），跳过与上游的对比'
  : false;

/** 预设写在同一台机器上，`!!js` 是上游写法 —— 校验形状时把它当普通标量。 */
const jsTag = { tag: '!<tag:yaml.org,2002:js>', resolve: (v) => ({ js: v }) };
const parse = (file) => upstream.YAML.parse(readFileSync(file, 'utf8'), { customTags: [jsTag] });

/** 递归取所有行的 id（组内条目也算），用于集合比对。 */
function rowIds(rows) {
  const out = [];
  const walk = (list) => {
    for (const row of list ?? []) {
      if (row && typeof row === 'object' && typeof row.id === 'string') out.push(row.id);
      if (row && row.group === true) walk(row.config);
    }
  };
  walk(rows);
  return out;
}

const PRESETS = ['chat', 'cyrene-work'];
const presetFile = (id) => join(repoRoot, 'preset', id, 'agent.cordis.yml');

test('预设：两个预设的 YAML 都能解析，且都是完整替换系统提示词', () => {
  for (const id of PRESETS) {
    const doc = parse(presetFile(id));
    assert.ok(Array.isArray(doc), `${id} 顶层必须是插件行数组`);
    assert.ok(doc.length > 0, `${id} 不应为空`);
    const persona = doc.find((row) => row?.id === 'persona');
    assert.ok(persona, `${id} 必须挂 persona`);
    assert.equal(persona.config.complete, true, `${id} 的 persona 必须是 complete: true`);
    assert.equal(
      persona.config.includeRuntimeContext,
      true,
      `${id} 的 includeRuntimeContext 必须为 true（世界书走 systemPrompt.context()，关掉会静默失效）`,
    );
  }
});

test('预设：两套预设挂的插件不完全相同 —— 别把「挂预设里」当成「两个模式都有」', () => {
  const chatIds = rowIds(parse(presetFile('chat')));
  const workIds = rowIds(parse(presetFile('cyrene-work')));
  // 记忆与世界书两个模式共享
  for (const id of ['cyrene-memory', 'dsh-cyrene-worldbook']) {
    assert.ok(chatIds.includes(id), `chat 应挂 ${id}`);
    assert.ok(workIds.includes(id), `cyrene-work 应挂 ${id}`);
  }
  // 昵称只有 chat 挂：work 那组人设正文没有引用 {{user_nickname}}
  assert.ok(chatIds.includes('cyrene-nickname'), 'chat 应挂 cyrene-nickname');
  assert.ok(!workIds.includes('cyrene-nickname'), 'cyrene-work 不应挂 cyrene-nickname');
});

test('预设：cyrene-work 的工具行是 standard 的抄本 —— 只允许已知附加项', { skip: skipUpstream }, () => {
  const stdIds = rowIds(parse(upstream.stdPath));
  const mineIds = rowIds(parse(presetFile('cyrene-work')));

  // 1) 我们**不能少**：少一行就是 DSH 升级后抄本漂移的直接证据
  const missing = stdIds.filter((id) => !mineIds.includes(id));
  assert.deepEqual(
    missing,
    [],
    `cyrene-work 比内置 standard 少挂了：${missing.join(', ')}\n`
      + '→ 内置预设变了而这份抄本没跟上。请把缺失的行补进 preset/cyrene-work/agent.cordis.yml，'
      + '或确认该行是被上游有意移除的。',
  );

  // 2) 我们**只能多**这些：多出别的说明有人往抄本里塞了东西
  const ADDED = ['cyrene-memory', 'dsh-cyrene-worldbook'];
  const extra = mineIds.filter((id) => !stdIds.includes(id)).sort();
  assert.deepEqual(
    extra,
    [...ADDED].sort(),
    `cyrene-work 相对 standard 多出的行不是预期集合。\n`
      + `  实际多出：${extra.join(', ') || '(无)'}\n`
      + `  预期只多：${ADDED.join(', ')}\n`
      + '→ 新增了附加行就把 ADDED 一起改掉；不是有意为之就删掉。',
  );
});
