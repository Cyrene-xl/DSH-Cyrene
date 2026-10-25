# 复刻这套观感：主题配置指南

这份文档说明**如何复现本项目的推荐观感**。

先说清楚最重要的一点：**这套观感不是一个可以打包下载的东西。** 它由若干**第三方插件**
加上**你本机的一组参数值**组合而成。所以正确的分享方式是**发指南，不是发样式包**。

## 为什么不能打包成"样式包"

| 构成 | 归属 | 能否打包分发 |
|---|---|---|
| `dsh-dream-skin` | 第三方（RevolutionLA，MIT） | ❌ 别人的作品，请引导去原仓库安装 |
| `dsh-ui-boost` | 第三方（DoshinJiu，MIT） | ❌ 同上 |
| `dsh-anime-theme` | 第三方（zxr2115-1，MIT） | ❌ 同上 |
| `dsh-meme` | 第三方（yyh-001，MIT） | ❌ 同上 |
| `dsh-custom-splash` | 第三方 fork（MIT） | ❌ 引导去原仓库安装 |
| `dsh-550c-boot` | 第三方（MIT，npm） | ❌ 引导去 npm / 原仓库安装 |
| `dsha-brand-rename` / `dsha-hero-mascot` / `dsha-pet-button` | 本机 `plugin-src`（私用） | ❌ 无公开仓库，无权重分发 |
| 你的 `dream-skin.json` 等配置 | 你自己，但**含个人数据** | ❌ 见下 |

配置文件里混着不能外发的东西：

- `dream-skin.json` 里的 `wallpaper` 与 `wallpaper-history` —— **壁纸图片数据与浏览历史**，
  实测可达数百 KB
- `anime-theme/config.json` 里的 `recent` —— 抽到过的壁纸 URL 历史
- `dsh-expression.json` 里的 `memeRoot` —— **本机绝对路径**，换台机器直接失效

**结论：发插件清单 + 参数值。参数是"口味"，文件是"隐私"。**

## 第一步：装插件

以下插件都不属于本项目，请各自从**原始仓库**安装（安装方式以各自 README 为准）：

```bash
dsh plugin --profile <你的 profile> add dsh-dream-skin
dsh plugin --profile <你的 profile> add dsh-ui-boost
dsh plugin --profile <你的 profile> add dsh-meme

# 启动动画：两个里只装一个（都会往 index.html 注入首帧）
dsh plugin --profile <你的 profile> add dsh-custom-splash
# 或（DSH >= 0.2.0-rc.1）：
dsh plugin --profile <你的 profile> add dsh-550c-boot
```

| 插件 | 作用 | 仓库 |
|---|---|---|
| `dsh-dream-skin` | 皮肤、壁纸、面板透明度、材质 | <https://github.com/RevolutionLA/dsh-dream-skin> |
| `dsh-ui-boost` | 主色调着色、Dock | <https://github.com/DoshinJiu/dsh-ui-boost> |
| `dsh-meme` | 表情包图库与 `send_meme` | <https://github.com/yyh-001/dsh-meme> |
| `dsh-anime-theme` | 随机二次元壁纸（可选，本项目配方未启用） | <https://github.com/zxr2115-1/dsh-anime-theme> |
| `dsh-custom-splash` | 启动动画（自己的视频 / 内置 CSS 片头） | <https://github.com/diexianxiang/dsh-custom-splash>（现存 fork） |
| `dsh-550c-boot` | 550C 片头 + UEG 授权界面（与上者二选一） | <https://github.com/yannicksong0106/dsh-550c-boot> |

## 第二步：填参数

### `dsh-dream-skin` —— 粉色基调配方

配置位置：`~/.dsh/dream-skin.json`

```jsonc
{
  "dsh-dream-skin:skin": "rose",            // 皮肤档位
  "dsh-dream-skin:accent": "#f472b6",       // 强调色
  "dsh-dream-skin:material-preset": "liquid", // 材质：液态玻璃
  "dsh-dream-skin:sidebar-opacity": "0.33",   // 侧栏
  "dsh-dream-skin:composer-opacity": "0.69",  // 输入框
  "dsh-dream-skin:modal-opacity": "0.74",     // 弹窗
  "dsh-dream-skin:wallpaper-opacity": "0.61", // 壁纸
  "dsh-dream-skin:wallpaper-follows-skin": "0"
}
```

**请注意**：这些值是"口味参数"，可以安全分享。
但**不要**连 `dsh-dream-skin:wallpaper` 与 `dsh-dream-skin:wallpaper-history` 一起发——
那是壁纸图片数据与历史，属于个人数据。

想微调：

