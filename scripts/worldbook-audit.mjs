#!/usr/bin/env node
/**
 * 世界书体检 —— 按 SillyTavern 世界书的写法口径给 `worldbook/data/` 打分。
 *
 * 口径来源：SillyTavern 世界书机制实证（不写标题行 / 首句自报家门 / 只留事实 /
 * 复述关键词 / 90–110 字一条），以及「条数上限之外还要有体积预算」这一条。
 *
 * 用法：
 *   node scripts/worldbook-audit.mjs                 # 报告，永远退出 0
 *   node scripts/worldbook-audit.mjs --strict        # 有问题时退出 1（适合 CI/预提交）
 *   node scripts/worldbook-audit.mjs --dir=<目录>    # 体检别的世界书
 *   node scripts/worldbook-audit.mjs --max-chars=110 # 单条目标长度（默认 110）
 *
 * 只读，不改任何文件。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseWorldbookDocs } from '../worldbook/parse.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

/** 命令行参数。 */
const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const dirArg = argv.find((a) => a.startsWith('--dir='));
const maxArg = argv.find((a) => a.startsWith('--max-chars='));
const dir = dirArg ? resolve(dirArg.slice('--dir='.length)) : join(repoRoot, 'worldbook', 'data');
const target = Number(maxArg ? maxArg.slice('--max-chars='.length) : 110);

/**
 * 读目录里的所有 .md 并解析。
 * @returns 条目数组。
 */
function load() {
  const names = readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  return parseWorldbookDocs(names.map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') })));
}

/** 估算 token：中文 1 字 ≈ 0.6 token，英文按 4 字符 1 token。粗略到够做对比。 */
function estimateTokens(text) {
  const s = String(text ?? '');
  const cjk = (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return Math.round(cjk * 0.6 + (s.length - cjk) / 4);
}

const entries = load();
const problems = [];

console.log(`世界书体检：${dir}`);
console.log(`条目数：${entries.length}`);

// ── 1) 长度分布 ──────────────────────────────────────────────
const lens = entries.map((e) => e.content.length).sort((a, b) => a - b);
const sum = (list) => list.reduce((a, b) => a + b, 0);
const at = (p) => lens[Math.min(lens.length - 1, Math.floor(lens.length * p))];
console.log('');
console.log(`长度（字符）：最短 ${lens[0]} | p50 ${at(0.5)} | p90 ${at(0.9)} | 最长 ${lens[lens.length - 1]} | 合计 ${sum(lens)}`);
console.log(`估算 token：合计 ${estimateTokens(entries.map((e) => e.content).join(''))}`);

const tooLong = entries.filter((e) => e.content.length > target * 2);
console.log(`超过目标两倍（>${target * 2} 字符）的条目：${tooLong.length}`);
for (const e of [...tooLong].sort((a, b) => b.content.length - a.content.length).slice(0, 10)) {
  console.log(`  ${String(e.content.length).padStart(4)}  ${e.title}`);
  problems.push(`过长：${e.title}（${e.content.length} 字符 > ${target * 2}）`);
}

// ── 2) 常驻体量（每轮都注入）─────────────────────────────────
const constant = entries.filter((e) => e.constant);
const constantChars = sum(constant.map((e) => e.content.length));
console.log('');
console.log(`常驻条目：${constant.length} 条 / ${constantChars} 字符（≈ ${estimateTokens(constant.map((e) => e.content).join(''))} token，**每轮**都注入）`);

// ── 3) 触发词 ────────────────────────────────────────────────
const triggers = entries.flatMap((e) => e.triggers.map((t) => ({ t, title: e.title })));
const counts = new Map();
for (const { t, title } of triggers) {
  if (!counts.has(t)) counts.set(t, []);
  counts.get(t).push(title);
}
const dup = [...counts.entries()].filter(([, list]) => list.length > 1).sort((a, b) => b[1].length - a[1].length);
const short = triggers.filter((x) => x.t.length <= 2);
console.log('');
console.log(`触发词：${triggers.length} 个 | ≤2 字的 ${short.length} 个 | 跨条目重复 ${dup.length} 个`);
for (const [key, titles] of dup.slice(0, 8)) {
  console.log(`  「${key}」→ ${titles.length} 条：${titles.slice(0, 3).map((t) => t.slice(0, 14)).join(' / ')}`);
}
if (short.length > 0) {
  console.log(`  短词示例：${short.slice(0, 10).map((x) => `「${x.t}」`).join(' ')}`);
  problems.push(`触发词过短：${short.length} 个 ≤2 字（容易误触）`);
}

// ── 4) 正文复述标题 / 没有触发词也不会常驻 ────────────────────
const echo = entries.filter((e) => e.names.some((n) => n.length > 1 && e.content.startsWith(n)));
console.log('');
console.log(`正文以标题开头的条目：${echo.length}（复述标题，浪费上下文）`);
const dead = entries.filter((e) => !e.constant && e.triggers.length === 0);
if (dead.length > 0) {
  console.log(`既非常驻、又无触发词的死条目：${dead.length}`);
  problems.push(`死条目：${dead.map((e) => e.title).join(' / ')}`);
}

// ── 5) 最坏情况注入 ──────────────────────────────────────────
const byPriority = (a, b) => (b.priority ?? 100) - (a.priority ?? 100);
const hits = entries.filter((e) => !e.constant).sort(byPriority);
const worst = constantChars + sum(hits.slice(0, 8).map((e) => e.content.length));
console.log('');
console.log(`最坏情况（常驻 + 8 条最长命中）：${worst} 字符 ≈ ${estimateTokens('中'.repeat(worst))} token`);
console.log(`默认预算 maxChars=1600 会在命中块超预算时按优先级截断。`);
if (worst > 6000) problems.push(`最坏注入 ${worst} 字符，明显超预算（建议压到 90–110 字/条）`);

// ── 结论 ────────────────────────────────────────────────────
console.log('');
if (problems.length === 0) {
  console.log('✅ 没有发现明显问题。');
} else {
  console.log(`⚠️  ${problems.length} 类问题（共 ${problems.length} 项）：`);
  for (const item of problems) console.log(`  - ${item}`);
  if (strict) process.exitCode = 1;
}
