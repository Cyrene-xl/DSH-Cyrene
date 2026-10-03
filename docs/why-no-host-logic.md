# dsh-cyrene-chat — 宿主半体

## 这个插件几乎没有宿主逻辑，这是故意的

真正起作用的东西是 `preset/` 目录里的那份 agent 预设：它通过
`dsh-agent-instructions` / `dsh-persona` 的 `complete: true` 装配路径，
**整份替换系统提示词**，从而达到"纯角色对话、不叠加编码代理身份"的效果。

因此本插件**不注册任何工具、不改任何运行时行为**。宿主半体的存在意义只有两个：

1. **作为 profile bundle 的锚点** —— `dsh plugin --profile <name> add dsh-cyrene-chat`
   需要一个可加载的包，`cordis.patch.yml` 由 loader 读取。
2. **保留升级与排障的挂载点** —— 后续若 DSH 开放预设安装 API，
   可以在这里补上；现在写死逻辑只会增加装崩的风险。

`inject = []`：不依赖任何宿主服务，缺少可选服务时也能加载。

## 预设的安装不在这里

DSH **没有公开的"安装预设"API**（`dsh-agent-presets` 只按
`~/.dsh/.agent-presets/<id>/` 目录扫描发现，不对外暴露写入接口）。
所以预设由 `scripts/install.*` 拷贝，而不是由本插件在运行时写入 ——
插件启动时去写 DSH 主目录属于越界行为，本项目不做。
