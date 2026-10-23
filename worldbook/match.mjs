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
 * 注入字符预算的默认值。
 *
 * 上游的 MAX_ACTIVE 只限制**条数**，不限制体积；一条 800 字的条目×8 也能一次塞 6000+ 字。
 * 这里补一道体积闸：按优先级降序累加，超了就丢（与 SillyTavern 的 order + 预算截断同义）。
 */
export const DEFAULT_MAX_CHARS = 1600;

/**
 * 单条注入正文的默认上限（字符）。
 *
 * 世界书里的人物志动辄 600–900 字，一条就能吃掉半个预算。这里把**注入用**的正文
 * 截到一句/一段的边界，文件本身不动（数据仍是无损的，`read_page`/审计看到的是全文）。
 * 设为 0 关闭截断 —— 想要上游原文就把它关掉。
 */
export const DEFAULT_MAX_ENTRY_CHARS = 320;

/** 截断时至少保留到上限的这个比例，避免在很靠前的句号处就断掉。 */
const MIN_KEEP_RATIO = 0.5;

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
 * 判断某个关键词是否出现在语料里的任一分片。
 * @param key - 关键词。
 * @param parts - 语料分片。
 * @param caseSensitive - 是否区分大小写。
 * @returns 是否出现。
 */
function hasKey(key, parts, caseSensitive) {
  const needle = norm(key, caseSensitive);
  if (needle === '') return false;
  return parts.some((part) => norm(part.text, caseSensitive).includes(needle));
}

/**
 * 把注入用的正文截到句/段边界。
 *
 * 只在「句末标点或换行」之后切，切点至少保留到上限的一半；找不到像样的切点就硬切。
 * 截断处补 `…`，让人一眼看出还有下文（别让模型以为那就是全部）。
 * 返回的是**新对象**：条目本体（含完整正文）保持原样，方便审计与排查。
 *
 * @param entry - 原条目。
 * @param limit - 字符上限；<=0 表示不截。
 * @returns `{ entry, clipped: boolean }`。
 */
function clipEntry(entry, limit) {
  const text = String(entry.content ?? '');
  if (limit <= 0 || [...text].length <= limit) return { entry, clipped: false };
  const chars = [...text];
  // 预留一个字符给省略号 —— 不能让「截完加一个 …」把总长又顶出上限一格。
  const head = chars.slice(0, Math.max(1, limit - 1));
  const minKeep = Math.floor(limit * MIN_KEEP_RATIO);
  let cut = -1;
  for (let i = head.length - 1; i >= minKeep; i -= 1) {
    if (/[。！？；\n]/.test(head[i])) {
      cut = i;
      break;
    }
  }
  const kept = (cut === -1 ? head : head.slice(0, cut + 1)).join('').trimEnd();
  return {
    entry: { ...entry, content: `${kept}…`, clipped: true, fullChars: chars.length },
    clipped: true
  };
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
    // 「必须同时命中」：门槛词缺一个就不算命中。只记「差一点」的诊断 ——
    // 一个都没命中跟普通未命中没区别，记了只会把日志刷满。
    const required = entry.requireAll ?? [];
    if (required.length > 0) {
      const missing = required.filter((key) => !hasKey(key, parts, caseSensitive));
      if (missing.length > 0) {
        diagnostics.push({
          code: 'require-all',
          id: entry.id,
          title: entry.title,
          matchedKeys: keys,
          missingKeys: missing
        });
        continue;
      }
    }
    const allKeys = [...keys, ...required.filter((key) => !keys.includes(key))];
    keywordHits.push({ entry, reason: 'keyword', matchedKeys: allKeys, matchedSlots: hitSlots });
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

  // ── 字符预算：条数上限之外再按体积截断 ──────────────────────────────
  //
  // 条数达标不代表体积达标：8 条长条目能一次吃掉几千字。这里把 primary 与 chained
  // 合起来按优先级降序累加，超预算的丢掉并记进诊断 —— 与 SillyTavern 的
  // 「order 降序 + budget 截断」同一套语义。
  // ── 单条截断：先按条截，再算预算 ────────────────────────────────────
  // 顺序很关键：先截断，预算才按"实际会注入多少"来算；反过来的话一条 800 字的
  // 条目会被当成 800 字去占预算，截完却只剩 320 字，白丢一条。
  const entryMaxChars = Number.isFinite(options.entryMaxChars)
    ? Math.max(0, Math.round(options.entryMaxChars))
    : DEFAULT_MAX_ENTRY_CHARS;
  const clip = (hits) => hits.map((hit) => {
    const { entry, clipped } = clipEntry(hit.entry, entryMaxChars);
    if (!clipped) return hit;
    diagnostics.push({
      code: 'clipped',
      id: entry.id,
      title: entry.title,
      chars: [...String(entry.content)].length,
      fullChars: entry.fullChars
    });
    return { ...hit, entry, reason: hit.reason };
  });
  kept = clip(kept);
  const chainedClipped = clip(chained);

  const maxChars = Number.isFinite(options.maxChars) ? Math.max(0, Math.round(options.maxChars)) : DEFAULT_MAX_CHARS;
  let primaryFinal = kept;
  let chainedFinal = chainedClipped;
  if (maxChars > 0) {
    const SEP = 2; // 条目之间大约两个换行的开销
    const merged = [...kept, ...chainedClipped].sort((a, b) => byPriority(a.entry, b.entry));
    const allowed = new Set();
    let used = 0;
    for (const hit of merged) {
      const size = String(hit.entry.content ?? '').length + SEP;
      if (used + size > maxChars) {
        diagnostics.push({
          code: 'budget',
          id: hit.entry.id,
          title: hit.entry.title,
          priority: hit.entry.priority,
          chars: size
        });
        continue;
      }
      used += size;
      allowed.add(hit.entry.id);
    }
    primaryFinal = kept.filter((hit) => allowed.has(hit.entry.id));
    chainedFinal = chainedClipped.filter((hit) => allowed.has(hit.entry.id));
  }

  return { permanent, primary: primaryFinal, chained: chainedFinal, diagnostics };
}
