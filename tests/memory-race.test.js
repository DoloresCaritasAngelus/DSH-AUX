import test from 'node:test';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import AuxLlmService from '../dsh-aux/src/index.js';

function settle() { return new Promise((resolve) => setImmediate(resolve)); }

async function makeHarness() {
  const ctx = new Context();
  await ctx.plugin({
    name: 'stubs',
    apply(stubCtx) {
      stubCtx.provide('tools', { register() { return () => {}; } });
      stubCtx.provide('settings', {});
      stubCtx.provide('systemPrompt', { section() { return () => {}; } });
      stubCtx.provide('web', { async fetch() { throw new Error('no'); } });
      stubCtx.provide('llm', { async resolveModelInfo() { return { inputModalities: [] }; }, stream() { throw new Error('no'); } });
      stubCtx.provide('fs', { async resolve(p) { return { displayPath: p }; }, async stat() { return { type: 'file' }; }, async readBytes() { return new Uint8Array(0); } });
      stubCtx.provide('attachments', { imageLimits: { maxImageBytes: 1000, maxMessageImageBytes: 1000, maxImagesPerMessage: 1, maxImagePixels: 1000, mediaTypes: ['image/png'] }, async validateImage() {}, async saveImage(i) { return { attachmentId: 'a', mediaType: i.mediaType, bytes: 0, width: 1, height: 1 }; }, async readImage(r) { return { ref: r, data: new Uint8Array(0) }; } });
    }
  });
  const fiber = ctx.plugin(AuxLlmService, {});
  await fiber;
  await settle();
  return { ctx };
}

test('image-memory 并发写不丢条目(多图并行场景)', async () => {
  const tmp = '/tmp/aux-mem-race-' + process.pid;
  await fsPromises.mkdir(tmp + '/attachments/v1', { recursive: true });
  const { ctx } = await makeHarness();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const N = 5;
    await Promise.all(Array.from({ length: N }, (_, i) =>
      ctx.auxLlm._recordImageMemory('sess', 'sha256:' + ('0' + i).repeat(64).slice(0, 64), 'q' + i, 's' + i)
    ));
    // 等全部落盘
    await new Promise((r) => setTimeout(r, 200));
    const raw = await fsPromises.readFile(tmp + '/attachments/v1/image-memory.json', 'utf8');
    const parsed = JSON.parse(raw);
    console.log('最终条目数:', parsed.entries.length, '(期望 5)');
    assert.equal(parsed.entries.length, N, '并发写不应丢条目,实际 ' + parsed.entries.length);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});
