/**
 * lifecycle-durability 测试:session-images / image-memory 的损坏恢复、
 * 空条目清理与加载重试。
 *
 * 覆盖:
 *  - D1: session-images 主文件损坏 → 从 .bak 恢复,且不静默覆盖
 *  - D2: 主 + 备份都损坏 → 隔离损坏文件(保留证据),不直接丢进虚空
 *  - D3: image-memory 损坏 → 隔离后继续追加,新记录落盘
 *  - D4: cleanup 移除空 session 条目(不再残留)
 *  - D5: ensureSessionImagesLoaded 读取失败不置 loaded,可重试
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import {
  sessionImagesPath,
  sessionImagesBackupPath,
  loadSessionImages,
  saveSessionImages,
  cleanupSessionImages,
  ensureSessionImagesLoaded
} from '../dsh-aux/src/images/ownership.js';
import { recordImageMemory, imageMemoryPath } from '../dsh-aux/src/images/memory.js';

function makeService() {
  return {
    _sessionImages: new Map(),
    _sessionImagesDirty: false,
    _sessionImagesLoaded: false,
    _sessionImagesWriteQueue: undefined
  };
}

async function makeTmp(prefix) {
  const dir = `/tmp/${prefix}-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await fsPromises.mkdir(dir + '/attachments/v1', { recursive: true });
  return dir;
}

function sha(n) { return 'sha256:' + n.repeat(64).slice(0, 64); }

test('D1: session-images 主文件损坏 → 从 .bak 恢复,保存不丢数据', async () => {
  const tmp = await makeTmp('aux-d1');
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const main = sessionImagesPath();
    const bak = sessionImagesBackupPath();
    const good = JSON.stringify({
      'sess-1': [sha('a')],
      'sess-2': [sha('b')]
    });
    await fsPromises.writeFile(main, good);
    await fsPromises.writeFile(bak, good);
    // 主文件损坏(模拟磁盘满 / kill -9 写坏)
    await fsPromises.writeFile(main, '{"sess-1":["broken');

    const map = await loadSessionImages();
    assert.equal(map.size, 2, '损坏主文件时应回退到 .bak');
    assert.ok(map.get('sess-1').has(sha('a')));

    const svc = makeService();
    await ensureSessionImagesLoaded(svc);
    await saveSessionImages(svc);

    const after = JSON.parse(await fsPromises.readFile(main, 'utf8'));
    assert.ok(Array.isArray(after['sess-1']) && after['sess-1'][0] === sha('a'), '保存后旧数据不得丢失');
    assert.ok(Array.isArray(after['sess-2']) && after['sess-2'][0] === sha('b'));

    const files = await fsPromises.readdir(tmp + '/attachments/v1');
    assert.ok(files.some((f) => f.startsWith('session-images.json.corrupt-')), '损坏的主文件应被隔离保留: ' + files.join(','));
  } finally {
    process.env.DSH_HOME = prev;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('D2: 主 + 备份都损坏 → 两者都被隔离,不再静默丢进虚空', async () => {
  const tmp = await makeTmp('aux-d2');
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    await fsPromises.writeFile(sessionImagesPath(), '{bad-main');
    await fsPromises.writeFile(sessionImagesBackupPath(), '{bad-bak');

    const map = await loadSessionImages();
    assert.equal(map.size, 0);

    const svc = makeService();
    await saveSessionImages(svc);
    const after = JSON.parse(await fsPromises.readFile(sessionImagesPath(), 'utf8'));
    assert.deepEqual(after, {});

    const files = await fsPromises.readdir(tmp + '/attachments/v1');
    assert.ok(files.some((f) => f.startsWith('session-images.json.corrupt-')), '主损坏文件应隔离');
    assert.ok(files.some((f) => f.startsWith('session-images.json.bak.corrupt-')), '备份损坏文件应隔离');
  } finally {
    process.env.DSH_HOME = prev;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('D3: image-memory 损坏 → 隔离后继续追加,新记录落盘', async () => {
  const tmp = await makeTmp('aux-d3');
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    await fsPromises.writeFile(imageMemoryPath(), '{"entries":[');
    const svc = { _memoryQueue: Promise.resolve() };
    await recordImageMemory(svc, 'sess-3', sha('c'), '问题', '摘要');
    const parsed = JSON.parse(await fsPromises.readFile(imageMemoryPath(), 'utf8'));
    assert.equal(parsed.entries.length, 1, '损坏后应能继续追加新记录');
    assert.equal(parsed.entries[0].sessionId, 'sess-3');

    const files = await fsPromises.readdir(tmp + '/attachments/v1');
    assert.ok(files.some((f) => f.startsWith('image-memory.json.corrupt-')), '损坏 journal 应被隔离');
  } finally {
    process.env.DSH_HOME = prev;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('D4: cleanup 移除空 session 条目,不再残留', async () => {
  const tmp = await makeTmp('aux-d4');
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    await fsPromises.writeFile(sessionImagesPath(), JSON.stringify({
      'sess-empty': [],
      'sess-keep': [sha('c')]
    }));
    const svc = makeService();
    await cleanupSessionImages(svc, 'sess-empty');
    const map = JSON.parse(await fsPromises.readFile(sessionImagesPath(), 'utf8'));
    assert.equal(map['sess-empty'], void 0, '空 session 条目应被移除');
    assert.ok(Array.isArray(map['sess-keep']), '其他条目应保留');
  } finally {
    process.env.DSH_HOME = prev;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('D5: ensureSessionImagesLoaded 读取失败不置 loaded,可重试', async () => {
  const tmp = await makeTmp('aux-d5');
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const main = sessionImagesPath();
    // 让主文件是一个目录 → readFile 抛非 ENOENT 错误(如 EISDIR)
    await fsPromises.mkdir(main, { recursive: true });
    const svc = makeService();
    let threw = false;
    try {
      await ensureSessionImagesLoaded(svc);
    } catch {
      threw = true;
    }
    assert.equal(threw, true, '瞬时读取失败应抛出而不是静默吞掉');
    assert.equal(svc._sessionImagesLoaded, false, '失败时不得标记 loaded');

    // 修复后重试应成功
    await fsPromises.rm(main, { recursive: true, force: true });
    await fsPromises.writeFile(main, JSON.stringify({ 'sess-1': [sha('d')] }));
    await ensureSessionImagesLoaded(svc);
    assert.equal(svc._sessionImagesLoaded, true);
    assert.ok(svc._sessionImages.has('sess-1'));
  } finally {
    process.env.DSH_HOME = prev;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('D6: 两个会话共享一张图,先后删除后文件可回收、无残留 owner', async () => {
  const tmp = await makeTmp('aux-d6');
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const hash = 'ab' + 'a'.repeat(62);
    await fsPromises.mkdir(tmp + '/attachments/v1/objects/ab', { recursive: true });
    await fsPromises.writeFile(tmp + '/attachments/v1/objects/ab/' + hash, 'X');
    const x = 'sha256:' + hash;
    await fsPromises.writeFile(sessionImagesPath(), JSON.stringify({ 'sess-A': [x], 'sess-B': [x] }));
    const svc = makeService();
    await cleanupSessionImages(svc, 'sess-A');
    await cleanupSessionImages(svc, 'sess-B');
    const files = await fsPromises.readdir(tmp + '/attachments/v1/objects/ab');
    const map = JSON.parse(await fsPromises.readFile(sessionImagesPath(), 'utf8'));
    assert.ok(!files.includes(hash), '共享图片在两个会话都删除后应被回收,实际: ' + files.join(','));
    assert.deepEqual(Object.keys(map), [], 'map 不应残留已删除的 owner');
  } finally {
    process.env.DSH_HOME = prev;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('D7: 共享图片只删除一个会话 → 文件保留,已删会话的 owner 移除', async () => {
  const tmp = await makeTmp('aux-d7');
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const hash = 'ab' + 'b'.repeat(62);
    await fsPromises.mkdir(tmp + '/attachments/v1/objects/ab', { recursive: true });
    await fsPromises.writeFile(tmp + '/attachments/v1/objects/ab/' + hash, 'X');
    const x = 'sha256:' + hash;
    await fsPromises.writeFile(sessionImagesPath(), JSON.stringify({ 'sess-A': [x], 'sess-B': [x] }));
    const svc = makeService();
    await cleanupSessionImages(svc, 'sess-A');
    const files = await fsPromises.readdir(tmp + '/attachments/v1/objects/ab');
    const map = JSON.parse(await fsPromises.readFile(sessionImagesPath(), 'utf8'));
    assert.ok(files.includes(hash), '另一会话仍引用时不得删除文件');
    assert.equal(map['sess-A'], void 0, '已删会话的 owner 应移除');
    assert.ok(Array.isArray(map['sess-B']), '存留会话的 owner 应保留');
  } finally {
    process.env.DSH_HOME = prev;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});
