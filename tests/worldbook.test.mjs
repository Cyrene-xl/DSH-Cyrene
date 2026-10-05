/**
 * 世界书解析 / 匹配 / 组装的单元测试。
 *
 * 运行：`npm test`（等价于 `node --test tests/*.mjs`）
 *
 * ⚠️ 不要写 `node --test tests/` —— 带尾斜杠时 Node 会把目录当模块解析，
 * 报 `MODULE_NOT_FOUND: Cannot find module '…/tests'`。这个坑本文件头部早先就踩过。
 *
 * 除了构造数据，最后还直接拿**随包的那份世界书数据**跑一遍 —— 要验证的是
 * "发出去的那份能被读进来"，基准就该是发出去的那份。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseWorldbookText, loadWorldbookDirectory } from '../worldbook/parse.mjs';
import { buildCorpus, matchWorldbook, DEFAULT_MAX_ACTIVE } from '../worldbook/match.mjs';
import { assembleWorldbook, buildInjection, DEFAULT_FORMAT } from '../worldbook/assemble.mjs';
import { recentUserTexts, apply as applyWorldbook } from '../worldbook/index.mjs';

/**
 * 世界书数据目录。默认指向**随包数据**，而不是开发机上的某个路径 ——
 * 要验证的是"发出去的那份能被读进来"，基准就该是发出去的那份。
 * 用环境变量可以换成别处的世界书。
 */
const REAL_DIR = process.env.CYRENE_WORLDBOOK_DIR
  || fileURLToPath(new URL('../worldbook/data/', import.meta.url));

/** 一份最小但字段齐全的样例。 */
const SAMPLE = `# 示例世界书

---

## 翁法罗斯之心 / PHILIA093
- 触发词: 翁法罗斯之心, 因子编号, 你从哪来
- 常驻: 否
- 内在价值: 60
- 优先级: 200
- 连带触发词: 无

权杖深处的意识核心。

它强调最初被嵌入权杖演算。

---

## 三形态同一性
- 触发词: 迷迷, 德谬歌
- 常驻: 否
- 内在价值: 80
- 优先级: 100
- 连带触发词: 三月七

三个名字，一个存在。

- **迷迷**：懵懂形态
- **德谬歌**：完整的形态

---

## 基本态度
- 触发词: 无
- 常驻: 是
- 内在价值: 50
- 优先级: 10
- 连带触发词: 无

说话自然一点。

---

## 三月七
- 触发词: 三月七, 小三月
- 常驻: 否
- 内在价值: 60
- 优先级: 300
- 连带触发词: 无

一起旅行的伙伴。
`;

// ───────────────────────── 解析 ─────────────────────────

test('解析：条目数正确', () => {
  const entries = parseWorldbookText(SAMPLE, 'sample.md');
  assert.equal(entries.length, 4);
});

test('解析：字段全部读到', () => {
  const [first] = parseWorldbookText(SAMPLE, 'sample.md');
  assert.equal(first.title, '翁法罗斯之心 / PHILIA093');
  assert.deepEqual(first.names, ['翁法罗斯之心', 'PHILIA093']);
  assert.deepEqual(first.triggers, ['翁法罗斯之心', '因子编号', '你从哪来']);
  assert.equal(first.constant, false);
  assert.equal(first.intrinsicValue, 60);
  assert.equal(first.priority, 200);
  assert.deepEqual(first.linkTriggers, []);
  assert.deepEqual(first.names.slice(0, 1), ['翁法罗斯之心']);
});

test('解析：常驻「是」归一成布尔', () => {
  const entries = parseWorldbookText(SAMPLE, 'sample.md');
  assert.equal(entries[2].constant, true);
});

test('解析：正文里的 `- **…**：` 列表不会被误当成字段', () => {
  const entries = parseWorldbookText(SAMPLE, 'sample.md');
  const third = entries[1];
  assert.ok(third.content.includes('**迷迷**'), '正文列表应保留');
  assert.ok(third.content.includes('**德谬歌**'), '正文列表应保留');
  assert.equal(third.priority, 100, '不应该被正文列表污染');
});

test('解析：正文完整保留、首尾无多余空行', () => {
  const [first] = parseWorldbookText(SAMPLE, 'sample.md');
  assert.ok(first.content.startsWith('权杖深处的意识核心。'));
  assert.ok(first.content.endsWith('最初被嵌入权杖演算。'));
});

