/**
 * dsh-cyrene-chat 宿主半体
 *
 * 本文件刻意不做任何运行时改动：它的价值全在 preset/ 目录里的 agent 预设。
 * 本文件的作用只是给 profile bundle 提供一个可加载的包锚点。
 *
 * 真正会注册东西的宿主逻辑在 memory.js 与 nickname.js —— 两者都由**预设**挂载
 * （预设正文引用了 {{user_nickname}} 和 {{cyrene_memory}}，不注册就会在装配期抛错），
 * 因此只作用于该预设的会话，不污染其它模式。
 * 详见 docs/host-side.md。
 */

/** 插件 id（与 package.json 的 dsh.id、cordis.patch.yml 的条目 id 保持一致）。 */
export const name = 'dsh-cyrene-chat';

/** 与 package.json 保持一致的版本号（健康检查用）。 */
export const version = '0.2.2';

/**
 * 不注入任何宿主服务。
 * 缺少可选服务时插件仍应正常加载——本文件不依赖它们。
 */
export const inject = [];

/**
 * 插件加载钩子。
 *
 * 只记录一行日志，便于用户确认插件已被 loader 读到。
 * 本文件不做任何文件写入、不注册工具、不改动系统提示词——
 * 预设的生效完全由 DSH 自身对 ~/.dsh/.agent-presets/ 的发现机制负责。
 */
export function apply(ctx) {
  ctx?.logger?.info?.(
    '[dsh-cyrene-chat] 已加载。若尚未安装预设，请运行 scripts/install.sh（或 install.ps1 / install.bat）：' +
      'DSH 没有公开的预设安装 API，预设必须落到 ~/.dsh/.agent-presets/chat/ 才会被发现。'
  );
}
