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
import { execFileSync } from 'node:child_process';
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

/**
 * 本文件**每一条**测试都要经过它 —— 全都依赖 `yaml` 与内置 standard 预设。
 *
 * ⚠️ 别改成裸 `test(...)`。这里原本是逐条手写 `{ skip }`，结果只给第三条加了，
 *    前两条照跑，CI 上直接 `TypeError: Cannot read properties of undefined
 *    (reading 'YAML')` —— 两次 job 全红。统一走这个入口，就不存在"漏加一条"。
 */
const guarded = (name, fn) => test(name, { skip: skipUpstream }, fn);

guarded('预设：两个预设的 YAML 都能解析，且都是完整替换系统提示词', () => {
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

guarded('预设：两套预设挂的插件不完全相同 —— 别把「挂预设里」当成「两个模式都有」', () => {
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

guarded('预设：cyrene-work 的工具行是 standard 的抄本 —— 只允许已知附加项', () => {
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

  // 3) 与上游**有意不同**的地方：这三行我们默认 disabled。
  //
  //    它们依赖 `workflowEngine`，而该服务在某些部署里起不来（实测 DSH 桌面端
  //    0.2.0-rc.2）：`tool-workflow` / `tool-ralph` 会一直 waiting，激活审计据此
  //    判定**整条预设加载失败** —— 用户看到的是预设根本不出现。
  //    取舍：少三个工具 ≪ 整条预设加载失败。
  //
  //    这条断言的作用：将来若有人从 standard 重新整段抄一遍，会把 disabled 一起
  //    丢掉、于是又踩回同一个坑。这里点出来，改的话必须同时改这行。
  const INTENTIONALLY_DISABLED = ['workflow-worker-thread', 'tool-workflow', 'tool-ralph'];
  const mine = parse(presetFile('cyrene-work'));
  const std = parse(upstream.stdPath);
  const disabledOf = (rows) => {
    const out = [];
    const walk = (list) => {
      for (const row of list ?? []) {
        if (row && typeof row === 'object') {
          if (row.disabled === true && typeof row.id === 'string') out.push(row.id);
          if (row.group === true) walk(row.config);
        }
      }
    };
    walk(rows);
    return out;
  };
  const mineDisabled = disabledOf(mine);
  const stdDisabled = disabledOf(std);
  const newlyDisabled = mineDisabled.filter((id) => !stdDisabled.includes(id)).sort();
  assert.deepEqual(
    newlyDisabled,
    [...INTENTIONALLY_DISABLED].sort(),
    `cyrene-work 相对 standard 关闭的行不是预期集合。\n`
      + `  实际多关：${newlyDisabled.join(', ') || '(无)'}\n`
      + `  预期只关：${INTENTIONALLY_DISABLED.join(', ')}\n`
      + '→ 这三行依赖 workflowEngine，在起不来它的部署上会让**整条预设**判失败。'
      + '改这个集合就要同时改这条断言。',
  );
});

test('声明导出：0.2.0 的声明里 plugins 必须与原组合逐字相等', () => {
  // DSH 0.2.0 起预设改为声明式注册（`@deepseek-ai/dsh-agent-preset` 的 config.plugins），
  // 目录扫描不再生效。scripts/export-preset-declarations.mjs 负责把我们的组合
  // 机械转换过去 —— 它要是缩进错一格、或者漏掉一段块标量，产出的声明就会**静默**
  // 与源不一致。所以这里做往返比对：解析生成结果，与原组合深度相等才算通过。
  //
  // 本用例不依赖 DSH：只用到 node:child_process 与仓库自身的文件。

  const generator = join(repoRoot, 'scripts', 'export-preset-declarations.mjs');
  assert.ok(existsSync(generator), '生成器必须存在');

  for (const id of PRESETS) {
    const out = execFileSync(process.execPath, [generator, id], { encoding: 'utf8' });

    // ① 必须是合法的 **patch** 形态：顶层套 `- insert:`。
    //
    // 少了这层，声明行就变成"按 id 覆盖已有条目"（见 dsh-app-boot 的 patch 应用逻辑：
    // `if (insert) {...continue}` 之后才轮到 `entryMap.get(id)`），而那个 id 当然不存在
    // → 被跳过。表现是"看起来追加成功了，实际什么都没发生"。
    // 所以下面两条断言盯的就是这个：顶层不能出现裸 `id:` / 裸 `name:`。
    assert.match(out, /^- insert:$/m, `${id} 的输出必须含顶格的 - insert:`);
    const topLevel = out.split('\n').filter((l) => !l.startsWith(' ') && l.trim() !== '' && !l.startsWith('#'));
    for (const line of topLevel) {
      assert.equal(
        line,
        '- insert:',
        `${id} 的 patch 顶层只允许出现 "- insert:"，却出现了：${line}\n`
          + '→ 裸的声明行会被当成"按 id 覆盖已有条目"而被静默跳过。',
      );
    }

    // ② 组合正文必须与源逐字一致（反缩进后比对）。
    // 生成结果 = 注释 + `- insert:` + 声明头 + `        plugins:` + 缩进 10 格的组合。
    // 所以起点要认 **`plugins:` 之后**那一行 —— 不能找第一个 `- id:`：
    // 第一个 `- id:` 是声明自身（更深缩进），照它反缩进会得到错的结果（这个坑踩过）。
    const dedent = (text) => {
      const lines = text.replace(/\r\n/g, '\n').split('\n');
      const marker = lines.findIndex((l) => l.trim() === 'plugins:');
      assert.ok(marker >= 0, `${id} 的生成结果里找不到 plugins:`);
      const body = lines.slice(marker + 1).filter((l) => l.trim() !== '');
      assert.ok(body.length > 0, `${id} 的 plugins: 之后是空的`);
      const base = Math.min(...body.map((l) => l.length - l.trimStart().length));
      return body.map((l) => l.slice(base)).join('\n').trimEnd();
    };
    const src = readFileSync(presetFile(id), 'utf8')
      .replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '').join('\n').trimEnd();
    // 生成结果里，组合被整体缩进 6 格再嵌进 plugins:，反缩进后还应与源一致；
    // 但生成结果前面多了声明头，所以只取从 `- id: persona` 起的那段。
    const genBody = dedent(out);
    const srcBody = src.slice(src.indexOf('- id: persona'));
    assert.equal(
      genBody.slice(genBody.indexOf('- id: persona')),
      srcBody,
      `${id} 的声明导出与源组合不一致 —— 生成器缩进逻辑坏了`,
    );
  }
});
