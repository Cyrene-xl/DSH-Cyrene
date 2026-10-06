#!/usr/bin/env node
/**
 * 把 `preset/<id>/` 下的预设转换成 **DSH ≥ 0.2.0 的声明式写法**。
 *
 * ## 为什么需要这个
 *
 * DSH 0.2.0 换掉了预设的发现机制。0.2.0-rc.2 的
 * `@deepseek-ai/dsh-agent-preset-registry` 文档里写得很直白：
 *
 *   > 注册表不扫描目录，也不接受 preset 路径。
 *   > 新建 preset 或覆盖内置 preset 都是 bundle 补丁：插入一行
 *   > `@deepseek-ai/dsh-agent-preset` …… 再用 `plugin_manager` 安装到 profile
 *
 * 而本仓库 `scripts/install.mjs` 做的是"把目录拷进 `~/.dsh/.agent-presets/`" ——
 * 那是 0.1.x 的机制。在 0.2.0+ 上它**依然会成功执行、依然报"已安装"**，
 * 但预设根本不会出现，且没有任何报错。实测反馈里那位 Windows 用户撞的就是这个。
 *
 * ## 声明结构（0.2.0-rc.2 的 PresetDefinition）
 *
 *   id / name? / description? / order? / plugins（**必填**，是一份 entry list）
 *
 * 而 `preset/<id>/agent.cordis.yml` **本身就是**一份 entry list —— 所以这里只做
 * 机械的"整体缩进 + 套一层 config"，不重写、不改写任何一行组合内容。
 *
 * ## 用法
 *
 *   node scripts/export-preset-declarations.mjs              # 全部预设 → stdout
 *   node scripts/export-preset-declarations.mjs cyrene-work  # 只要一个
 *
 * 输出的片段贴到 `<DSH_HOME>/profiles/<profile>/cordis.patch.yml`：那个文件顶层是数组，
 * 把输出**作为一个新元素追加进去**（输出**自带 `- insert:` 那一层，别去掉** ——
 * 理由见下面 declarationFor 里的注释），或者按 0.2.0 文档的路子做成 bundle 补丁
 * 再用 `dsh plugin add` 装进 profile。
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', 'preset');

/** 从 preset.yml 里取一个标量字段（不引 YAML 解析器，保持仓库零依赖）。 */
function metaField(text, key) {
  const m = text.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

/** YAML 单引号字符串：内部单引号加倍。 */
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * 把一个预设转成声明行。
 * @param id - 预设 id（也就是目录名）。
 * @returns 可直接贴进 patch 的 YAML 文本。
 */
export function declarationFor(id) {
  const dir = join(srcRoot, id);
  const compositionPath = join(dir, 'agent.cordis.yml');
  if (!existsSync(compositionPath)) throw new Error(`找不到组合文件：${compositionPath}`);

  const metaPath = join(dir, 'preset.yml');
  const meta = existsSync(metaPath) ? readFileSync(metaPath, 'utf8') : '';
  const name = metaField(meta, 'name');
  const description = metaField(meta, 'description');
  const order = metaField(meta, 'order');

  // 组合整体嵌进 `plugins:` —— 逐行平移，块标量的相对缩进不变，
  // 所以 `prefix: |` 里的正文不会被破坏。
  //
  // 缩进层级：patch 数组 → `- insert:`（0）→ 行（4）→ config（6）→ plugins（8）→ 组合（10）
  const indented = readFileSync(compositionPath, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/, '')
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : ' '.repeat(10) + line))
    .join('\n');

  // ⚠️ 必须套 `- insert:`，不能把声明行裸着放进 patch 数组。
  //
  // dsh-app-boot 应用 patch 时是这个顺序（见其 lib/index.js）：
  //
  //   if (insert) { … data.push(...insert); continue; }        // ← 插入
  //   if (!id) { warn('patch: id is required for non-insert patches'); continue; }
  //   const target = entryMap.get(id);
  //   if (!target) { warn("patch: entry %C not found"); continue; }  // ← 裸行走到这里
  //
  // 也就是说裸的 `- id: preset-x` 会被当成"**按 id 覆盖一个已有条目**"，
  // 而那个 id 当然不存在 → 被跳过。**看起来像"追加成功了"，实际什么都没发生**
  // —— 跟本仓库踩过的 install.mjs 那个坑是同一类静默失效。
  const head = [
    `# ── ${name || id}（id: ${id}）${'─'.repeat(Math.max(0, 40 - id.length))}`,
    '- insert:',
    '    - id: preset-' + id,
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: ' + quote(id),
  ];
  if (name !== '') head.push('        name: ' + quote(name));
  if (description !== '') head.push('        description: ' + quote(description));
  if (order !== '') head.push('        order: ' + order);
  head.push('        plugins:');

  return head.join('\n') + '\n' + indented + '\n';
}

/** 所有含 agent.cordis.yml 的预设 id，按名字排序。 */
export function presetIds() {
  return readdirSync(srcRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(srcRoot, e.name, 'agent.cordis.yml')))
    .map((e) => e.name)
    .sort();
}

function main() {
  const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const ids = want.length > 0 ? want : presetIds();
  const missing = ids.filter((id) => !existsSync(join(srcRoot, id, 'agent.cordis.yml')));
  if (missing.length > 0) {
    console.error(`错误：这些预设不存在 —— ${missing.join(', ')}`);
    process.exit(1);
  }
  const out = ids.map(declarationFor).join('\n');
  const toFile = (process.argv.find((a) => a.startsWith('--out=')) || '').slice('--out='.length);
  if (toFile) {
    writeFileSync(toFile, out);
    console.log(`已写入 ${toFile}（${ids.length} 个预设：${ids.join(', ')}）`);
  } else {
    process.stdout.write(out);
  }
}

/**
 * 判断"是不是直接跑的"。
 *
 * ⚠️ **不要**写成 ``import.meta.url === `file://${process.argv[1]}` ``。
 * 那个写法在 Linux/macOS 上碰巧成立，在 Windows 上永远不成立：
 *
 *   process.argv[1]  →  C:\repo\scripts\export-preset-declarations.mjs
 *   import.meta.url  →  file:///C:/repo/scripts/export-preset-declarations.mjs
 *   拼出来的         →  file://C:\repo\scripts\...   ← 永不相等
 *
 * 后果是 main() 从不执行：**退出码 0、输出零字节、没有任何报错**。
 * 这是真实反馈里踩到的（那位 Windows 用户三种调用方式都试了，全是空输出，
 * 最后绕过去直接调 declarationFor() 才成功）。
 *
 * 必须走 pathToFileURL —— 它会把平台差异（盘符、分隔符、转义）处理掉。
 */
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) main();