test('解析：接受全角冒号与 `无` 触发词', () => {
  const text = `## 甲：乙\n- 触发词：甲\n- 常驻：是\n- 内在价值：7\n- 优先级：9\n- 连带触发词：无\n\n正文\n`;
  const [entry] = parseWorldbookText(text, 'x.md');
  assert.deepEqual(entry.triggers, ['甲']);
  assert.equal(entry.constant, true);
  assert.equal(entry.intrinsicValue, 7);
  assert.equal(entry.priority, 9);
  assert.deepEqual(entry.linkTriggers, []);
});

test('解析：坏数值回退到默认值而不是丢掉整条', () => {
  const text = `## 甲\n- 触发词: 甲\n- 优先级: 不是数字\n\n正文\n`;
  const [entry] = parseWorldbookText(text, 'x.md');
  assert.equal(entry.priority, 100);
});

test('解析：没有条目的文件返回空数组', () => {
  assert.deepEqual(parseWorldbookText('# 只有标题\n没有条目\n', 'x.md'), []);
});

test('解析：id 带来源，跨文件不撞', () => {
  const a = parseWorldbookText(SAMPLE, 'a.md');
  const b = parseWorldbookText(SAMPLE, 'b.md');
  assert.equal(a[0].id, 'a.md#0');
  assert.equal(b[0].id, 'b.md#0');
});

// ───────────────────────── 匹配 ─────────────────────────

const ENTRIES = parseWorldbookText(SAMPLE, 'sample.md');

test('匹配：常驻条目独立成组、不占名额、不依赖语料', () => {
  const corpus = buildCorpus({ userText: '今天天气不错' });
  const { permanent, primary } = matchWorldbook(ENTRIES, corpus);
  assert.deepEqual(permanent.map((h) => h.entry.title), ['基本态度']);
  assert.equal(permanent[0].reason, 'constant');
  assert.equal(primary.length, 0, '常驻不该混进 primary');
});

test('匹配：触发词命中', () => {
  const corpus = buildCorpus({ userText: '你和迷迷是什么关系？' });
  const { permanent, primary } = matchWorldbook(ENTRIES, corpus);
  assert.deepEqual(primary.map((h) => h.entry.title), ['三形态同一性']);
  assert.deepEqual(permanent.map((h) => h.entry.title), ['基本态度']);
});

test('匹配：未命中关键词时只剩常驻', () => {
  const corpus = buildCorpus({ userText: '帮我写个排序函数' });
  const { permanent, primary } = matchWorldbook(ENTRIES, corpus);
  assert.equal(primary.length, 0);
  assert.deepEqual(permanent.map((h) => h.entry.title), ['基本态度']);
});

test('匹配：上限只约束关键词命中，常驻再多也不会把相关条目挤掉', () => {
  // 构造 20 条常驻 + 1 条关键词命中。若常驻参与上限竞争，那条命中的会被挤出去。
  const entries = [
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `c#${i}`, title: `常驻${i}`, triggers: [], linkTriggers: [],
      constant: true, priority: 999, content: `常驻正文${i}`, source: 'c.md', line: 1
    })),
    {
      id: 'k#0', title: '相关条目', triggers: ['关键词'], linkTriggers: [],
      constant: false, priority: 1, content: '相关正文', source: 'k.md', line: 1
    }
  ];
  const corpus = buildCorpus({ userText: '关键词' });
  const { permanent, primary } = matchWorldbook(entries, corpus);
  assert.equal(permanent.length, 20);
  assert.deepEqual(primary.map((h) => h.entry.title), ['相关条目'], '相关条目不该被常驻挤掉');
});

test('匹配：按优先级降序（本实现没有 activation，priority 就是主排序键）', () => {
  const corpus = buildCorpus({ userText: '三月七和翁法罗斯之心' });
  const { primary } = matchWorldbook(ENTRIES, corpus);
  const priorities = primary.map((h) => h.entry.priority);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => b - a));
});

test('匹配：连带触发词是 One-Shot —— 命中「三形态同一性」会连带拉进「三月七」', () => {
  const corpus = buildCorpus({ userText: '德谬歌是谁' });
  const { primary, chained } = matchWorldbook(ENTRIES, corpus);
  assert.ok(primary.some((h) => h.entry.title === '三形态同一性'));
  assert.deepEqual(chained.map((h) => h.entry.title), ['三月七']);
  assert.equal(chained[0].reason, 'chained');
});

