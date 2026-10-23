#!/usr/bin/env node
/**
 * 跨平台的预设安装脚本（无 shell 依赖，Node 22+）。
 *
 * DSH 的 agent 预设由 dsh-agent-presets 按 ~/.dsh/.agent-presets/<id>/ 目录
 * 扫描发现，没有公开的安装 API，所以预设必须由外部脚本拷贝到位。
 *
 * 预设 id **自动发现**：preset/chat/ → 装成 chat，preset/cyrene-work/ → cyrene-work。
 * 以后再加预设只要在 preset/ 下新建目录，本脚本不用改。
 *
 * 用法：
 *   node scripts/install.mjs
 *   node scripts/install.mjs --force
 *   node scripts/install.mjs --uninstall
 */
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declarationFor } from './export-preset-declarations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', 'preset');
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');

const argv = new Set(process.argv.slice(2));
const force = argv.has('--force');
const uninstall = argv.has('--uninstall');

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

/** 自动发现 preset/ 下每个含 agent.cordis.yml 的子目录。 */
async function discoverPresetIds() {
  const entries = await readdir(srcRoot, { withFileTypes: true });
  const ids = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const composition = join(srcRoot, entry.name, 'agent.cordis.yml');
    if (!existsSync(composition)) continue;
    ids.push(entry.name);
  }
  return ids;
}

/**
 * 「声明式注册表」那一代才有的插件（DSH 0.2.0+）。
 *
 * 为什么用"这个包装没装"来判断代数，而不是猜 DSH 版本号：
 * 探测版本要么要联网、要么要猜安装路径，而**这个包在不在 profile 的 node_modules 里**是
 * 可以确定的。0.1.x 没有它，也就不用担心把声明写进错误的代。
 */
const DECLARATIVE_PLUGIN = '@deepseek-ai/dsh-agent-preset';
/** 我们写进 profile 补丁的那段以这行开头，用来判重（幂等）。 */
const DECLARATIVE_MARKER = '# ── dsh-cyrene 预设声明（自动写入，勿手改）────────────────────';

/**
 * 找出需要写声明的 profile：既装了注册表插件，又装了本包。
 * @returns `[{ name, dir }]`。
 */
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

/**
 * 把两套预设的声明写进某个 profile 的补丁（幂等、先备份）。
 *
 * ⚠️ 空补丁的内容是 `[]` —— 直接往后追加会变成 `[] - insert:`，那是**无效 YAML**。
 * 所以这两种情况要替换，其余情况才追加。
 * @param profile - `{ name, dir }`。
 * @param ids - 预设 id 列表。
 */
