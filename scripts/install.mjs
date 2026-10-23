#!/usr/bin/env node
/**
 * 跨平台的预设安装脚本（无 shell 依赖，Node 22+）。
 *
 * DSH 的 agent 预设由 dsh-agent-presets 按 ~/.dsh/.agent-presets/<id>/ 目录
 * 扫描发现，没有公开的安装 API，所以预设必须由外部脚本拷贝到位。
 *
 * 预设 id **自动发现**：preset/chat/ → 装成 chat，preset/cyrene-work/ → cyrene-work。
 *
 * ## 这是一次「Profile 变更」，所以按变更来对待
 *
 * 写之前先出**一次性安装计划**；写入要**精确确认**（`--yes`，或在终端里手输 yes）；
 * 每个目标在计划时算好 sha-256 **前置哈希**，写之前再核对一次（防止期间被并发改动）；
 * 覆盖前**备份**，落盘用**原子**重命名；写完全部目标跑一次**健康检查**（逐目录比指纹、
 * 补丁里必须有我们的标记）；任何一步失败都自动**回滚**到计划前的状态。
 *
 * 全过程记在 `<DSH_HOME>/.cyrene-install-journal.json`（journal）。中途硬失败且回滚
 * 失败时会标 `recovery-required`，之后用 `--rollback` 按 journal 精确恢复。
 *
 * 用法：
 *   node scripts/install.mjs --dry-run     # 只打印计划，不写任何文件
 *   node scripts/install.mjs --yes         # 非交互确认（CI/脚本用这个）
 *   node scripts/install.mjs --force       # 覆盖已有且不同的预设（仍会确认）
 *   node scripts/install.mjs --rollback    # 按 journal 恢复到上一次安装前
 *   node scripts/install.mjs --uninstall   # 卸载（同样需要确认）
 */
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declarationFor } from './export-preset-declarations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', 'preset');
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const journalPath = join(dshHome, '.cyrene-install-journal.json');

const argv = new Set(process.argv.slice(2));
const force = argv.has('--force');
const uninstall = argv.has('--uninstall');
const dryRun = argv.has('--dry-run');
const assumeYes = argv.has('--yes');
const rollbackMode = argv.has('--rollback');

/** 目录内容指纹：相对路径 + 文件内容，按路径排序后哈希。 */
async function dirFingerprint(dir) {
  const hash = createHash('sha256');
  const walk = async (current) => {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      hash.update(relative(dir, full));
      hash.update(await readFile(full));
    }
  };
  await walk(dir);
  return hash.digest('hex');
}

/** 单文件 sha-256 前置哈希。 */
async function fileSha256(path) {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex');
  } catch {
    return null;
  }
}

/** 自动发现 preset/ 下每个含 agent.cordis.yml 的子目录。 */
async function discoverPresetIds() {
  const entries = await readdir(srcRoot, { withFileTypes: true });
  const ids = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    if (!existsSync(join(srcRoot, entry.name, 'agent.cordis.yml'))) continue;
    ids.push(entry.name);
  }
  return ids;
}

/**
 * 「声明式注册表」那一代才有的插件（DSH 0.2.0+）。
 * 为什么用"这个包装没装"判断代数：探测版本要联网或猜安装路径，而这个包在不在
 * profile 的 node_modules 里是能确定的。
 */
const DECLARATIVE_PLUGIN = '@deepseek-ai/dsh-agent-preset';
/** 我们写进 profile 补丁的那段以这行开头，用来判重（幂等）。 */
const DECLARATIVE_MARKER = '# ── dsh-cyrene 预设声明（自动写入，勿手改）────────────────────';

/** 找出需要写声明的 profile：既装了注册表插件，又装了本包。 */
async function declarativeProfiles() {
  const root = join(dshHome, 'profiles');
  const out = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (!existsSync(join(dir, 'node_modules', DECLARATIVE_PLUGIN))) continue;
    if (!existsSync(join(dir, 'node_modules', 'dsh-cyrene'))) continue;
    out.push({ name: entry.name, dir });
  }
  return out;
}

/** 读 journal；没有/坏掉返回 null。 */
async function readJournal() {
  try {
    return JSON.parse(await readFile(journalPath, 'utf8'));
  } catch {
    return null;
  }
}

