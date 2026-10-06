/**
 * 可移植性测试 —— 专门盯**在 Linux 上永远暴露不出来**的那类问题。
 *
 * ## 为什么需要这个文件
 *
 * 本项目的 CI 全跑在 ubuntu 上，而真实反馈里有三个 bug 全是 Windows 专属：
 *
 *   1. `install.ps1` LF 行尾 + 跨行管道 → PowerShell 5.1 语法爆炸
 *   2. `install.ps1` / `install.bat` 的行尾必须是 CRLF 才算真修好
 *   3. `export-preset-declarations.mjs` 用了
 *      `` import.meta.url === `file://${process.argv[1]}` `` 当入口判断 ——
 *      在 Windows 上永不成立，于是 **exit 0、零输出、零报错**
 *
 * 这三个在 Linux 上都"正常"，靠跑测试永远发现不了。所以这里改用**静态断言**：
 * 把已知的平台陷阱写成可检查的规则。规则不多，但每条都对应一次真实事故。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** 递归收集指定后缀的文件（跳过 .git / node_modules）。 */
function collect(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

test('可移植性：不得用 `file://${process.argv[1]}` 判断入口', () => {
  // 这个写法在 POSIX 上碰巧成立、在 Windows 上永远不成立（argv[1] 是 C:\...，
  // 而 import.meta.url 是 file:///C:/...），后果是 main() 静默不执行。
  // 正确写法：pathToFileURL(process.argv[1]).href。
  //
  // ⚠️ 只扫 scripts/ 下的**非注释行**：这个反模式本身经常被写进注释里做反面教材
  //    （本仓库的生成器就在注释里引用了它）。第一版没做这层排除，结果把
  //    "注释里提到它"和"真的用了它"一起报了 —— 误报比漏报更烦。
  const files = collect(join(repoRoot, 'scripts'), ['.mjs', '.js']);
  const looksLikeComment = (line) => {
    const t = line.trimStart();
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
  };
  const offenders = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (looksLikeComment(line)) return;
      if (/`file:\/\/\$\{process\.argv\[1\]\}`/.test(line) || /'file:\/\/'\s*\+\s*process\.argv\[1\]/.test(line)) {
        offenders.push(`${file.slice(repoRoot.length + 1)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `这些位置用了 Windows 上会静默失效的入口判断：${offenders.join(', ')}\n`
      + '→ 改用 pathToFileURL(process.argv[1]).href（node:url）。',
  );
});

test('可移植性：Windows 脚本必须是 CRLF、POSIX 脚本必须是 LF', () => {
  // 起因：install.ps1 是 LF 行尾，在真实 Windows 上 PowerShell 5.1 语法爆炸。
  // 仓库根的 .gitattributes 把这几类锁了行尾，这条断言把"锁生效了"变成可检查的事实
  // —— 包括在 Linux CI 上（eol=crlf 是检出时转换的，与平台无关）。
  const cases = [
    ...collect(join(repoRoot, 'scripts'), ['.ps1', '.bat', '.cmd']).map((f) => [f, 'CRLF']),
    ...collect(repoRoot, ['.sh']).map((f) => [f, 'LF']),
  ];
  assert.ok(cases.length > 0, '应当至少扫到几个脚本');

  const wrong = [];
  for (const [file, want] of cases) {
    const text = readFileSync(file, 'utf8');
    const hasCR = text.includes('\r\n');
    const got = hasCR ? 'CRLF' : 'LF';
    // 允许混排时以"有没有 CRLF"为准；纯 LF 文件不该含任何 \r
    if (got !== want) wrong.push(`${file.slice(repoRoot.length + 1)} 是 ${got}，应为 ${want}`);
  }
  assert.deepEqual(
    wrong,
    [],
    `行尾不符：\n  ${wrong.join('\n  ')}\n`
      + '→ Windows 原生执行的脚本要 CRLF、POSIX 的要 LF；检查根目录 .gitattributes 是否被删改。',
  );
});

test('可移植性：.gitattributes 必须继续锁住这两类文件', () => {
  const ga = join(repoRoot, '.gitattributes');
  assert.ok(existsSync(ga), '.gitattributes 不能删 —— 删了 Windows 用户会重新踩坑');
  const text = readFileSync(ga, 'utf8');
  for (const rule of ['*.ps1', '*.bat', '*.sh']) {
    assert.ok(text.includes(rule), `.gitattributes 应包含 ${rule} 的行尾规则`);
  }
  // Windows 脚本必须是 `-text`（**不让 Git 转换**），而不是 `text eol=crlf`：
  // 后者只在检出时转 CRLF，**blob 里仍是 LF** —— 于是 git pull 过的人、以及用
  // raw / jsDelivr 下载的人拿到的还是 LF。这是真实反馈里量了 blob SHA256 才发现的。
  assert.match(text, /\*\.ps1[^\n]*-text/, '*.ps1 必须是 -text（blob 里就得是 CRLF）');
  assert.match(text, /\*\.bat[^\n]*-text/, '*.bat 必须是 -text');
  assert.match(text, /\*\.sh[^\n]*eol=lf/, '*.sh 必须锁 eol=lf');
  // 反向断言：不许再退回 eol=crlf 那种"只转检出"的写法
  assert.doesNotMatch(text, /^\*\.ps1[^\n]*eol=crlf/m, '*.ps1 不该用 eol=crlf —— 那修不了 blob');
});

test('可移植性：PowerShell 5.1 不支持的写法不得出现在 .ps1 里', () => {
  // 两次真实 Windows 反馈换来的规则。5.1 的解析器在这两种写法上会**失步** ——
  // 报错位置漂到后面几十行的某个 `}` 上，看起来跟肇事那行毫无关系，极难查。
  //
  //   1. here-string（`@" ... "@`）遇上 LF 行尾：解析失败。
  //   2. `$x = if (...) { } else { }`：把 if 当表达式赋值是 PowerShell 7 的写法。
  //
  // 两者在 Linux 上都不会被发现（我们根本不跑 PowerShell），所以写成静态断言。
  const files = collect(join(repoRoot, 'scripts'), ['.ps1']);
  assert.ok(files.length > 0, '应当至少有一个 .ps1');

  const problems = [];
  for (const file of files) {
    const rel = file.slice(repoRoot.length + 1);
    const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
    lines.forEach((line, i) => {
      const t = line.trimStart();
      if (t.startsWith('//')) return;
      if (/@["']\s*$/.test(line)) problems.push(`${rel}:${i + 1} 用了 here-string（@" 或 @'）`);
      if (/^\s*\$[\w.]+\s*=\s*if\s*\(/.test(line)) problems.push(`${rel}:${i + 1} 把 if 当表达式赋值`);
    });
  }
  assert.deepEqual(
    problems,
    [],
    `PowerShell 5.1 会解析失败：\n  ${problems.join('\n  ')}\n`
      + '→ here-string 改成字符串拼接；if 赋值改成先声明再 if/else 分开写。',
  );
});