test('匹配：连带不会链式爆炸（被连带拉进来的不再继续连带）', () => {
  const corpus = buildCorpus({ userText: '德谬歌是谁' });
  const { chained } = matchWorldbook(ENTRIES, corpus);
  assert.equal(chained.length, 1);
});

test('匹配：已在 primary 里的条目不会重复出现在 chained', () => {
  const corpus = buildCorpus({ userText: '德谬歌和三月七' });
  const { primary, chained } = matchWorldbook(ENTRIES, corpus);
  const primaryIds = new Set(primary.map((h) => h.entry.id));
  assert.ok(chained.every((h) => !primaryIds.has(h.entry.id)));
});

test('匹配：超过上限会被截断并记 diagnostics', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `x#${i}`,
    title: `条${i}`,
    triggers: ['共同词'],
    linkTriggers: [],
    constant: false,
    priority: 100 - i,
    content: `正文${i}`,
    source: 'x.md',
    line: 1
  }));
  const corpus = buildCorpus({ userText: '共同词' });
  const { primary, diagnostics } = matchWorldbook(many, corpus);
  assert.equal(primary.length, DEFAULT_MAX_ACTIVE);
  assert.equal(diagnostics.length, 12 - DEFAULT_MAX_ACTIVE);
  assert.equal(diagnostics[0].code, 'capped');
});

test('匹配：scanDepth=1 只看 D0', () => {
  const corpus = buildCorpus({ userText: '今天天气不错', previousTexts: ['迷迷'] });
  assert.equal(matchWorldbook(ENTRIES, corpus, { scanDepth: 1 }).primary.length, 0);
  assert.equal(matchWorldbook(ENTRIES, corpus, { scanDepth: 3 }).primary.length, 1);
});

test('匹配：大小写不敏感（英文触发词）', () => {
  const entries = parseWorldbookText(`## 甲\n- 触发词: PHILIA093\n- 常驻: 否\n\n正文\n`, 'x.md');
  const corpus = buildCorpus({ userText: 'philia093 是什么' });
  assert.equal(matchWorldbook(entries, corpus).primary.length, 1);
});

// ───────────────────────── 组装 ─────────────────────────

test('组装：没有命中就返回空串（不该注入空块）', () => {
  const built = assembleWorldbook({ primary: [], chained: [] });
  assert.equal(built.text, '');
  assert.equal(built.count, 0);
});

test('组装：含抬头、前言与正文', () => {
  const corpus = buildCorpus({ userText: '翁法罗斯之心' });
  const built = buildInjection(ENTRIES, corpus);
  assert.ok(built.text.startsWith(DEFAULT_FORMAT.header));
  assert.ok(built.text.includes('权杖深处的意识核心'));
  assert.ok(built.chars > 0);
});

test('组装：连带条目带 【标题】，普通条目默认不带（与上游一致）', () => {
  const corpus = buildCorpus({ userText: '德谬歌' });
  const built = buildInjection(ENTRIES, corpus);
  assert.ok(built.text.includes('【三月七】'), '连带条目应有标题');
  assert.ok(!built.text.includes('【三形态同一性】'), '普通命中条目默认不加标题');
});

test('组装：可以要求所有条目都带标题', () => {
  const corpus = buildCorpus({ userText: '德谬歌' });
  const built = buildInjection(ENTRIES, corpus, { titles: true });
  assert.ok(built.text.includes('【三形态同一性】'));
});

test('组装：抬头措辞可覆盖', () => {
  const corpus = buildCorpus({ userText: '迷迷' });
  const built = buildInjection(ENTRIES, corpus, { format: { header: 'X\n', preamble: 'Y\n' } });
  assert.ok(built.text.startsWith('X\nY\n'));
});