- `accent` 换成别的色值即可改整体色调（`#f472b6` 是粉紫）
- `material-preset` 换成别的材质会改变整体通透感
- 三个 `*-opacity` 越低越通透；低于 `0.3` 可能影响文字可读性

### `dsh-ui-boost` —— 着色

配置位置：`~/.dsh/ui-boost.json`

```jsonc
{
  "dockOn": false,      // 是否显示控制 Dock
  "tintOn": false,      // 是否启用整体着色
  "tintR": 255,         // 着色 RGB
  "tintG": 120,
  "tintB": 255,
  "tintA": 0            // 着色强度（0 = 不生效）
}
```

> ⚠️ **容易误解的地方**：上面这组 RGB 是粉色基调的取值，但配置里
> `tintOn: false` 且 `tintA: 0`，也就是**着色其实是关闭的**。
> 想真正看到效果，需要把 `tintOn` 打开并给 `tintA` 一个非 0 值
> （建议 16–32 起步，拉满会明显偏色）。
>
> 换句话说：**那种粉色观感主要来自壁纸与皮肤插件，不是 `ui-boost` 的着色。**
> 别指望只改这几个数字就能复现整体氛围。

| `tintA` | 效果 |
|---|---|
| `0` | 不着色（默认） |
| `16`–`32` | 轻微偏色，保留可读性 |
| `48`+ | 明显偏色，深色主题下影响对比度 |

### 壁纸

本项目**不附带任何壁纸**——图片版权归各自作者，且体积巨大。

- 用 `dsh-dream-skin` 自己的壁纸功能，选一张你自己喜欢的
- 或用 `dsh-anime-theme` 拉随机图（注意该插件有内容分级开关，自行把握）
- `dsh-dream-skin:wallpaper-follows-skin: "0"` 表示壁纸不跟随皮肤切换；
  想让它跟随就改成 `"1"`

### 品牌、吉祥物、启动动画、桌宠

这几样都是**本机私用插件**，不是可公开分发的包；设置位置和限制各不相同，换机 / 升级
时最容易丢的就是它们：

| 项 | 插件 | 存在哪 | 换端口 / 升级会丢吗 |
|---|---|---|---|
| 品牌字、新会话标题、输入框文案、权限名 | `dsha-brand-rename` | `~/.dsh/dsha-brand-rename.json` 的 `view` 字段（宿主持久化） | **不会**（跟随 `~/.dsh` 备份） |
| 表达风格（六档 + 温度） | **dsh-cyrene 自带**（设置 → 通用 → 表达风格；`/style` 命令同样可用） | `~/.dsh/cyrene-style.json` | **不会** |
| 吉祥物图片 / 大小 / 位置 | `dsha-hero-mascot` | 浏览器 `localStorage`（`dsha-hero-mascot:view`） | **会** —— localStorage 按 origin 隔离，换端口或换包名后要重新上传 |
| 启动动画（视频 / CSS） | `dsh-custom-splash` | `~/.dsh/dsh-custom-splash.json` + `~/.dsh/startup-video/boot.mp4` | **不会**（宿主文件） |
| 启动动画（550C） | `dsh-550c-boot` | 设置页 → 550C；播放模式与曲库存在浏览器 localStorage | 模式/曲库**会**丢；片头本身随插件 |
| 桌宠唤出 | `dsha-pet-button` | `~/.dsh/dsha-pet-button.json` | **不会**；`returnPackage` 在 0.2.x 应为 `dsh.android.client` |

> 0.2.1 升级时吃过一次亏：`dsha-hero-mascot` 的吉祥物图与 `dsha-brand-rename` 的
> 文案都曾只存 localStorage，换 origin 后整份消失。`dsha-brand-rename` 已经改成
> 宿主持久化；吉祥物和 550C 的曲库仍是浏览器存储，迁移时记得重新设一次。

## 分享配方时的检查清单

发之前逐条过一遍：

- [ ] 没有 `wallpaper` / `wallpaper-history` 之类的图片数据
- [ ] 没有 `recent` 之类的浏览历史数组
- [ ] 没有任何 `/root/...`、`/sdcard/...`、`C:\...` 形式的绝对路径
- [ ] 没有 token、cookie、账号信息
- [ ] `dsha-brand-rename` 的 `view` 若一起分享，先确认里面没有你自己的昵称/称呼偏好
- [ ] 没有把 `dsha-hero-mascot:view`（吉祥物图，base64 很大）当配置分享
- [ ] 配方里出现的第三方插件，都指向其**原始仓库**而不是打包副本
- [ ] 表情图库图片没有一起打包（版权归各自作者）

**一句话原则：分享参数，不分享文件。**
