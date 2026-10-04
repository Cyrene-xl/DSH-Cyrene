/**
 * worldbook/parse.mjs —— 解析 Cyrene-Agent 格式的世界书条目（纯函数，无副作用）。
 *
 * 条目格式（DMAE 世界书，5 个字段在现有 61 条上 100% 齐备）：
 *
 *     ## 标题 / 别名
 *     - 触发词: 词一, 词二, 词三
 *     - 常驻: 否
 *     - 内在价值: 60
 *     - 优先级: 200
 *     - 连带触发词: 无
 *     <空行>
 *     正文……（可以多段，可以含 `- **小标题**：` 这类正文列表）
 *     ---
 *
 * 解析要点：
 * - 以 `## ` 为条目边界；`---` 只是分隔装饰，不作为边界（正文里也可能出现）。
 * - 元数据只认**紧跟在标题之后、连续出现**的那几行。正文里的 `- ` 列表不会
 *   被误当成字段（现有数据里 characters.md 的正文就有 `- **迷迷**：……`）。
 * - 字段名同时接受半角 `:` 和全角 `：`（上游解析器也是这么容错的）。
 * - 「无」视为空列表。
 */
import { readFileSync, readdirSync } from 'node:fs';

/** 字段名 → 内部键。同时接受上游用过的几种别名。 */
const FIELD_ALIASES = new Map([
  ['触发词', 'triggers'],
  ['关键词', 'triggers'],
  ['常驻', 'constant'],
  ['内在价值', 'intrinsicValue'],
  ['初始分', 'intrinsicValue'],
  ['优先级', 'priority'],
  ['连带触发词', 'linkTriggers'],
  ['连带触发', 'linkTriggers'],
]);

/**
 * 把「无」和空串归一成空列表。
 * @param value - 原始值。
 * @returns 列表；无内容时为空数组。
 */
function splitList(value) {
  const text = String(value ?? '').trim();
  if (text === '' || text === '无' || text === '無') return [];
  return text
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter((item) => item !== '' && item !== '无');
}

/**
 * 把「是/否」归一成布尔。
 * @param value - 原始值。
 * @returns 是否为真。
 */
function toBool(value) {
  return /^(是|true|yes|1)$/i.test(String(value ?? '').trim());
}

/**
 * 把数值归一；非法时回退到默认值（解析不能因为一个坏字段就整份丢掉）。
 * @param value - 原始值。
 * @param fallback - 回退值。
 * @returns 数值。
 */
function toNumber(value, fallback) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 从标题行拆出名字与别名：`翁法罗斯之心 / PHILIA093` → ['翁法罗斯之心','PHILIA093']。
 * @param title - 标题文本（不含 `##`）。
 * @returns 名字列表。
 */
function splitNames(title) {
  return String(title ?? '')
    .split(/[/／]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * 去掉正文尾部残留的分隔线。
 *
 * 条目之间用 `---` 分隔，而 `---` 落在**上一条的块内**，所以不处理的话每条正文
 * 尾巴上都会挂一根分隔线。只剥尾部的（正文里合法的分隔线不会被误伤）。
 * @param lines - 正文各行。
 * @returns 清理后的各行。
 */
function stripTrailingRules(lines) {
  const out = [...lines];
  while (out.length > 0) {
    const last = out[out.length - 1].trim();
    if (last === '' || /^(-{3,}|\*{3,}|_{3,})$/.test(last)) {
      out.pop();
      continue;
    }
    break;
  }
  return out;
}

/**
 * 解析一个条目的文本块。
 * @param block - 条目块的各行（含标题行）。
 * @param source - 来源文件名（用于 id 与排查）。
 * @param index - 在本文件内的序号（从 0 起）。
 * @param startLine - 标题行在文件中的 1-based 行号。
 * @returns 条目对象。
 */
function parseBlock(block, source, index, startLine) {
  const title = block[0].replace(/^##\s*/, '').trim();
  const fields = {};
  const body = [];
  let inMeta = true;

  for (const line of block.slice(1)) {
    if (inMeta) {
      const meta = /^-\s*([^:：]+)[:：]\s*(.*)$/.exec(line);
      const key = meta ? FIELD_ALIASES.get(meta[1].trim()) : undefined;
      if (key !== undefined) {
        fields[key] = meta[2];
        continue;
      }
      // 元数据块结束：空行或第一个非字段行之后都算正文。
      if (line.trim() === '') continue;
      inMeta = false;
    }
    body.push(line);
  }

  const names = splitNames(title);
  return {
    id: `${source}#${index}`,
    title,
    names,
    triggers: splitList(fields.triggers),
    linkTriggers: splitList(fields.linkTriggers),
    constant: toBool(fields.constant),
    intrinsicValue: toNumber(fields.intrinsicValue, 60),
    priority: toNumber(fields.priority, 100),
    content: stripTrailingRules(body).join('\n').trim(),
    source,
    line: startLine
  };
}

/**
 * 解析一份世界书 markdown。
 * @param text - 文件全文。
 * @param source - 来源标识（一般是文件名）。
 * @returns 条目数组；没有条目时为空数组。
 */
export function parseWorldbookText(text, source = 'inline') {
  const lines = String(text ?? '').split('\n');
  const heads = [];
  lines.forEach((line, i) => {
    if (/^##\s+\S/.test(line)) heads.push(i);
  });
  if (heads.length === 0) return [];

  return heads.map((start, index) => {
    const end = index + 1 < heads.length ? heads[index + 1] : lines.length;
    return parseBlock(lines.slice(start, end), source, index, start + 1);
  });
}

/**
 * 解析多份世界书。id 里带来源，所以不同文件的同序号条目不会撞。
 * @param docs - `[{ name, text }]` 数组。
 * @returns 条目数组（按传入顺序拼接）。
 */
export function parseWorldbookDocs(docs) {
  return (docs ?? []).flatMap((doc) => parseWorldbookText(doc?.text, doc?.name ?? 'inline'));
}

/**
 * 从目录读并解析世界书。只读文件，不做任何缓存 —— 缓存交给调用方决定。
 * @param dir - 目录路径。
 * @param readDir - 可选注入，便于测试（返回文件名数组）。
 * @returns 条目数组。
 */
export function loadWorldbookDirectory(dir, readDir = readdirSync) {
  const names = readDir(dir)
    .filter((name) => name.endsWith('.md'))
    .sort();
  const docs = names.map((name) => ({
    name,
    text: readFileSync(`${dir}/${name}`, 'utf8')
  }));
  return parseWorldbookDocs(docs);
}