/** 写 journal（操作记录）。 */
async function writeJournal(value) {
  await mkdir(dirname(journalPath), { recursive: true });
  await writeFile(journalPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * 计算一次性安装计划。**只读**：不写任何文件。
 * @param ids - 预设 id 列表。
 */
async function planChanges(ids) {
  const presets = [];
  for (const id of ids) {
    const src = join(srcRoot, id);
    const dest = join(dshHome, '.agent-presets', id);
    const srcFingerprint = await dirFingerprint(src);
    const exists = existsSync(dest);
    const destFingerprint = exists ? await dirFingerprint(dest) : null;
    const same = exists && destFingerprint === srcFingerprint;
    const action = !exists ? 'install' : same ? 'skip' : force ? 'replace' : 'refuse';
    presets.push({ id, src, dest, exists, srcFingerprint, destFingerprint, action });
  }

  const profiles = [];
  for (const profile of await declarativeProfiles()) {
    const patchPath = join(profile.dir, 'cordis.patch.yml');
    let current = '';
    try {
      current = await readFile(patchPath, 'utf8');
    } catch {
      current = '';
    }
    const hasMarker = current.includes(DECLARATIVE_MARKER);
    profiles.push({
      name: profile.name,
      dir: profile.dir,
      patchPath,
      exists: existsSync(patchPath),
      sha256: await fileSha256(patchPath),
      hasMarker,
      action: hasMarker ? 'skip' : 'append',
    });
  }
  return { presets, profiles };
}

/** 打印一次性安装计划。 */
function printPlan(plan) {
  console.log('一次性安装计划：');
  console.log(`  目标 DSH_HOME：${dshHome}`);
  for (const item of plan.presets) {
    const label = {
      install: '新建',
      replace: '覆盖（旧目录会备份）',
      skip: '已是最新，跳过',
      refuse: '已存在且不同 —— 需要 --force',
    }[item.action];
    console.log(`  预设 ${item.id}：${label}`);
    console.log(`    → ${item.dest}`);
    if (item.exists) console.log(`    前置哈希：sha-256 ${item.destFingerprint}`);
  }
  for (const item of plan.profiles) {
    const label = item.action === 'append' ? '追加声明' : '已有声明，跳过';
    console.log(`  profile ${item.name}：${label}`);
    console.log(`    → ${item.patchPath}`);
    if (item.sha256 !== null) console.log(`    前置哈希：sha-256 ${item.sha256}`);
  }
}

/**
 * 精确确认。
 * 终端里要手输 yes；非交互环境必须显式 `--yes`，否则不写任何文件。
 */
async function confirmOrExit() {
  if (dryRun) return;
  if (assumeYes) {
    console.log('精确确认：--yes');
    return;
  }
  if (!process.stdin.isTTY) {
    console.error('');
    console.error('拒绝继续：这是 Profile 变更，非交互环境需要显式确认。');
    console.error('  确认后重跑：node scripts/install.mjs --yes');
    console.error('  只想看会改什么：node scripts/install.mjs --dry-run');
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('确认要写入以上位置吗？输入 yes 继续：')).trim().toLowerCase();
  rl.close();
  if (answer !== 'yes') {
    console.error('已取消，没有写入任何文件。');
    process.exit(1);
  }
}

/** 写之前再核对一次前置哈希（防止计划之后目标被并发改动）。 */
async function assertPresetPrecondition(item) {
  if (!item.exists) return;
  const now = await dirFingerprint(item.dest);
  if (now !== item.destFingerprint) {
    throw new Error(`前置哈希不符（计划之后目录被改动）：${item.dest}`);
  }
}

/** 写补丁的正文。 */
function nextPatchText(current, ids) {
  const body = `${DECLARATIVE_MARKER}\n${ids.map((id) => declarationFor(id)).join('\n')}\n`;
  const trimmed = current.trim();
  return trimmed === '' || trimmed === '[]'
    ? body
    : `${current.replace(/\s*$/, '')}\n\n${body}`;
}

/**
 * 原子写入一个文件的替换：备份 → 写临时文件 → rename 覆盖。
 * @returns `{ backup }`。
 */
async function writeFileAtomic(target, next) {
  let backup = null;
  if (existsSync(target)) {
    backup = `${target}.bak.${Date.now()}`;
    await copyFile(target, backup);
    console.log(`  已备份 → ${backup}`);
  }
  const tmp = `${target}.tmp.${process.pid}`;
  await writeFile(tmp, next, 'utf8');
  await rename(tmp, target);
  return { backup };
}

/**
 * 原子替换一个目录：备份（rename 走开）→ 拷到临时目录 → rename 到位。
 * @returns `{ backup }`。
 */
async function replaceDirAtomic(src, dest) {
  let backup = null;
  if (existsSync(dest)) {
    backup = `${dest}.bak.${Date.now()}`;
    await rename(dest, backup);
    console.log(`  已备份 → ${backup}`);
  }
  const tmp = `${dest}.tmp.${process.pid}`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(dirname(tmp), { recursive: true });
  await cp(src, tmp, { recursive: true });
  await rename(tmp, dest);
  return { backup };
}

/**
 * 回滚：按 journal（或本次内存里的记录）把目标恢复到安装前。
 * @param records - `[{ kind, target, backup }]`。
 */
async function rollback(records) {
  let ok = true;
  for (const record of [...records].reverse()) {
    try {
      if (record.kind === 'preset') {
        await rm(record.target, { recursive: true, force: true });
        if (record.backup !== null) await rename(record.backup, record.target);
      } else if (record.kind === 'patch') {
        if (record.backup !== null) await copyFile(record.backup, record.target);
        else await rm(record.target, { force: true });
      }
      console.log(`  已回滚：${record.target}`);
    } catch (error) {
      ok = false;
      console.error(`  回滚失败：${record.target} —— ${String(error?.message ?? error)}`);
    }
  }
  return ok;
}

/** 安装后健康检查：目录指纹一致、补丁里有我们的标记。 */
async function healthCheck(plan, ids) {
  for (const item of plan.presets) {
    if (item.action === 'skip') continue;
    const got = await dirFingerprint(item.dest);
    if (got !== item.srcFingerprint) {
      throw new Error(`健康检查失败（目录指纹不符）：${item.dest}`);
    }
  }
  for (const item of plan.profiles) {
    if (item.action !== 'append') continue;
    const text = await readFile(item.patchPath, 'utf8').catch(() => '');
    if (!text.includes(DECLARATIVE_MARKER)) {
      throw new Error(`健康检查失败（补丁里没有声明标记）：${item.patchPath}`);
    }
  }
  console.log('健康检查通过。');
}

/** 从 journal 恢复上一次安装。 */
async function rollbackFromJournal() {
  const journal = await readJournal();
  if (journal === null || !Array.isArray(journal.records)) {
    console.error(`没有可用的 journal：${journalPath}`);
    process.exit(1);
  }
  console.log(`按 journal 回滚（记录时间 ${journal.at}）：`);
  const ok = await rollback(journal.records);
  await writeJournal({ ...journal, status: ok ? 'rolled-back' : 'recovery-required', rolledBackAt: new Date().toISOString() });
  console.log(ok ? '回滚完成。' : '回滚未完全成功，journal 标记为 recovery-required。');
  process.exit(ok ? 0 : 1);
}

async function main() {
  if (!existsSync(srcRoot)) {
    console.error(`错误：找不到预设源目录 ${srcRoot}`);
    process.exit(1);
  }

  const ids = await discoverPresetIds();
  if (ids.length === 0) {
    console.error(`错误：${srcRoot} 下没有找到任何预设（需要 <id>/agent.cordis.yml）`);
    process.exit(1);
  }

  if (rollbackMode) return rollbackFromJournal();

  console.log(`预设源：${srcRoot}`);
  console.log(`发现预设：${ids.join(' ')}`);

  if (uninstall) {
    console.log('');
    console.log('一次性卸载计划：');
    const targets = await declarativeProfiles();
    for (const target of targets) {
      console.log(`  profile ${target.name} 的补丁里可能有声明：${join(target.dir, 'cordis.patch.yml')}`);
    }
    for (const id of ids) {
      console.log(`  删除预设目录：${join(dshHome, '.agent-presets', id)}`);
    }
    if (targets.length > 0) {
      console.log('');
      console.log('注意：这些 profile 用的是「声明式注册表」代，预设声明写在 profile 补丁里：');
      for (const target of targets) {
        console.log(`  ${join(target.dir, 'cordis.patch.yml')}`);
      }
      console.log(`  请手动删掉以「${DECLARATIVE_MARKER}」开头的那一段（到文件末尾），再重启 DSH。`);
      console.log('  这里不自动删：那段后面可能已经被你追加了自己的配置，截断会连带删掉。');
    }
    if (dryRun) {
      console.log('');
      console.log('--dry-run：没有删除任何东西。');
      return;
    }
    await confirmOrExit();
    for (const id of ids) {
      const dest = join(dshHome, '.agent-presets', id);
      if (existsSync(dest)) {
        await rm(dest, { recursive: true, force: true });
        console.log(`已卸载预设：${dest}`);
      } else {
        console.log(`无需卸载：${dest} 不存在`);
      }
    }
    return;
  }

  // ── 计划 ──────────────────────────────────────────────────────────────
  const plan = await planChanges(ids);
  console.log('');
  printPlan(plan);

  const refused = plan.presets.filter((item) => item.action === 'refuse');
  if (refused.length > 0) {
    console.error('');
    for (const item of refused) {
      console.error(`拒绝覆盖：${item.dest} 已存在且与预设不同。`);
    }
    console.error('  这通常意味着你已经改过自己的预设（比如调了口吻）。');
    console.error('  确认要覆盖请加 --force（会先备份，且仍要确认）。');
    process.exit(1);
  }

  const nothingToDo = plan.presets.every((item) => item.action === 'skip')
    && plan.profiles.every((item) => item.action === 'skip');
  if (nothingToDo) {
    console.log('');
    console.log('已是最新，无需改动。');
    return;
  }

  if (dryRun) {
    console.log('');
    console.log('--dry-run：以上只是计划，没有写入任何文件。');
    return;
  }

  await confirmOrExit();

  // ── 写入（原子 + 前置哈希 + 失败回滚）─────────────────────────────────
  const records = [];
  const journal = {
    schema: 1,
    at: new Date().toISOString(),
    status: 'applying',
    dshHome,
    records,
  };
  try {
    for (const item of plan.profiles) {
      if (item.action !== 'append') continue;
      console.log('');
      console.log(`── profile: ${item.name} ──`);
      const currentSha = await fileSha256(item.patchPath);
      if (currentSha !== item.sha256) {
        throw new Error(`前置哈希不符（计划之后补丁被改动）：${item.patchPath}`);
      }
      const current = item.exists ? await readFile(item.patchPath, 'utf8') : '';
      const { backup } = await writeFileAtomic(item.patchPath, nextPatchText(current, ids));
      records.push({ kind: 'patch', target: item.patchPath, backup });
      console.log(`  ✅ 已写入预设声明：${item.patchPath}`);
    }

    for (const item of plan.presets) {
      if (item.action === 'skip') continue;
      console.log('');
      console.log(`── ${item.id} ──`);
      console.log(`目标位置：${item.dest}`);
      await assertPresetPrecondition(item);
      const { backup } = await replaceDirAtomic(item.src, item.dest);
      records.push({ kind: 'preset', target: item.dest, backup });
      console.log(`✅ 已安装：${item.dest}`);
    }

    await healthCheck(plan, ids);
    await writeJournal({ ...journal, status: 'applied' });
  } catch (error) {
    console.error('');
    console.error(`安装失败：${String(error?.message ?? error)}`);
    const ok = await rollback(records);
    await writeJournal({ ...journal, status: ok ? 'rolled-back' : 'recovery-required' });
    if (!ok) {
      console.error('回滚未完全成功：journal 已标为 recovery-required，可运行 --rollback 再试。');
    }
    process.exit(1);
  }

  // ── 提示 ──────────────────────────────────────────────────────────────
  if (plan.profiles.length > 0) {
    console.log('');
    console.log('预设声明已经写进上面那些 profile，**不需要再手动贴**。');
    console.log('重启 DSH 后两套模式就会出现。');
    console.log('（声明式代用不到目录副本，不影响它们。）');
  } else {
    console.log('');
    console.log('如果这个 DSH 是 0.2.0 或更新：上面的目录方式【不会生效】（不报错，只是预设不出现）。');
    console.log('  正确顺序是：');
    console.log('    1) 先把插件装进 profile：dsh plugin --profile <名字> add link:<本仓库路径>');
    console.log('    2) 再重跑本脚本 —— 它会自动识别这一代并把声明写进去，不用手动贴。');
    console.log('  0.1.x 用户忽略这段 —— 目录方式在那一代是对的。');
    console.log('');
    console.log('如果还有 profile 没被自动识别（例如装在非默认位置）：');
    console.log('  1) 先把插件装进它：dsh plugin --profile <名字> add link:<本仓库路径>');
    console.log('  2) 再重跑本脚本；或手动生成声明：');
    console.log('     node scripts/export-preset-declarations.mjs --out=preset-declarations.yml');
    console.log('     把内容作为**新元素**追加进 <DSH_HOME>/profiles/<名字>/cordis.patch.yml');
    console.log('     ⚠️ 自带的 `- insert:` 那层别去掉，否则会被当成"覆盖已有条目"静默跳过。');
  }

  console.log('');
  console.log('安装完成。在新建对话页的模式滑块里可以选：');
  for (const id of ids) {
    let name = id;
    let desc = '';
    try {
      const meta = await readFile(join(srcRoot, id, 'preset.yml'), 'utf8');
      const grab = (key) => {
        const m = meta.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
        return m ? m[1].trim() : '';
      };
      name = grab('name') || id;
      desc = grab('description');
    } catch { /* 读不到就退回 id */ }
    console.log(`  「${name}」`);
    if (desc !== '') console.log(`      ${desc}`);
  }
  console.log('');
  console.log('提示：这些预设都用 complete: true 整份替换系统提示词，共享同一份长期记忆');
  console.log(`      （${join(dshHome, 'cyrene-memory.md')}）。`);
  console.log('');
  console.log(`操作记录：${journalPath}（--rollback 可恢复到安装前）。`);
}

await main();
