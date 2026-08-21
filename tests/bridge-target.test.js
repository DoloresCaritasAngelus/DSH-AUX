/**
 * bridge/target.js path-safety tests.
 *
 * Run: node --test tests/bridge-target.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeTarget, isRc7OrNewer } from '../bridge/target.js';

test('assertSafeTarget: 接受合法的 node_modules/@deepseek-ai/lib/index.js 路径', () => {
  const ok = '/home/user/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js';
  assert.equal(assertSafeTarget(ok), ok);
});

test('assertSafeTarget: 拒绝 node_modules 之外的目标', () => {
  assert.throws(() => assertSafeTarget('/tmp/evil/lib/index.js'), /not inside node_modules\/@deepseek-ai/);
  assert.throws(() => assertSafeTarget('/home/user/dsh/lib/index.js'), /not inside node_modules\/@deepseek-ai/);
});

test('assertSafeTarget: 拒绝非 @deepseek-ai 作用域', () => {
  assert.throws(
    () => assertSafeTarget('/home/user/dsh/node_modules/@other/lib/index.js'),
    /not inside node_modules\/@deepseek-ai/
  );
});

test('assertSafeTarget: 拒绝非 lib/index.js 路径', () => {
  assert.throws(
    () => assertSafeTarget('/home/user/dsh/node_modules/@deepseek-ai/dsh-session/src/index.js'),
    /expected .*\/lib\/index\.js/
  );
});

test('isRc7OrNewer: rc.6 为 false,rc.7/rc.8/0.1.1-rc.1 为 true', () => {
  assert.equal(isRc7OrNewer('0.1.0-rc.6'), false);
  assert.equal(isRc7OrNewer('0.1.0-rc.7'), true);
  assert.equal(isRc7OrNewer('0.1.0-rc.8'), true);
  assert.equal(isRc7OrNewer('0.1.1-rc.1'), true);
  assert.equal(isRc7OrNewer('0.1.1'), true);
  assert.equal(isRc7OrNewer('0.1.2-rc.1'), true);
  // 0.1.0 稳定版晚于 rc.6,按语义视为新线。
  assert.equal(isRc7OrNewer('0.1.0'), true);
  assert.equal(isRc7OrNewer(undefined), false);
});
