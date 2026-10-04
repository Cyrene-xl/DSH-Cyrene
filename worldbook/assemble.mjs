/**
 * worldbook/assemble.mjs —— 把命中条目组装成注入块（纯函数，无副作用）。
 *
 * 结构照 Cyrene-Agent 的注入格式对齐（src/main/orchestrator/index.ts）：
 * 一个抬头 + 一段前言 + 条目正文，条目之间空行分隔。
 *
 * 与上游的两处有意差异，都在 options 里可调回原样：
 *
 * 1. **抬头/前言措辞**。上游的原文是「【已激活的世界知识】」加一句"视为真实且已知、
 *    不要说不知道"。那是给工具型 agent 的措辞；这里默认换成更贴合陪伴角色的说法，
 *    因为世界书最终是拼进昔涟的人设正文里的，一段突兀的系统腔会破坏语感。
 * 2. **是否给条目加标题**。上游只给连带条目加 `【标题】`，普通命中条目是裸正文。
 *    这里默认保持上游行为（`titles: false`），让语感不变。
 */
import { DEFAULT_MAX_ACTIVE, matchWorldbook } from './match.mjs';

/** 默认抬头与前言（偏"背景知识"，而不是"系统指令"）。 */
export const DEFAULT_FORMAT = Object.freeze({
  header: '【你本来就知道的事】\n',
  preamble:
    '下面这些是你原本就了解的背景。它们已经发生了，不需要向对方确认，也不要问「这是什么意思」。'
    + '用得上就自然用，用不上就当没想起来。\n'
});

/**
 * 渲染单条条目。
 * @param section - `{ title, content }`。
 * @param withTitle - 是否加 `【标题】`。
 * @returns 渲染后的文本。
 */
function renderSection(section, withTitle) {
  const body = String(section.content ?? '').trim();
  if (body === '') return '';
  if (!withTitle) return body;
  const title = String(section.title ?? '').trim();
  return title === '' ? body : `【${title}】\n${body}`;
}

/**
 * 把命中按「稳定」与「动态」分成两块。
 *
 * 为什么要分两块：注入走 `systemPrompt.context()` 时，**内容一变就会追加一条新快照**
 * （快照是 append 型 surface 事件，不会自动替换旧的）。而常驻条目内容恒定，
 * 如果把它和关键词命中揉在一块，那么每次命中变化都会连带重发那批常驻内容 ——
 * 长会话里累积得很快。
 *
 * 拆开之后：常驻块内容永不变 → 只落库一次；命中块变化时才追加。
 *
 * @param matched - `matchWorldbook()` 的产物。
 * @param options - 组装选项。
 * @returns `{ static, dynamic }`，各自是 `assembleWorldbook()` 的产物。
 */
export function assembleSplit(matched, options = {}) {
  const permanent = Array.isArray(matched?.permanent) ? matched.permanent : [];
  const staticBlock = assembleWorldbook({ permanent, primary: [], chained: [] }, options);
  const dynamicBlock = assembleWorldbook({ permanent: [], primary: matched?.primary, chained: matched?.chained }, options);
  return { static: staticBlock, dynamic: dynamicBlock };
}

/**
 * 组装注入块。顺序：常驻 → 关键词命中 → 连带（连带带 `【标题】`，与上游一致）。
 *
 * @param matched - `matchWorldbook()` 的产物，或 `{ permanent, primary, chained }`。
 * @param options - `{ format, titles, titleChained }`。
 * @returns `{ text, sections, count, chars }`；没有命中时 text 为空串。
 */
export function assembleWorldbook(matched, options = {}) {
  const format = { ...DEFAULT_FORMAT, ...(options.format ?? {}) };
  const withTitle = options.titles === true;
  const titleChained = options.titleChained !== false; // 上游对连带条目默认带标题

  const permanent = Array.isArray(matched?.permanent) ? matched.permanent : [];
  const primary = Array.isArray(matched?.primary) ? matched.primary : [];
  const chained = Array.isArray(matched?.chained) ? matched.chained : [];

  const sections = [];
  for (const hit of permanent) {
    sections.push({ id: hit.entry.id, title: hit.entry.title, reason: 'constant', content: hit.entry.content });
  }
  for (const hit of primary) {
    sections.push({ id: hit.entry.id, title: hit.entry.title, reason: hit.reason, content: hit.entry.content });
  }
  for (const hit of chained) {
    sections.push({
      id: hit.entry.id,
      title: hit.entry.title,
      reason: hit.reason,
      content: hit.entry.content,
      titled: titleChained
    });
  }

  const rendered = sections
    .map((section) => {
      const withThisTitle = section.reason === 'chained' ? section.titled !== false : withTitle;
      return renderSection(section, withThisTitle);
    })
    .filter((text) => text !== '');

  if (rendered.length === 0) {
    return { text: '', sections: [], count: 0, chars: 0 };
  }

  const body = rendered.join('\n\n');
  const text = `${format.header}${format.preamble}\n${body}`;
  return {
    text,
    sections,
    count: sections.length,
    chars: [...text].length
  };
}

/**
 * 一步到位：匹配 + 组装。
 * @param entries - 解析后的条目数组。
 * @param corpus - `buildCorpus()` 的产物。
 * @param options - 同时接受匹配与组装两边的选项。
 * @returns `assembleWorldbook()` 的产物，另附原始命中便于排查。
 */
export function buildInjection(entries, corpus, options = {}) {
  const matched = matchWorldbook(entries, corpus, options);
  const built = assembleWorldbook(matched, options);
  return { ...built, matched };
}
