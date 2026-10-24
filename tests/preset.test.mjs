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
  try {
    YAML = createRequire(join(DSH_INSTALL, 'package.json'))('yaml');
  } catch {
    return undefined;
  }
  if (typeof YAML?.parse !== 'function') return undefined;
  const jsTag = { tag: '!<tag:yaml.org,2002:js>', resolve: (v) => ({ js: v }) };
  const readRows = (file) => {
    try {
      return YAML.parse(readFileSync(file, 'utf8'), { customTags: [jsTag] });
    } catch {
      return null;
    }
  };

  /* 0.1.x：预设包是复数 @deepseek-ai/dsh-agent-presets，standard 是完整预设文件。 */
  try {
    const req = createRequire(join(DSH_INSTALL, 'package.json'));
    const presetsPkg = req.resolve('@deepseek-ai/dsh-agent-presets/package.json');
    const stdPath = join(dirname(presetsPkg), 'presets', 'standard', 'agent.cordis.yml');
    const rows = readRows(stdPath);
    if (Array.isArray(rows)) return { YAML, stdRows: rows, stdSource: stdPath };
  } catch {
    /* 0.2.x 里没有这个包，继续往下 */
  }

  /* 0.2.x：包名单数，standard 变成 dsh-web-app 的 patch 行，插件列表在 insert[].config.plugins。 */
  const stdPath = join(DSH_INSTALL, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', 'standard.patch.yml');
  const patch = readRows(stdPath);
  const plugins = patch?.[0]?.insert?.[0]?.config?.plugins;
  if (Array.isArray(plugins)) return { YAML, stdRows: plugins, stdSource: stdPath };
  return undefined;
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

guarded('预设：语气补充（本项目补充）必须在，且只属于对话模式', () => {
  // 这两条来自外部评价/衍生版的观察：固定 7:3 会让她机械换词，♪ 会退化成句尾标点。
  // 它们是对上游正文的**补充覆盖**，所以放在「语气规则」之后，并标明非上游正文。
  const chat = readFileSync(presetFile('chat'), 'utf8')
  assert.ok(chat.includes('自称与「♪」的用量（本项目补充，非上游正文）'), '项目补充段不能丢');
  assert.ok(chat.includes('短回复最多 1 个'), '♪ 的数量上限要在');
  assert.ok(chat.includes('这个切换本身就是情绪信号'), '自称按情境切换要在');
  assert.ok(
    chat.indexOf('自称与「♪」的用量') > chat.indexOf('## 语气规则'),
    '补充段必须排在语气规则之后（覆盖关系）',
  );
  // 工作模式不用 soul.md，也就不该带这段
  const work = readFileSync(presetFile('cyrene-work'), 'utf8')
  assert.equal(work.includes('自称与「♪」的用量'), false, '工作模式不该带这段');
});

guarded('预设：工作模式也补了「通用语气规则」（上游的第五层）', () => {
  // 上游 tone-injector.ts 的语气规则是**每轮尾部注入、所有模式都吃**的；我们合成静态
  // 正文后那个时序机制没了 —— chat 预设补过，work 预设曾经漏了。这条守着别漏回去。
  const work = readFileSync(presetFile('cyrene-work'), 'utf8')
  assert.ok(work.includes('## 语气规则（本项目补充，非上游正文）'), '工作模式必须有语气规则段');
  for (const line of [
    '不可以使用「不是……而是……」结构',
    '自称：表达情感、撒娇、被打动时用「人家」',
    '结尾常用反问把话交给对方',
    '优先回应情绪，再回应内容',
  ]) {
    assert.ok(work.includes(line), `上游原文缺了：${line}`);
  }
  // 三处工作场景例外必须在（否则会和写法要求/追问节制打架）
  assert.ok(work.includes('### 工作场景的三处例外（本项目补充，非上游正文）'), '三处例外必须在');
  for (const keyword of ['反问收尾等于把决定推回给对方', '先给结论或判断', '要指出问题与改法']) {
    assert.ok(work.includes(keyword), `例外条目缺了：${keyword}`);
  }
  // 顺序：语气规则 → 例外 → 追问节制（覆盖关系必须"后写"）。
  // 断言要锚在**真正的标题行**上：文件头注释里也引用了这些标题（写作「## 语气规则」，
  // 没有「（本项目补充）」后缀），用 indexOf 找裸标题会命中注释、把顺序比反。
  const at = (heading) => work.indexOf('\n      ' + heading);
  const tone = at('## 语气规则（本项目补充，非上游正文）');
  const exceptions = at('### 工作场景的三处例外（本项目补充，非上游正文）');
  const followUp = at('## 追问节制（本项目补充，非上游正文）');
  assert.ok(tone !== -1 && exceptions !== -1 && followUp !== -1, '三个标题行都要真的存在（不只是注释里被提到）');
  assert.ok(tone < exceptions, '三处例外必须排在语气规则之后');
  assert.ok(exceptions < followUp, '追问节制必须排在最后（它是更硬的覆盖）');
})

guarded('预设：表达风格只挂对话模式 —— 工作模式禁用（安全约定）', () => {
  // 风格只改"怎么说"，但它确实是往提示词里塞话；工作模式带 shell / 文件 / 网络
  // 这些真能动东西的工具，一份带着强烈依恋感的写作风格配上权限就是越权的诱因。
  //
  // 上游本来也不给 work / code 注入风格（BUILT_IN_STYLE_PRESETS 只在非 task 模式
  // 生效），所以这里不是"少做了一件"，而是"和上游一致 + 多一道保险"：
  //   - 预设层面：工作模式不挂这个插件；
  //   - 运行时保险：style.js 的 DISABLED_PRESETS 里也有 cyrene-work，
  //     万一将来被误挂进去，运行时也会自己拒掉（见 tests/style.test.mjs）。
  const chatIds = rowIds(parse(presetFile('chat')));
  const workIds = rowIds(parse(presetFile('cyrene-work')));
  assert.ok(chatIds.includes('cyrene-style'), '对话模式应该挂 cyrene-style');
  assert.ok(
    !workIds.includes('cyrene-style'),
    '工作模式不能挂 cyrene-style —— 风格在工作模式里是刻意禁用的',
  );
  // 场景开关同理：它是"聊天里的扮演"，工作模式（带工具、面对任务）不该被旁白体干扰。
  assert.ok(chatIds.includes('cyrene-scene'), '对话模式应该挂 cyrene-scene');
  assert.ok(!workIds.includes('cyrene-scene'), '工作模式不能挂 cyrene-scene');
});

guarded('预设：cyrene-work 的工具行是 standard 的抄本 —— 只允许已知附加项', () => {
  const stdIds = rowIds(upstream.stdRows);
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
  const ADDED = [
    'cyrene-memory',
    'dsh-cyrene-worldbook',
    /* 可选 provider：standard 里没有，本预设显式关掉留档。 */
    'tool-subagent-codex',
    'tool-subagent-claude-code',
    /* workflow 默认关闭的三行：standard 里有 tool-workflow，没有这两个。 */
    'workflow-worker-thread',
    'tool-ralph',
  ];
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
  const INTENTIONALLY_DISABLED = [
    /* workflow 三件套 + ptc 变体：依赖 workflowEngine，起不来会连累整条预设。 */
    'workflow-worker-thread',
    'tool-workflow',
    'tool-ralph',
    'workflow-ptc',
    /* 可选 subagent provider：standard 里没有这两行，本预设留档但关掉。 */
    'tool-subagent-codex',
    'tool-subagent-claude-code',
  ];
  const mine = parse(presetFile('cyrene-work'));
  const std = upstream.stdRows;
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

test('发版：三处版本号必须一致，且 CHANGELOG 里有对应条目', () => {
  // 这条不是形式主义：版本号散在三个清单文件里，**漏改一个不会报错**，
  // 只会让某一部分使用者看到旧号（上次被评审抓到的就是这个）。
  // 打 tag 时最容易只改 package.json —— 所以让"三处一致"变成可检查的事实。
  const read = (f) => JSON.parse(readFileSync(join(repoRoot, f), 'utf8'));
  const pkg = read('package.json');
  const listed = {
    'package.json (version)': pkg.version,
    'package.json (dsh.version)': pkg.dsh?.version,
    'plugin.json': read('plugin.json').version,
    'dsh.plugin.json': read('dsh.plugin.json').version,
  };
  const distinct = [...new Set(Object.values(listed))];
  assert.equal(
    distinct.length,
    1,
    `版本号不一致：${Object.entries(listed).map(([k, v]) => `${k}=${v}`).join('，')}\n`
      + '→ 三处清单必须同时改（package.json 里有两处）。',
  );
  const version = distinct[0];
  assert.match(version, /^\d+\.\d+\.\d+$/, `版本号形状不对：${version}`);

  // 打了 tag 却没写更新记录，使用者就不知道要不要升级 —— 这条把它绑在一起。
  const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
  assert.ok(
    changelog.includes(`## [${version}]`),
    `CHANGELOG.md 里没有 ${version} 的条目 —— 发版前先写「要不要升级、升级能解决什么」`,
  );
});
