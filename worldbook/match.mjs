/**
 * worldbook/match.mjs —— 世界书匹配（纯函数，无副作用）。
 *
 * 语义照 Cyrene-Agent 的 WorldbookEntry 对齐（src/main/rag/worldbook.ts）：
 *
 * - `常驻`（permanent）：始终注入，不参与任何打分。
 * - `触发词`（keywords）：命中即注入。上游是"命中 → 加激活分 → 越过阈值才注入"，
 *   本实现没有 DMAE 状态机，所以**命中即注入**；代价是失去了跨轮的激活累积与遗忘
 *   衰减，收益是不引入状态、行为完全可预测。
 * - `连带触发词`（linkTriggers）：上游定义为 **One-Shot 一次性** —— 本条目被用户
 *   命中时，连带触发这些关键词对应的条目，只本轮有效、不进状态表。这里照做。
 * - `内在价值`（intrinsicValue）：**本实现里不起作用**。上游只在 DMAE 的 Floor
 *   （首次激活基线）与 Resistance（遗忘抵抗）里用它，没有状态机就没有落脚点。
 *   仍然解析并保留，是为了数据无损、以及将来真接 DMAE 时不用改格式。
 * - `优先级`（priority）：上游仅作排序 tiebreaker（真正的排序键是 activation）。
 *   本实现没有 activation，所以**它就是主排序键**（降序）。
 *
 * 上限：上游对 active 集有 MAX_ACTIVE = 8 的硬上限（终态注入上限）。这里保留同样
 * 的默认值 —— 没有上限的世界书在长会话里可能一次注入很大一块。
 */

/** 上游的终态注入上限（worldbook-constants.ts：MAX_ACTIVE）。 */
export const DEFAULT_MAX_ACTIVE = 8;

/**
 * 归一化用于匹配的文本。
 * @param text - 原始文本。
 * @param caseSensitive - 是否区分大小写。
 * @returns 归一化后的文本。
 */
function norm(text, caseSensitive) {
  const s = String(text ?? '');
  return caseSensitive ? s : s.toLowerCase();
}

/**
 * 构造待匹配语料。
 *
 * d0 = 本轮用户消息；d1 = 上一轮；d2、d3、d4 依次更早。上游的扫描深度建在这套槽位上
 * （D0/D1/D2），本实现把它扩到 D4，好让配置里的 `scanDepth: 1..5` 真的生效
 * —— 早先只造三个槽位、再把深度静默夹到 3，写 5 既不报错也不起作用。
 *
 * 这里只接受调用方已经挑好的文本 —— 从哪拿到它们（会话事件、出站请求……）属于注入层的事。
 *
 * @param input - `{ userText, previousTexts }`；previousTexts 按由新到旧排列。
 * @returns `{ d0, d1, d2, d3, d4 }`，缺失的槽位为空串。
 */
export function buildCorpus(input = {}) {
  const prev = Array.isArray(input.previousTexts) ? input.previousTexts : [];
  return {
    d0: String(input.userText ?? ''),
    d1: String(prev[0] ?? ''),
    d2: String(prev[1] ?? ''),
    d3: String(prev[2] ?? ''),
    d4: String(prev[3] ?? '')
  };
}

/**
 * 在一个条目里找命中的触发词。
 * @param entry - 条目。
 * @param parts - `[{ slot, text }]` 语料分片。
 * @param caseSensitive - 是否区分大小写。
 * @returns `{ keys, slots }`；无命中时 keys 为空数组。
 */
function scanTriggers(entry, parts, caseSensitive) {
  const keys = [];
  const slots = new Set();
  for (const key of entry.triggers ?? []) {
    const needle = norm(key, caseSensitive);
    if (needle === '') continue;
    for (const part of parts) {
      if (norm(part.text, caseSensitive).includes(needle)) {
        keys.push(key);
        slots.add(part.slot);
        break;
      }
    }
  }
  return { keys, slots: [...slots] };
}

