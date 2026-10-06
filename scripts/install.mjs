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
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  // "注册表不扫描目录，也不接受 preset 路径"。本脚本做的正是"拷目录"，
  // 所以在 0.2.0+ 上它**会照常成功、照常打印"已安装"，而预设根本不出现** ——
  // 实测反馈里那位 Windows 用户撞的就是这个，排查成本很高。
  //
  // 这里不做版本探测（探测不可靠：不知道对方 DSH 装在哪），而是把两条路都讲清楚。
  console.log('⚠️ 如果你用的是 DSH 0.2.0 或更新：上面的目录方式【不会生效】。');
  console.log('   0.2.0 起改用声明式注册表，它不扫描 ~/.dsh/.agent-presets/。');
  console.log('   请改用声明方式：');
  console.log('     node scripts/export-preset-declarations.mjs --out=preset-declarations.yml');
  console.log('   然后把生成的内容贴进你的 profile 补丁：');
  console.log(`     ${join(dshHome, 'profiles', '<你的 profile>', 'cordis.patch.yml')}`);
  console.log('   （该文件顶层是一个数组，把内容追加进数组即可。）');
  console.log('   0.1.x 用户忽略这段 —— 目录方式在那一代是对的。');
}

await main();
