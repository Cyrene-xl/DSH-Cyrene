# 固定安装源（pinned source）

DSH STORE 与 `build-dsh-plugin` 的检查都要求"可固定的源码锚点"：插件必须能绑定到
一个**不可变的 Commit**，而不是浮动的 `main`。

- 仓库：<https://github.com/Cyrene-xl/DSH-Cyrene>
- **0.7.4 的源码锚点（审查清单修复后）**：`ee5191f25589132389b2a3835890b9d18a1ba091`
  （0.7.1 的最终源码：商店固定源整改 + 安装器加固）
- 安装（固定到该 Commit）：

  ```bash
  git clone https://github.com/Cyrene-xl/DSH-Cyrene
  cd DSH-Cyrene
  git checkout ee5191f25589132389b2a3835890b9d18a1ba091
  dsh plugin --profile <你的 profile> add link:$PWD
  node scripts/install.mjs
  ```

## 为什么需要这一页

- 自动检查会把"找不到 40 位 Commit 锚点"算作**可固定性不足**（预检里的
  `immutable 40-character source present`）；
- 发行版（Release zip / 商店条目）也应该固定到同一个 Commit，避免"看到的是 A、装到的是 B"；
- 这里的 Commit 一旦写就不改：新版本新增一条，而不是替换旧的（旧锚点仍然可复现）。

> 注意：本页的 Commit 锚点只证明"源码可固定"，不证明运行验收。真实的 DSH 启动、
> Profile 安装与卸载证据见 [`store-contract.md`](./store-contract.md)。