test('组装：常驻块内容恒定、命中块才随语料变', () => {
  // 注入层就是这么做的：常驻块与命中块**各调一次 assembleWorldbook**（早先有个
  // assembleSplit() 专门干这个，改成两条通道后成了死代码，已删除）。这里照着那个
  // 用法测，保证"常驻块逐字节稳定、命中块随语料变"这个性质还在。
  const of = (q) => {
    const m = buildInjection(ENTRIES, buildCorpus({ userText: q })).matched;
    return {
      staticText: assembleWorldbook({ permanent: m.permanent, primary: [], chained: [] }).text,
      dynamicText: assembleWorldbook({ permanent: [], primary: m.primary, chained: m.chained }).text
    };
  };
  const a = of('翁法罗斯之心');
  const b = of('德谬歌');
  // 常驻块必须逐字节相同 —— 否则同一条 context 会反复重发，长会话里越积越多。
  assert.equal(a.staticText, b.staticText);
  assert.equal(a.staticText, of('随便说点什么').staticText);
  assert.ok(a.staticText.includes('说话自然一点'));
  // 命中块必须不同，否则说明匹配根本没起作用。
  // 注意：不能拿「迷迷」和「德谬歌」比 —— 它俩都是同一条的触发词，命中本就该一样。
  assert.notEqual(a.dynamicText, b.dynamicText);
  // 注意这个测试用的是文件顶部那份**合成样例** ENTRIES，不是随包的真实数据 ——
  // 所以这里断言样例里的串。真实数据用的是另一套串（见「真实数据」那组测试）。
  assert.ok(a.dynamicText.includes('权杖深处的意识核心'));
  assert.ok(b.dynamicText.includes('三个名字，一个存在'));
});

// ───────────────────────── 注入层：从会话事件取语料 ─────────────────────────

/** 造一个假的 session，只要能拿到 id 与 snapshotEvents 即可。 */
function fakeSession(events, id = 's-test') {
  return { id, snapshotEvents: () => events };
}

/** 造一条会话事件。 */
function msg(seq, role, text, sourceKind) {
  return {
    seq,
    type: 'user/message',
    data: { role, source: { kind: sourceKind }, content: [{ type: 'text', text }] }
  };
}

test('语料：只取真实用户消息，排除插件快照', () => {
  const session = fakeSession([
    msg(1, 'user', '第一句', 'user'),
    msg(2, 'user', '我是插件注入的快照', 'plugin'),
    msg(3, 'assistant', '昔涟的回复', undefined),
    msg(4, 'user', '第二句', 'user')
  ]);
  assert.deepEqual(recentUserTexts(session, 3), ['第二句', '第一句']);
});

test('语料：新→旧排列', () => {
  const session = fakeSession([
    msg(1, 'user', '旧', 'user'),
    msg(2, 'user', '中', 'user'),
    msg(3, 'user', '新', 'user')
  ]);
  assert.deepEqual(recentUserTexts(session, 3), ['新', '中', '旧']);
});

test('语料：遵守 depth 上限', () => {
  const session = fakeSession([
    msg(1, 'user', 'A', 'user'),
    msg(2, 'user', 'B', 'user'),
    msg(3, 'user', 'C', 'user')
  ]);
  assert.deepEqual(recentUserTexts(session, 2), ['C', 'B']);
  assert.deepEqual(recentUserTexts(session, 1), ['C']);
});

test('语料：跳过空文本与非文本消息', () => {
  const session = fakeSession([
    msg(1, 'user', '有内容', 'user'),
    { seq: 2, type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [] } },
    { seq: 3, type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'image' }] } },
    msg(4, 'user', '  ', 'user')
  ]);
  assert.deepEqual(recentUserTexts(session, 5), ['有内容']);
});

test('语料：忽略非 user/message 事件类型', () => {
  const session = fakeSession([
    { seq: 1, type: 'assistant/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'X' }] } },
    msg(2, 'user', '真消息', 'user')
  ]);
  assert.deepEqual(recentUserTexts(session, 5), ['真消息']);
});

test('语料：session 缺失或抛错时返回空数组，不抛异常', () => {
  assert.deepEqual(recentUserTexts(undefined, 3), []);
  assert.deepEqual(recentUserTexts({}, 3), []);
  assert.deepEqual(recentUserTexts({ snapshotEvents: () => { throw new Error('boom'); } }, 3), []);
  assert.deepEqual(recentUserTexts({ snapshotEvents: () => null }, 3), []);
});

test('语料：助手自己的话不会成为触发源（防自我回声）', () => {
  const session = fakeSession([
    msg(1, 'user', '随便聊聊', 'user'),
    msg(2, 'assistant', '我刚刚提到了迷迷', undefined)
  ]);
  const texts = recentUserTexts(session, 3);
  assert.deepEqual(texts, ['随便聊聊']);
  // 拿它去匹配，不该因为助手提过「迷迷」就命中三形态同一性。
  const corpus = buildCorpus({ userText: texts[0], previousTexts: texts.slice(1) });
  const { primary } = matchWorldbook(ENTRIES, corpus);
  assert.equal(primary.length, 0);
});

// ───────────────────────── 注入层：apply() 端到端 ─────────────────────────

/**
 * 造一个最小的假 ctx：接住 apply 里的 context 注册、事件监听与 provide 即可。
 * 这样不用起 DSH 就能验证注入层的接线是否正确。
 */
function mockCtx() {
  const registered = [];
  const listeners = new Map();
  const provided = {};
  const ctx = {
    logger: { info: () => {} },
    systemPrompt: { context: (c) => registered.push(c) },
    inject: (_deps, cb) => cb({ systemPrompt: { context: (c) => registered.push(c) } }),
    on: (event, handler) => listeners.set(event, handler),
    provide: (name, value) => { provided[name] = value; },
    effect: () => {}
  };
  return { ctx, registered, listeners, provided };
}

/**
 * 造一条「消息」。注意：agent/pre-step 的 `messages` 是**消息**（role/source/content
 * 在顶层），不是会话事件（那样是 {seq,type,data}）—— 两者在测试里必须分清。
 */
function userMsg(text) {
  return { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] };
}

