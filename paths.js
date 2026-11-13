/**
 * dsh-cyrene / paths.js —— 统一的 DSH_HOME 解析。
 *
 * 为什么单独抽出来：Windows 没有 `HOME`（只有 `USERPROFILE`），而旧代码用
 * `process.env.HOME || '.'` 兜底；宿主进程里两个环境变量都为空时会拼出**相对路径**
 * `.dsh`，由进程按 cwd 解析，写入失败还会被各模块的 `catch { return false }` 吞掉。
 * 表现就是「设置保存了、下次启动又回去了」。
 *
 * 规则：
 * 1. `DSH_HOME` 优先；相对值也要 `resolve` 成绝对路径；
 * 2. 否则 `HOME` → `USERPROFILE` → `os.homedir()`；
 * 3. 最后拼 `.dsh`，并再 `resolve` 一次，保证返回值一定是绝对路径。
 */
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * @param {NodeJS.ProcessEnv} [env] - 可注入的环境变量（测试用）。
 * @returns {string} 绝对形式的 DSH_HOME。
 */
export function dshHome(env = process.env) {
  const fromEnv = String(env.DSH_HOME ?? '').trim()
  if (fromEnv !== '') return isAbsolute(fromEnv) ? fromEnv : resolve(fromEnv)
  const home = String(env.HOME ?? '').trim() || String(env.USERPROFILE ?? '').trim() || homedir()
  return resolve(join(home, '.dsh'))
}
