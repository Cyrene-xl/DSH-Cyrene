/** Windows 没有 HOME：dshHome() 也必须返回绝对路径。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolute, join } from 'node:path';
import { dshHome } from '../paths.js';

test('HOME 未设置时用 USERPROFILE 兜底', () => {
  const home = dshHome({ USERPROFILE: 'C:\\Users\\someone' });
  assert.ok(isAbsolute(home), home);
  assert.equal(home.endsWith('.dsh'), true);
});

test('HOME / USERPROFILE 都没有时用 os.homedir()', () => {
  const home = dshHome({});
  assert.ok(isAbsolute(home), home);
  assert.equal(home.endsWith('.dsh'), true);
});

test('相对 DSH_HOME 会被 resolve 成绝对路径', () => {
  const home = dshHome({ DSH_HOME: '.dsh' });
  assert.ok(isAbsolute(home), home);
  assert.notEqual(home, join('.dsh'));
});

test('绝对 DSH_HOME 原样返回', () => {
  assert.equal(dshHome({ DSH_HOME: '/tmp/x' }), '/tmp/x');
});
