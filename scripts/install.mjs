#!/usr/bin/env node
/**
 * 跨平台的预设安装脚本（无 shell 依赖，Node 22+）。
 *
 * DSH 的 agent 预设由 dsh-agent-presets 按 ~/.dsh/.agent-presets/<id>/ 目录
 * 扫描发现，没有公开的安装 API，所以预设必须由外部脚本拷贝到位。
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

const PRESET_ID = 'chat';
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'preset');
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const destDir = join(dshHome, '.agent-presets', PRESET_ID);

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

async function main() {
  if (!existsSync(srcDir)) {
    console.error(`错误：找不到预设源目录 ${srcDir}`);
    process.exit(1);
  }

  if (uninstall) {
    if (existsSync(destDir)) {
      await rm(destDir, { recursive: true, force: true });
      console.log(`已卸载预设：${destDir}`);
    } else {
      console.log(`无需卸载：${destDir} 不存在`);
    }
    return;
  }

  console.log(`预设源：${srcDir}`);
  console.log(`目标位置：${destDir}`);

  if (existsSync(destDir)) {
    const [a, b] = await Promise.all([dirFingerprint(srcDir), dirFingerprint(destDir)]);
    if (a === b) {
      console.log('已是最新，无需改动。');
      return;
    }
    if (!force) {
      console.error(
        [
          '',
          '拒绝覆盖：目标目录已存在且与预设不同。',
          '  这通常意味着你已经改过自己的预设（比如调了口吻）。',
          `  确认要覆盖请加 --force（会先备份到 ${destDir}.bak.<时间戳>）。`,
        ].join('\n'),
      );
      process.exit(1);
    }
    const backup = `${destDir}.bak.${Date.now()}`;
    await cp(destDir, backup, { recursive: true });
    console.log(`已备份原预设 → ${backup}`);
  }

  await mkdir(destDir, { recursive: true });
  await cp(srcDir, destDir, { recursive: true });

  console.log('');
  console.log(`✅ 预设已安装：${destDir}`);
  console.log('   在 DSH 界面右上角的模式选择器里选「纯文本对话模式」即可。');
  console.log('');
  console.log('提示：该预设使用 complete: true 整份替换系统提示词，');
  console.log('      因此该模式下不提供文件 / Shell / 设备工具，只保留联网搜索与表情包。');
}

await main();
