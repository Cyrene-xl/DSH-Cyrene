# 第三方内容与授权声明 / Third-Party Notices

## 一句话概括

- **本仓库的代码**（`index.js`、`cordis.patch.yml`、`scripts/`、`package.json` 等）：MIT，本项目作者原创。
- **`preset/agent.cordis.yml` 内的人设文本**：来自开源项目 **Cyrene-Agent**，MIT，`Copyright (c) 2026 Playa`；**已取得原作者同意**（2026-10-03，见第 1 节「授权确认」）。
- **角色 IP**（昔涟 / Cyrene 及《崩坏：星穹铁道》相关内容）：归 **HoYoverse / 米哈游** 所有。
- **禁止商业使用**：含角色 IP 的衍生物不得用于售卖、付费社群、广告变现、打包销售等。

---

## 1. 人设文本的来源与授权

`preset/agent.cordis.yml` 中的人设与语气内容整理自：

- 项目：**Cyrene-Agent** — <https://github.com/Playa-Cyrene/Cyrene-Agent>
- 原作者：Playa
- 源文件：`prompts/chat_system.md`、`prompts/chat_identity.md`、`prompts/soul.md`、`prompts/canon_quotes.md`
- 上游许可证：MIT License，`Copyright (c) 2026 Playa`
- 许可证副本：见 [`LICENSES/Cyrene-Agent-LICENSE.txt`](./LICENSES/Cyrene-Agent-LICENSE.txt)

MIT License 允许使用、复制、修改、合并、发布与再分发，条件是在副本中保留上述版权声明
与许可证全文。本仓库已履行该条件。

上游在 README 中对其自身许可范围的说明（转述）：源代码采用 MIT；
角色 IP、Live2D 模型与美术资产不属于 MIT 授权范围，分别遵循其模型授权文件与米哈游同人创作规范处理。

### 授权确认

除上述 MIT 许可外，本项目在公开发布前已征询原作者并取得同意：

- **授权时间**：`2026-10-03`
- **公开回复（主要凭据）**：原作者在
  <https://github.com/Playa-Cyrene/Cyrene-Agent/issues/137#issuecomment-5969268084>
  公开回复「拿就行，除了 live2D 模型，模型需要去找原作者」，
  并将该 issue 以 **closed as completed** 结案（同日 12:42 UTC）。
- **另经私信确认**：同日经 B 站私信沟通，作者亦回复同意使用。

> **许可范围说明**：
>
> 1. 该确认覆盖的是**提示词文本本身**（`prompts/` 下那四篇的整理与再分发）。
> 2. 作者明确**排除 Live2D 模型**——模型不在本确认范围内，其授权需另行向
>    模型原作者取得。**本仓库本就不包含**任何 Live2D 模型、立绘、美术资源或
>    音频，因此不受该排除影响；但**日后若有人要加入模型，必须自行取得授权**，
>    不得援引本确认。
> 3. 该确认**不覆盖角色 IP**——角色、世界观与美术的权利归 HoYoverse / 米哈游
>    所有，原作者无权代为授权该部分。因此本文件第 2 节（角色 IP 声明）与
>    第 3 节（非商业使用条款）**继续完整适用**。

## 2. 角色 IP 声明

Cyrene（昔涟）以及《崩坏：星穹铁道》相关的角色、世界观、名称与美术，
其知识产权归 **HoYoverse / 米哈游** 所有。

本项目为**非官方同人周边工具**，与 HoYoverse / 米哈游**无任何关联、背书或赞助关系**。
本项目不主张对上述 IP 的任何权利。

## 3. 非商业使用条款

承袭上游的同一立场：**因底层角色 IP 涉及米哈游同人创作规范，本仓库中
包含角色 IP 的衍生物禁止商业使用。**

明确禁止的情形包括但不限于：

- 售卖本插件或其修改版
- 放入付费社群、付费内容作为权益发放
- 通过广告、赞助等方式直接变现
- 与其他商品打包销售

## 4. 本仓库不包含什么

为避免扩大授权风险，本仓库**不包含**以下内容，请使用者自行解决：

- ❌ Live2D 模型文件（`.moc3` / `.motion3.json` / `.physics3.json` / 纹理等）
- ❌ 角色立绘、美术资源、音频、语音
- ❌ 游戏内文本的成段收录（`preset/agent.cordis.yml` 中引用的原作台词摘录，
  其内容版权归 HoYoverse / 米哈游所有，仅作语气参考用途）

## 5. 可选依赖（第三方插件）

以下插件**不在本仓库内**，请各自从原始仓库安装。本仓库不捆绑、不再分发它们：

| 插件 | 作者 | 授权 |
|---|---|---|
| [dsh-meme](https://github.com/yyh-001/dsh-meme) | yyh-001 | MIT |
| [dsh-dream-skin](https://github.com/RevolutionLA/dsh-dream-skin) | RevolutionLA | MIT |
| [dsh-ui-boost](https://github.com/DoshinJiu/dsh-ui-boost) | DoshinJiu | MIT |
| [dsh-anime-theme](https://github.com/zxr2115-1/dsh-anime-theme) | zxr2115-1 | MIT |

表情图库与壁纸图片的版权归各自作者所有。

## 6. 使用者的责任

1. 若你**不再需要**人设文本，可以直接删除 `preset/agent.cordis.yml` 中的相关内容，
   或改用空白模板——本插件的装配机制不依赖具体人设。
2. 若你在其基础上**继续创作**并公开分发，请保留本文件与许可证副本，
   并同样声明角色 IP 归属与禁止商业使用。
3. 请勿声称本插件是官方作品，或暗示得到 IP 方授权。

## 7. 遇到异议时

本项目已就提示词文本的整理与再分发取得原作者同意（见第 1 节「授权确认」）。
但若日后 **IP 方（HoYoverse / 米哈游）** 或任何相关方对本仓库的分发提出异议，
维护者应配合下架相关内容，或改为「只分发插件骨架、由使用者自备人设」的形式。
