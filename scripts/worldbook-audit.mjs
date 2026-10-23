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
 *   node scripts/worldbook-audit.mjs --entry-max-chars=320 # 注入时单条截断（默认 320，0=不截）
 *
 * 只读，不改任何文件。
 *
 * ⚠️ 关于「正文以标题开头」这一条：**它不是问题，早先版本把它当问题是错的**。
 * 解析器本来就把 `## 标题` 那行剥掉了；正文开篇写一句「白厄是……」是**自报家门**，
 * 正是 SillyTavern 世界里推荐写法（截断之后仍然认得出这是谁）。现在只作为信息报出来。
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
const entryMaxArg = argv.find((a) => a.startsWith('--entry-max-chars='));
const dir = dirArg ? resolve(dirArg.slice('--dir='.length)) : join(repoRoot, 'worldbook', 'data');
const target = Number(maxArg ? maxArg.slice('--max-chars='.length) : 110);
const entryMax = Number(entryMaxArg ? entryMaxArg.slice('--entry-max-chars='.length) : 320);

/**
 * 读目录里的所有 .md 并解析。
 * @returns 条目数组。
 */
function load() {
  const names = readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  return parseWorldbookDocs(names.map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') })));
}

/** 估算词元：中文 1 字 ≈ 0.6 词元，英文按 4 字符 1 词元。粗略到够做对比。 */
function estimateUnits(text) {
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
console.log(`估算词元：合计 ${estimateUnits(entries.map((e) => e.content).join(''))}`);

const tooLong = entries.filter((e) => e.content.length > target * 2);
console.log(`超过目标两倍（>${target * 2} 字符）的条目：${tooLong.length}`);
for (const e of [...tooLong].sort((a, b) => b.content.length - a.content.length).slice(0, 10)) {
  console.log(`  ${String(e.content.length).padStart(4)}  ${e.title}`);
}
if (entryMax > 0) {
  // 截断开着，长条目只会被截到 entryMax —— 文件长不影响上下文开销，只影响"信息密度"。
  if (tooLong.length > 0) console.log(`  （已开单条截断 ${entryMax} 字符，这些条目注入时会被截短，不算问题）`);
} else {
  for (const e of tooLong) problems.push(`过长：${e.title}（${e.content.length} 字符 > ${target * 2}）`);
}

// ── 1b) AND 门槛（本项目扩展：必须同时命中）──────────────────
const gated = entries.filter((e) => (e.requireAll ?? []).length > 0);
console.log(`带「必须同时命中」门槛的条目：${gated.length}`);
for (const e of gated.slice(0, 10)) console.log(`  ${e.title} ← 需全部出现：${e.requireAll.join(' + ')}`);
// 长条目又没门槛 = 单说一个名字就把整篇拉进来，这是真正该修的。
const longUngated = tooLong.filter((e) => !e.constant && (e.requireAll ?? []).length === 0 && e.triggers.length > 0);
if (longUngated.length > 0) {
  console.log(`  长条目但没门槛的：${longUngated.length}`);
  if (entryMax <= 0) problems.push(`长条目无门槛：${longUngated.length} 条（建议加「必须同时命中」）`);
}

// ── 2) 常驻体量（每轮都注入）─────────────────────────────────
const constant = entries.filter((e) => e.constant);
const constantChars = sum(constant.map((e) => e.content.length));
console.log('');
console.log(`常驻条目：${constant.length} 条 / ${constantChars} 字符（≈ ${estimateUnits(constant.map((e) => e.content).join(''))} 词元，**每轮**都注入）`);

// ── 3) 触发词 ────────────────────────────────────────────────
// 常驻条目不走关键词匹配，它的触发词永远不会被扫描 —— 统计里也要排除，
// 否则「伙伴」那条常驻里的「你 / 我」会被算成误触风险。
const triggers = entries
  .filter((e) => !e.constant)
  .flatMap((e) => e.triggers.map((t) => ({ t, title: e.title })));
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
// 短触发词本身不是错：专名（白厄、丹恒、缇宝）就是两三个字，没别的写法。
// 真正会误触的是**停用词**（我 / 你 / 用户 / 和你）—— 它们几乎每条消息都出现，
// 一旦挂在非常驻条目上就等于把那条变成常驻。所以只对停用词报问题。
const STOPWORDS = new Set(['我', '你', '他', '她', '它', '这', '那', '们', '和', '的', '是', '在', '有', '和', '与']);
const stopHits = triggers.filter((x) => STOPWORDS.has(x.t));
if (short.length > 0) {
  console.log(`  短词示例：${short.slice(0, 10).map((x) => `「${x.t}」`).join(' ')}（专名居多，不算问题）`);
}
if (stopHits.length > 0) {
  const titles = [...new Set(stopHits.map((x) => x.title))];
  console.log(`  停用词当触发词：${stopHits.length} 处 → ${titles.slice(0, 5).map((x) => x.slice(0, 14)).join(' / ')}`);
  problems.push(`停用词触发：${stopHits.map((x) => `「${x.t}」`).join(' ')}（几乎每条消息都会命中）`);
}

// ── 4) 正文复述标题 / 没有触发词也不会常驻 ────────────────────
// 注意：这不是问题（见文件头说明）—— 开篇自报名字是推荐写法，截断后仍认得出是谁。
const echo = entries.filter((e) => e.names.some((n) => n.length > 1 && e.content.startsWith(n)));
console.log('');
console.log(`正文开篇自报名字的条目：${echo.length}（推荐写法；截断后仍认得出是谁，不算问题）`);
const dead = entries.filter((e) => !e.constant && e.triggers.length === 0);
if (dead.length > 0) {
  console.log(`既非常驻、又无触发词的死条目：${dead.length}`);
  problems.push(`死条目：${dead.map((e) => e.title).join(' / ')}`);
}

// ── 5) 最坏情况注入 ──────────────────────────────────────────
const byPriority = (a, b) => (b.priority ?? 100) - (a.priority ?? 100);
const hits = entries.filter((e) => !e.constant).sort(byPriority);
const clippedLen = (e) => (entryMax > 0 ? Math.min(e.content.length, entryMax) : e.content.length);
const worst = constantChars + sum(hits.slice(0, 8).map(clippedLen));
console.log('');
console.log(`最坏情况（常驻 + 8 条最长命中${entryMax > 0 ? `，单条按 ${entryMax} 字符截断` : ''}）：${worst} 字符 ≈ ${estimateUnits('中'.repeat(worst))} 词元`);
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