async function writeDeclarations(profile, ids) {
  const patchPath = join(profile.dir, 'cordis.patch.yml');
  let current = '';
  try {
    current = await readFile(patchPath, 'utf8');
  } catch {
    current = '';
  }
  if (current.includes(DECLARATIVE_MARKER)) {
    console.log(`  已是最新：${profile.name}（声明已存在）`);
    return;
  }
  const body = `${DECLARATIVE_MARKER}\n${ids.map((id) => declarationFor(id)).join('\n')}\n`;
  const trimmed = current.trim();
  const next = trimmed === '' || trimmed === '[]'
    ? body
    : `${current.replace(/\s*$/, '')}\n\n${body}`;
  if (existsSync(patchPath)) {
    const backup = `${patchPath}.bak.${Date.now()}`;
    await copyFile(patchPath, backup);
    console.log(`  已备份 → ${backup}`);
  }
  await writeFile(patchPath, next, 'utf8');
  console.log(`  ✅ 已写入预设声明：${patchPath}`);
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

  console.log(`预设源：${srcRoot}`);
  console.log(`发现预设：${ids.join(' ')}`);

  if (uninstall) {
    const targets = await declarativeProfiles();
    if (targets.length > 0) {
      console.log('');
      console.log('注意：这些 profile 用的是「声明式注册表」代，预设声明写在 profile 补丁里：');
      for (const target of targets) {
        console.log(`  ${join(target.dir, 'cordis.patch.yml')}`);
      }
      console.log(`  请手动删掉以「${DECLARATIVE_MARKER}」开头的那一段（到文件末尾），再重启 DSH。`);
      console.log('  这里不自动删：那段后面可能已经被你追加了自己的配置，截断会连带删掉。');
    }
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

  // ── 分流：声明式注册表代（DSH 0.2.0+）──────────────────────────────
  //
  // 那一代不扫描 ~/.dsh/.agent-presets/，拷目录**不会生效也不报错**（老版本会照常打印
  // "已安装"）。所以这里直接改写成声明，省掉用户手动跑 export、再手工贴进 profile 的步骤。
  //
  // 为什么不能干脆把声明塞进本包的 cordis.patch.yml（"装插件即注册"）：
  // 补丁里的 `@deepseek-ai/dsh-agent-preset` 这一行在 0.1.x 上**根本解析不到**，
  // 实测会让整个 DSH 起不来（ERR_MODULE_NOT_FOUND）。所以按代数分流。
  const targets = await declarativeProfiles();
  if (targets.length > 0) {
    console.log('');
    console.log(`检测到 ${targets.length} 个「声明式注册表」代的 profile（DSH 0.2.0+）：`);
    for (const target of targets) {
      console.log('');
      console.log(`── profile: ${target.name} ──`);
      await writeDeclarations(target, ids);
    }
    console.log('');
    console.log('上面这些 profile **重启 DSH** 后两套模式就会出现。');
    console.log('下面仍会写一份目录副本：0.1.x 的 profile（以及同一台机器上的旧版本）靠它发现预设。');
  }

  if (targets.length > 0) console.log('（声明式代用不到下面的目录副本，不影响它们。）');

  let failed = 0;
  for (const id of ids) {
    const src = join(srcRoot, id);
    const dest = join(dshHome, '.agent-presets', id);
    console.log('');
    console.log(`── ${id} ──`);
    console.log(`目标位置：${dest}`);

    if (existsSync(dest)) {
      const [a, b] = await Promise.all([dirFingerprint(src), dirFingerprint(dest)]);
      if (a === b) {
        console.log('已是最新，无需改动。');
        continue;
      }
      if (!force) {
        console.error(
          [
            '',
            `拒绝覆盖：${dest} 已存在且与预设不同。`,
            '  这通常意味着你已经改过自己的预设（比如调了口吻）。',
            `  确认要覆盖请加 --force（会先备份到 ${dest}.bak.<时间戳>）。`,
          ].join('\n'),
        );
        failed = 1;
        continue;
      }
      const backup = `${dest}.bak.${Date.now()}`;
      await cp(dest, backup, { recursive: true });
      console.log(`已备份原预设 → ${backup}`);
    }

    await mkdir(dest, { recursive: true });
    await cp(src, dest, { recursive: true });
    console.log(`✅ 已安装：${dest}`);
  }

  if (failed !== 0) process.exit(1);

  console.log('');
  console.log('安装完成。在新建对话页的模式滑块里可以选：');
  // 从各预设自己的 preset.yml 读名字与描述 —— 不要在这里写死模式名，
  // 否则以后新增预设会被静默安装、却不出现在这段提示里。
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
  // ⚠️ 这段不是客套话，是防"静默失败"。
  //
  // 0.2.0 换掉了预设发现机制：它的 agent-preset-registry 文档明写
  // "注册表不扫描目录，也不接受 preset 路径"。本脚本下面这些都做到了，
  // 但**顺序**很关键：必须先把插件装进 profile，本脚本才认得出"这一代"并写声明。
  // 先跑脚本、后装插件的话，它只会拷目录 —— 在 0.2.0+ 上照常打印"已安装"，但预设不出现。
  if (targets.length > 0) {
    console.log('预设声明已经写进上面那些 profile，**不需要再手动贴**。');
    console.log('');
    console.log('如果还有 profile 没被自动识别（例如装在非默认位置）：');
    console.log('  1) 先把插件装进它：dsh plugin --profile <名字> add link:<本仓库路径>');
    console.log('  2) 再重跑本脚本；或手动生成声明：');
    console.log('     node scripts/export-preset-declarations.mjs --out=preset-declarations.yml');
    console.log('     把内容作为**新元素**追加进 <DSH_HOME>/profiles/<名字>/cordis.patch.yml');
    console.log('     ⚠️ 自带的 `- insert:` 那层别去掉，否则会被当成"覆盖已有条目"静默跳过。');
  } else {
    console.log('如果这个 DSH 是 0.2.0 或更新：上面的目录方式【不会生效】（不报错，只是预设不出现）。');
    console.log('  正确顺序是：');
    console.log('    1) 先把插件装进 profile：dsh plugin --profile <名字> add link:<本仓库路径>');
    console.log('    2) 再重跑本脚本 —— 它会自动识别这一代并把声明写进去，不用手动贴。');
    console.log('  0.1.x 用户忽略这段 —— 目录方式在那一代是对的。');
  }
}

await main();