/** 跑一次假 pre-step：`next` 原样返回 claimed 消息，模拟 DSH 的兜底行为。 */
async function runPreStep(listeners, messages, session) {
  const handler = listeners.get('agent/pre-step');
  assert.ok(handler, '必须注册 agent/pre-step 监听');
  return handler(
    { agent: { session }, messages, step: 1, turn: 1 },
    async () => ({ kind: 'enter', messages: [...messages] })
  );
}

test('注入层：常驻块走 context()，顺序稳定', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, () => {
  const { ctx, registered } = mockCtx();
  applyWorldbook(ctx);
  assert.deepEqual(registered.map((c) => c.name), ['cyrene:worldbook-static']);
  assert.ok(Number.isFinite(registered[0].order));
});

test('注入层：必须注册 agent/pre-step —— 命中块拿不到本轮消息就完全失效', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, () => {
  const { ctx, listeners } = mockCtx();
  applyWorldbook(ctx);
  // 这条守卫来自一次真实事故：装配（assemble）跑在 session.append("user/message")
  // **之前**，所以 context()/variable() 的 provider 读会话拿不到本轮用户消息。
  // 若把命中块放回 context()，新会话第一轮会静默不注入任何东西。
  assert.ok(listeners.has('agent/pre-step'), '命中块必须挂在 agent/pre-step 上');
});

test('注入层：常驻块不需要会话也能出内容', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, () => {
  const { ctx, registered } = mockCtx();
  applyWorldbook(ctx);
  const text = registered[0].text({});
  assert.ok(text.includes('【你本来就知道的事】'), '常驻块应有抬头');
  assert.ok(text.length > 0);
});

test('注入层：端到端 —— 本轮消息里有触发词，命中块被追加进 messages', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, async () => {
  const { ctx, listeners } = mockCtx();
  applyWorldbook(ctx);

  const claimed = [userMsg('你还记得翁法罗斯之心吗')];
  const decision = await runPreStep(listeners, claimed, fakeSession([]));

  assert.equal(decision.messages.length, 2, '应在原消息后追加一条');
  const injected = decision.messages[1];
  assert.equal(injected.role, 'user');
  assert.equal(injected.source.kind, 'plugin');
  const text = injected.content.map((b) => b.text).join('');
  assert.ok(text.includes('翁法罗斯之心'), '命中块应含命中的条目');
  assert.ok(text.includes('帝皇权杖'), '命中块应含该条正文');
});

test('注入层：追加的消息必须带非空 id —— 否则会话历史会加载失败', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, async () => {
  // 这条守护来自一次真实事故：DSH 自己的消息都走 createMessage()，它内部赋
  // `id: randomUUID()`；而注入层是**手写描述符**，绕过了那个工厂。
  // 缺 id 的 user/message 会被原样写进会话事件，之后 dsh-session 的
  // assertMessageEventShape 直接拒绝整份历史：
  //   session event at seq N lacks an identified message
  // 表现是那个会话再也打不开，而且完全看不出跟本插件有关。
  // 实测本机 21 个会话里有 3 个因此损坏，每条只差这一个字段。
  const { ctx, listeners } = mockCtx();
  applyWorldbook(ctx);
  const decision = await runPreStep(listeners, [userMsg('你还记得翁法罗斯之心吗')], fakeSession([]));
  assert.equal(decision.messages.length, 2, '前提：这条消息确实触发了注入');
  const injected = decision.messages[1];
  assert.equal(typeof injected.id, 'string', 'id 必须是字符串');
  assert.ok(injected.id.length > 0, 'id 不能是空串');
  assert.equal(decision.messages[0].id === injected.id, false, 'id 不能与已有消息重复');
});

