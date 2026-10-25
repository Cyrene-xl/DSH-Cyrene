/**
 * `/cyrene-style-api`：档位读取与三种写入意图。
 * 用临时 DSH_HOME 动态导入，避免动到真实 `~/.dsh`。
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'cyrene-style-api-'));
process.env.DSH_HOME = home;

let api;
before(async () => {
  api = await import('../index.js');
});

/** 造一个最小的 req/res，返回响应体。 */
async function call(method, path, body) {
  let text = '';
  const res = {
    writeHead() {},
    end(chunk) { text += String(chunk); }
  };
  const req = { method, url: path };
  if (body === undefined) {
    await api.handleStyleApi(req, res);
  } else {
    /* handler 通过 req.on/data/end 读 body。 */
    const chunks = [Buffer.from(JSON.stringify(body))];
    req.on = (event, fn) => {
      if (event === 'data') chunks.forEach(fn);
      if (event === 'end') fn();
      return req;
    };
    await api.handleStyleApi(req, res);
  }
  return JSON.parse(text);
}

test('GET：默认档与六个档位', async () => {
  const data = await call('GET', '/cyrene-style-api');
  assert.equal(data.ok, true);
  assert.equal(data.style, 'default');
  assert.equal(data.default, 'default');
  assert.equal(data.styles.length, 6);
  assert.ok(data.styles.some((s) => s.id === 'sweet'));
});

test('POST：改全局默认档并落盘', async () => {
  const data = await call('POST', '/cyrene-style-api', { defaultStyle: 'healing' });
  assert.equal(data.ok, true);
  assert.equal(data.default, 'healing');
  const file = join(home, 'cyrene-style.json');
  assert.ok(existsSync(file));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).default, 'healing');
});

test('POST：写会话档位，GET 能读回来', async () => {
  const write = await call('POST', '/cyrene-style-api', { session: 'session-x', style: 'sweet' });
  assert.equal(write.ok, true);
  const read = await call('GET', '/cyrene-style-api?session=session-x');
  assert.equal(read.style, 'sweet');
  const file = JSON.parse(readFileSync(join(home, 'cyrene-style.json'), 'utf8'));
  assert.equal(file.sessions['session-x'].style, 'sweet');
});

test('POST：customTier 只改强度，不影响档位', async () => {
  await call('POST', '/cyrene-style-api', { session: 'session-x', style: 'sweet' });
  const data = await call('POST', '/cyrene-style-api', { customTier: 2 });
  assert.equal(data.ok, true);
  assert.equal(data.customTier, 2);
  const read = await call('GET', '/cyrene-style-api?session=session-x');
  assert.equal(read.style, 'sweet');
  assert.equal(read.customTier, 2);
});

test('POST：未知档位被拒', async () => {
  const data = await call('POST', '/cyrene-style-api', { session: 'session-x', style: 'nope' });
  assert.equal(data.ok, false);
  assert.match(data.error, /没有这个风格/);
});
