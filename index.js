/**
 * dsh-cyrene 宿主半体
 *
 * 本文件刻意不做任何运行时改动：它的价值全在 preset/ 目录里的 agent 预设。
 * 本文件的作用只是给 profile bundle 提供一个可加载的包锚点。
 *
 * 真正会注册东西的宿主逻辑由**预设**挂载：memory.js（记忆变量 + 工具）、
 * nickname.js（称呼变量）、worldbook/（世界书注入）。它们只作用于该预设的会话，
 * 不污染其它模式。详见 docs/host-side.md。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 插件 id（与 package.json 的 dsh.id、cordis.patch.yml 的条目 id 保持一致）。 */
export const name = 'dsh-cyrene';

/**
 * 版本号：**从 package.json 读**，不再手写一份。
 *
 * 早先这里是硬编码的字符串，于是版本散在四处（package.json 两处、plugin.json、
 * dsh.plugin.json、这里），改一次要同步五遍 —— README 甚至为此专门写了"改名要同步哪几处"
 * 的提醒。读出来就没有可不同步的机会了。
 *
 * 读不到就退回 '0.0.0'：版本号只用于健康检查与日志，不该让插件加载失败。
 */
export const version = (() => {
  try {
    const file = fileURLToPath(new URL('./package.json', import.meta.url));
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed?.version === 'string' && parsed.version !== '' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

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
    '[dsh-cyrene] 已加载。若尚未安装预设，请运行 scripts/install.sh（或 install.ps1 / install.bat）：' +
      'DSH 没有公开的预设安装 API，预设必须落到 ~/.dsh/.agent-presets/chat/ 才会被发现。'
  );
}
