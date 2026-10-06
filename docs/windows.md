# Windows 上怎么用这个项目

## 一句话

**Windows 用户走 `node scripts/install.mjs`。** 本仓库没有 Windows 专用脚本 ——
而且这是**有意的**，不是忘了写。

---

## 为什么没有 `install.ps1`

以前有 `scripts/install.ps1` 和 `install.bat`，**已经删除**。

原因很直接：**作者没有自己的电脑，这一整套是在 DSH App（Android）里做的** ——
开发环境里没有 Windows、也没有 PowerShell。那两个脚本**无法实测**，只能靠用户反馈
来回试，连试三轮都没在真机上跑通。

对比一下就很清楚：

| 路径 | 轮次 | 结果 |
| --- | --- | --- |
| `scripts/install.sh` / `install.mjs` | 1 | ✅ 一次通过（用临时 `DSH_HOME` 实测安装 / 幂等 / 卸载） |
| `scripts/install.ps1` / `install.bat` | **3** | ❌ 每轮都在同一类坑里打转，仍未在真机跑通 |

与其留一条**没人能验证**的路，不如只留一条能跑通的。这不是放弃 Windows 支持 ——
`install.mjs` 在 Windows 上照样跑，它跨平台、无 shell 依赖。

> **要是它在你的 Windows 上不适配**：那大概率得等作者以后有了自己的电脑，
> 才能把那部分补回来重做一遍。

---

## 在 Windows 上怎么装

```powershell
# 1. 装插件本体（在 DSH 的 profile 里）
dsh plugin --profile <你的 profile> add dsh-cyrene

# 2. 装预设
node scripts\install.mjs
```

第 2 步之后，`scripts/install.mjs` 会自己告诉你下一步 —— 它结尾会根据你的 DSH 版本
给出该走哪条路。**DSH 0.2.0 及以上请特别注意那一段提示**：0.2.0 起预设改成声明式
注册表，拷目录那种方式**不会生效，而且不报错**。详见 README 的安装章节。

---

## 已知的坑（五条，全部来自真实 Windows 反馈）

这些**都只能靠真实 Windows 暴露** —— 开发机上 `node --check`、`npm test`、
人工审查全都看不出来。记在这里，一是让 Windows 用户知道"不是你的问题"，
二是将来若恢复 Windows 脚本，照着避开。

| # | 现象 | 根因 | 正确写法 |
| --- | --- | --- | --- |
| 1 | PowerShell 5.1 报 `unexpected token ')'` | 脚本是 LF 行尾；5.1 对 LF 敏感的写法会解析失败 | 行尾必须 CRLF**（且必须是 blob 里的 CRLF，见 #2）** |
| 2 | 改了 `.gitattributes` 用户还是拿到 LF | `text eol=crlf` **只在检出时**转 CRLF，**blob 里存的仍是 LF**；`git pull` 过的人（内容未变的文件不会重新检出）和用 raw / jsDelivr 下载的人拿到的还是 LF | 用 `-text`：不让 Git 做任何转换，工作区是什么就存什么 |
| 3 | 语法报错，且位置飘到后面几十行的某个 `}` 上 | 管道跨行写（行尾悬空 `\|`），5.1 处理不可靠 | 整条管道写在一行 |
| 4 | 同上（解析器失步，报错位置毫无关系） | **here-string**（`@" ... "@`）：5.1 要求终止符独占一行且在列 0，遇上 LF 行尾直接失败；以及把 `if` 当表达式赋值（`$x = if (...) { } else { }`，那是 PowerShell 7 的写法） | 改用字符串拼接；`if` 先声明再 if/else 分开写 |
| 5 | Node 脚本 **exit 0、零输出、零报错** | 入口判断写成 `` import.meta.url === `file://${process.argv[1]}` `` —— Windows 上 `process.argv[1]` 是 `C:\...`，而 `import.meta.url` 是 `file:///C:/...`，拼出来永不相等，`main()` 从不执行 | 用 `pathToFileURL(process.argv[1]).href` |

第 5 条与 PowerShell 无关，是**跨平台脚本**的坑，现在由
[`tests/portability.test.mjs`](../tests/portability.test.mjs) 常驻守着。

---

## 哪些验过、哪些没验过

| 对象 | 状态 |
| --- | --- |
| `scripts/install.sh`、`scripts/install.mjs` | ✅ 已验（临时 `DSH_HOME` 实跑：安装 / 幂等 / 卸载） |
| `scripts/export-preset-declarations.mjs` | ✅ 已验（往返比对：生成结果的 `config.plugins` 与源组合深度相等） |
| 全部插件源码与预设 YAML | ✅ 已验（`npm test` + `npm run harness:check`） |
| **Windows 原生执行的脚本** | **已删除**（见上） |

---

## 将来若要恢复 Windows 脚本

**前置条件：先在一台有 Windows 的机器上把它真跑通，再提交。**
不要凭着"看着没问题"就发 —— 这个仓库在这一件事上已经浪费了三轮。

并且把 `.gitattributes` 里这两行加回来（`-text`，不是 `eol=crlf`）：

```
*.ps1 -text
*.bat -text
```

`tests/portability.test.mjs` 里那几条 `.ps1` 断言是**条件式**的：现在没有 `.ps1`
就自动跳过，一旦加回来会立刻生效，替你挡住上表 #1–#4 那几类写法。

---

## 致谢

上面五条坑全部来自 B 站用户 **風兮_丢卞** 的连续反馈。

他那几轮不是普通的"报 bug" —— 每一条都给出了正确的问题定位，或者给出了能自证的
验证方法：

- 他先对照出"这台机器上另外两个预设都不是扫目录来的"，才把方向引到 DSH 0.2.0 的
  注册表变更上；
- 他量了 **blob 的 SHA256**，并拿 GitHub 与 jsDelivr 两侧比对，证明 `.gitattributes`
  改不了已入库的内容、也不是缓存问题 —— 这是我们自己没想到的角度；
- 他注意到报错行**不是**刚改过的那条管道，而是"前面某处括号未闭合导致解析器失步"，
  顺着这条线索才找到 here-string 和 `if` 当表达式赋值那两个雷。

没有这几轮，`install.ps1` 那条路大概会一直挂着一个"看起来能用、其实没人验证过"的样子。

