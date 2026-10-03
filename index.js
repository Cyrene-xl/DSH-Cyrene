/**
 * dsh-cyrene-chat 宿主半体
 *
 * 本插件刻意不做任何运行时改动：它的价值全在 preset/ 目录里的 agent 预设。
 * 宿主半体的作用只是给 profile bundle 提供一个可加载的包锚点。
 * 详见 docs/why-no-host-logic.md。
 */

/** 插件 id（与 package.json 的 dsh.id、cordis.patch.yml 的条目 id 保持一致）。 */
export const name = 'dsh-cyrene-chat';

/** 与 package.json 保持一致的版本号（健康检查用）。 */
export const version = '0.1.0';

/**
 * 不注入任何宿主服务。
 * 缺少可选服务时插件仍应正常加载——本插件不依赖它们。
 */
export const inject = [];

/**
 * 插件加载钩子。
 *
 * 只记录一行日志，便于用户确认插件已被 loader 读到。
 * 不做任何文件写入、不注册工具、不改动系统提示词——
 * 预设的生效完全由 DSH 自身对 ~/.dsh/.agent-presets/ 的发现机制负责。
 */
export function apply(ctx) {
  ctx?.logger?.info?.(
    '[dsh-cyrene-chat] 已加载。若尚未安装预设，请运行 scripts/install.sh（或 install.ps1 / install.bat）：' +
      'DSH 没有公开的预设安装 API，预设必须落到 ~/.dsh/.agent-presets/chat/ 才会被发现。'
  );
}
