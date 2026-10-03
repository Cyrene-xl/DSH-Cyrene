# 主题配方：把自己的观感搬给别人

界面美化不是本插件的功能，而是若干**第三方主题插件**的组合结果。这份文档说明两件事：

1. 哪些配置值可以安全地分享给别人；
2. 哪些**绝对不能**分享。

## 为什么不能直接分享配置文件

`~/.dsh/` 下这些主题相关的配置**都带个人数据**，直接发给别人既泄露隐私、又在对方机器上失效：

| 文件 | 为什么不能发 |
|---|---|
| `dream-skin.json` | 含**壁纸图片数据与历史记录**（实测可达数百 KB），是纯个人内容 |
| `anime-theme/config.json` | `recent` 数组是你抽到过的壁纸 URL 历史；且含 `allowNsfw` 这类不适合公开的开关 |
| `dsh-expression.json` | 含**本机绝对路径**（如 `~/.dsh/meme-packs/...` 的具体展开值），换台机器直接失效 |
| `dsha-brand-rename.json` | 属于 DSHA 内置插件，不是独立可分发物 |

**通用原则：分享"参数"，不分享"文件"。**

---

## 可以分享的：`dsh-ui-boost` 着色参数

`dsh-ui-boost` 的配置是纯数值，不掺个人数据，适合作为配方分享。

配置位置：`~/.dsh/ui-boost.json`（由插件自行创建/读取）

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

### 配方：粉色基调

```jsonc
{
  "tintOn": true,
  "tintR": 255,
  "tintG": 120,
  "tintB": 255,
  "tintA": 24
}
```

> ⚠️ **说明一个容易误解的地方**：上面这组 RGB 是一位使用者的配置值，
> 但那份配置里 `tintOn: false` 且 `tintA: 0`，也就是**着色其实是关闭的**。
> 想真正看到效果，需要把 `tintOn` 打开、并给 `tintA` 一个非 0 的强度值
> （建议从 16–32 开始试，A 拉满会明显偏色）。
>
> 换句话说：截图里那种粉色观感**主要来自壁纸与皮肤插件**，不是 `ui-boost` 的着色。
> 别指望只改这几个数字就能复现整体氛围。

`tintA` 的取值建议：

| `tintA` | 效果 |
|---|---|
| `0` | 不着色（默认） |
| `16`–`32` | 轻微偏色，保留原界面可读性 |
| `48`+ | 明显偏色，深色主题下容易影响对比度 |

---

## 可以分享的：`dsh-dream-skin` 的非个人档位

`dsh-dream-skin` 把设置存在 `dream-skin.json`，但其中只有一部分是"口味参数"，
另一部分是壁纸数据。**要分享时只抄参数键，绝不带 `wallpaper` / `wallpaper-history`。**

可以安全分享的参数键（示例结构，值请按自己的观感填）：

```jsonc
{
  "dsh-dream-skin:skin": "…",              // 皮肤档位
  "dsh-dream-skin:accent": "#……",          // 强调色
  "dsh-dream-skin:material-preset": "…",   // 材质预设
  "dsh-dream-skin:wallpaper-opacity": "…", // 壁纸不透明度
  "dsh-dream-skin:sidebar-opacity": "…",   // 侧栏不透明度
  "dsh-dream-skin:composer-opacity": "…",  // 输入框不透明度
  "dsh-dream-skin:modal-opacity": "…"      // 弹窗不透明度
}
```

**务必排除**这两个键——它们是个人数据：

```
dsh-dream-skin:wallpaper            ← 壁纸图片数据
dsh-dream-skin:wallpaper-history    ← 壁纸历史
```

正确做法是从自己机器上读出这几个参数值，填进上面的模板再分享；
不要直接复制整个 `dream-skin.json`。

---

## 分享配方时的检查清单

- [ ] 没有 `wallpaper` / `wallpaper-history` 之类的图片数据
- [ ] 没有 `recent` 之类的浏览历史数组
- [ ] 没有任何 `/root/...`、`/sdcard/...`、`C:\...` 形式的绝对路径
- [ ] 没有 token、cookie、账号信息
- [ ] 配方里出现的第三方插件，都指向其**原始仓库**而不是打包副本

主题插件都是别人的作品，请引导使用者去原仓库安装，不要打包再分发。
