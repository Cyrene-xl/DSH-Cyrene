/**
 * 手动更新检查：版本比较与 `?meta=1`（不联网）的行为。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareSemver, handleUpdateApi, version } from '../index.js';

test('版本比较：数字段逐位比较，忽略 v 前缀与预发布后缀', () => {
  assert.equal(compareSemver('v0.7.6', '0.7.5'), 1);
  assert.equal(compareSemver('0.7.5', 'v0.7.6'), -1);
  assert.equal(compareSemver('0.7.5', '0.7.5'), 0);
  assert.equal(compareSemver('v0.8.0-rc.1', '0.7.9'), 1);
  assert.equal(compareSemver('1.0.0', '0.99.99'), 1);
  assert.equal(compareSemver('', '0.0.1'), -1);
});

test('更新接口：?meta=1 只回本地版本，不联网', async () => {
  let body = '';
  const res = {
    writeHead() {},
    end(text) { body = String(text); }
  };
  await handleUpdateApi({ url: '/cyrene-update-api?meta=1', method: 'GET' }, res);
  const data = JSON.parse(body);
  assert.equal(data.ok, true);
  assert.equal(data.current, version);
  assert.equal(data.latest, undefined, 'meta 不应触发 GitHub 查询');
});