/**
 * 排序：优先级降序；同优先级按来源顺序（稳定，便于复现）。
 * @param a - 条目。
 * @param b - 条目。
 * @returns 比较结果。
 */
function byPriority(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 匹配世界书条目。
 *
 * @param entries - 解析后的条目数组。
 * @param corpus - `buildCorpus()` 的产物。
 * @param options - `{ maxActive, scanDepth, caseSensitive }`。
 * @returns `{ permanent, primary, chained, diagnostics }`。
 *   - `permanent`：常驻条目。**不占上限**，也永远注入（上游同样把它们排除在 active 集外）。
 *   - `primary`：触发词直接命中的条目，已排序并截断到上限。
 *   - `chained`：由 primary 的 `连带触发词` 拉进来的条目（One-Shot）。
 *   - `diagnostics`：被上限截掉的条目等，便于排查"为什么没生效"。
 */
export function matchWorldbook(entries, corpus, options = {}) {
  const maxActive = Number.isFinite(options.maxActive) ? options.maxActive : DEFAULT_MAX_ACTIVE;
  const depth = Math.min(Math.max(1, Number(options.scanDepth) || 3), 5);
  const caseSensitive = options.caseSensitive === true;

  const slots = [corpus?.d0, corpus?.d1, corpus?.d2, corpus?.d3, corpus?.d4].slice(0, depth);
  const parts = slots
    .map((text, i) => ({ slot: `d${i}`, text }))
    .filter((part) => String(part.text ?? '').trim() !== '');

  const list = Array.isArray(entries) ? entries : [];
  const permanent = [];
  const keywordHits = [];
  const diagnostics = [];

  for (const entry of list) {
    // 常驻：独立成组。上游把它排除在 active 集外，所以它不参与上限竞争 ——
    // 否则一批常驻条目会把上限吃光，把真正相关的那条挤出去。
    if (entry.constant) {
      permanent.push({ entry, reason: 'constant', matchedKeys: [], matchedSlots: [] });
      continue;
    }
    if ((entry.triggers ?? []).length === 0) continue; // 非常驻又无触发词：永不触发
    const { keys, slots: hitSlots } = scanTriggers(entry, parts, caseSensitive);
    if (keys.length === 0) continue;
    keywordHits.push({ entry, reason: 'keyword', matchedKeys: keys, matchedSlots: hitSlots });
  }

  permanent.sort((a, b) => byPriority(a.entry, b.entry));
  keywordHits.sort((a, b) => byPriority(a.entry, b.entry));

  let kept = keywordHits;
  if (maxActive > 0 && keywordHits.length > maxActive) {
    kept = keywordHits.slice(0, maxActive);
    for (const dropped of keywordHits.slice(maxActive)) {
      diagnostics.push({ code: 'capped', id: dropped.entry.id, title: dropped.entry.title, priority: dropped.entry.priority });
    }
  }

  // ── One-Shot 连带：用 primary 的连带触发词去拉条目（拉进来的不再继续连带，避免链式爆炸）──
  const wanted = new Set();
  for (const hit of kept) for (const key of hit.entry.linkTriggers ?? []) wanted.add(norm(key, caseSensitive));
  const already = new Set([...permanent, ...kept].map((hit) => hit.entry.id));
  const chained = [];
  if (wanted.size > 0) {
    for (const entry of list) {
      if (already.has(entry.id)) continue;
      if (entry.constant) continue;
      const hitKeys = (entry.triggers ?? []).filter((key) => wanted.has(norm(key, caseSensitive)));
      if (hitKeys.length === 0) continue;
      chained.push({ entry, reason: 'chained', matchedKeys: hitKeys, matchedSlots: [] });
    }
    chained.sort((a, b) => byPriority(a.entry, b.entry));
  }

  return { permanent, primary: kept, chained, diagnostics };
}