test('注入层：无关闲聊不追加任何消息', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, async () => {
  const { ctx, listeners } = mockCtx();
  applyWorldbook(ctx);
  const claimed = [msg(1, 'user', '今天天气不错，随便聊聊', 'user')];
  const decision = await runPreStep(listeners, claimed, fakeSession([]));
  assert.equal(decision.messages.length, 1, '不该追加');
});

test('注入层：本轮没有真实用户消息时不追加、不抛错', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, async () => {
  const { ctx, listeners } = mockCtx();
  applyWorldbook(ctx);
  const decision = await runPreStep(listeners, [], fakeSession([]));
  assert.equal(decision.messages.length, 0);
});

test('注入层：同一内容不重复注入（抑制历史累积）', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, async () => {
  const { ctx, listeners } = mockCtx();
  applyWorldbook(ctx);
  const claimed = [userMsg('你还记得翁法罗斯之心吗')];
  const session = fakeSession([]);
  const first = await runPreStep(listeners, claimed, session);
  const second = await runPreStep(listeners, claimed, session);
  assert.equal(first.messages.length, 2, '第一次应注入');
  assert.equal(second.messages.length, 1, '内容相同则第二次不注入');
});

test('注入层：不发布任何服务（预设里发布全局服务会让整个预设挂载失败）', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, () => {
  const { ctx, provided } = mockCtx();
  applyWorldbook(ctx);
  // dsh-agent-presets 的 leakedServices 校验会把预设内发布的全局服务判为污染，
  // 直接抛错让整个预设挂载失败 —— 表现是「纯文本对话模式」不可用。
  assert.deepEqual(Object.keys(provided), [], '预设级插件不得 ctx.provide()');
});

test('注入层：本轮消息一律从 agent/pre-step 的参数取，不读会话', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, async () => {
  const { ctx, listeners } = mockCtx();
  applyWorldbook(ctx);
  // 会话里只有历史消息；本轮消息只存在于 messages 参数里 —— 这正是真实情况。
  const session = fakeSession([msg(1, 'user', '上一轮说的话', 'user')]);
  const claimed = [userMsg('德谬歌是谁')];
  const decision = await runPreStep(listeners, claimed, session);
  const text = decision.messages[1].content.map((b) => b.text).join('');
  // 注意：组装默认不给条目加标题（对齐上游），所以断言正文而不是条目标题。
  assert.ok(text.includes('三个名字，一个存在'), '应命中本轮消息里的触发词');
  assert.ok(!text.includes('上一轮说的话'), '不该把历史当成本轮语料');
});

// ───────────────────────── 真实数据 ─────────────────────────

test('真实数据：能解析你实际的 61 条世界书', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, () => {
  const entries = loadWorldbookDirectory(REAL_DIR);
  assert.ok(entries.length >= 60, `应解析出 60+ 条，实际 ${entries.length}`);

  // 每条都必须有触发词或常驻，否则它永远不会生效 —— 这是最该防的静默失败。
  const dead = entries.filter((e) => !e.constant && e.triggers.length === 0);
  assert.deepEqual(dead.map((e) => e.title), [], '不能有条目既非常驻又无触发词');

  const constants = entries.filter((e) => e.constant);
  assert.ok(constants.length > 0, '应当存在常驻条目');
  assert.ok(entries.every((e) => e.content.length > 0), '每条都应有正文');
});

test('真实数据：每个字段都被读到（不需要回退到默认值）', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, () => {
  const entries = loadWorldbookDirectory(REAL_DIR);
  // 默认值：priority=100、intrinsicValue=60。真实数据里这两个值都很丰富，
  // 若出现大面积等于默认值，说明解析没读到字段。
  const atDefault = entries.filter((e) => e.priority === 100 && e.intrinsicValue === 60);
  assert.ok(atDefault.length < entries.length / 2, `疑似解析失败 ${atDefault.length}/${entries.length} 条`);
});

test('真实数据：能真的匹配到东西', { skip: !existsSync(REAL_DIR) && '真实世界书目录不存在' }, () => {
  const entries = loadWorldbookDirectory(REAL_DIR);
  const corpus = buildCorpus({ userText: '你还记得翁法罗斯之心吗？' });
  const built = buildInjection(entries, corpus);
  assert.ok(built.count > 0, '应当有命中');
  assert.ok(built.text.includes('翁法罗斯之心'));
});
