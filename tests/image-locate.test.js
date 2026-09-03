/**
 * image locate tests: locateImageAnchors + `/aux image locate`.
 *
 * Run: node --test tests/image-locate.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageFixture } from './helpers/image-fixture.js';
import {
  handleImageCommand
} from '../dsh-aux/src/commands.js';
import {
  locateImageAnchors
} from '../dsh-aux/src/images/locate.js';

/** Valid-looking 64-char hex hash for a seed. */
function makeHash(seed) {
  const raw = seed.replace(/[^a-f0-9]/gi, '0').slice(0, 64).padEnd(64, '0');
  return raw.toLowerCase();
}

function attachmentIdFor(seed) {
  return 'sha256:' + makeHash(seed);
}

function imagePathFor(attachmentId) {
  const hash = attachmentId.slice('sha256:'.length);
  return `/home/user/dsh/.dsh/attachments/v1/objects/${hash.slice(0, 2)}/${hash}.png`;
}

function userMessageEvent({ seq, id, content = [] }) {
  return {
    type: 'user/message',
    seq,
    time: seq * 1000,
    data: {
      id: id ?? `msg-${seq}`,
      role: 'user',
      source: { kind: 'user' },
      content
    }
  };
}

function imageBlock(attachmentId) {
  return {
    type: 'image',
    attachment: {
      attachmentId,
      mediaType: 'image/png'
    }
  };
}

function visionCallEvent({ seq, callId, arguments: args }) {
  return {
    type: 'tool/call',
    seq,
    time: seq * 1000,
    data: {
      callId,
      name: 'vision_analyze',
      arguments: typeof args === 'string' ? args : JSON.stringify(args),
      turn: 1,
      step: 1
    }
  };
}

/**
 * Minimal service with an in-memory sessionPersistence. The fake persistence
 * `list()`/`listSnapshots()` surfaces are intentionally included so ownership
 * helpers (liveSessionIds/reconcile) also see the sessions when needed.
 */
function makeService({ sessions = {}, currentSession } = {}) {
  const store = new Map();
  store.set('sessions', { list: () => Object.values(sessions).map((s) => ({ id: s.id })) });
  store.set('sessionPersistence', {
    listSnapshots: async () => Object.values(sessions).map((s) => ({ header: { id: s.id } })),
    list: async () => Object.values(sessions).map((s) => ({ id: s.id })),
    inspect: async (sessionId) => {
      const session = sessions[sessionId];
      return session === void 0
        ? { events: [] }
        : { meta: { id: sessionId }, events: session.events ?? [] };
    }
  });
  return {
    ctx: {
      get(key) {
        return store.get(key);
      }
    },
    _sessionImages: new Map(),
    _sessionImagesLoaded: false,
    _sessionImagesDirty: false,
    _sessionImagesWriteQueue: Promise.resolve(),
    ...(currentSession !== void 0 ? { agent: { session: currentSession } } : {})
  };
}

async function withFixture(fn) {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  try {
    return await fn(fixture);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
}

test('locateImageAnchors: returns messageSeq from persisted owner events', async () => {
  await withFixture(async (fixture) => {
    const id = attachmentIdFor('persisted-message');
    await fixture.writeSessionImages({ 'session-a': [id] });
    const service = makeService({
      sessions: {
        'session-a': {
          id: 'session-a',
          events: [
            userMessageEvent({ seq: 10, content: [{ type: 'text', text: 'before' }] }),
            userMessageEvent({ seq: 20, content: [imageBlock(id)] }),
            userMessageEvent({ seq: 30, content: [imageBlock(id), { type: 'text', text: 'again' }] })
          ]
        }
      }
    });

    const result = await locateImageAnchors(service, id);

    assert.equal(result.attachmentId, id);
    assert.equal(result.found, true);
    assert.equal(result.anchors.length, 1);
    assert.equal(result.anchors[0].sessionId, 'session-a');
    assert.equal(result.anchors[0].messageSeq, 30);
    assert.equal(result.anchors[0].callId, null);
    assert.equal(result.anchors[0].callSeq, null);
  });
});

test('locateImageAnchors: vision_analyze attachmentId arguments return callId/callSeq', async () => {
  await withFixture(async (fixture) => {
    const id = attachmentIdFor('vision-attachment');
    await fixture.writeSessionImages({ 'session-a': [id] });
    const service = makeService({
      sessions: {
        'session-a': {
          id: 'session-a',
          events: [
            userMessageEvent({ seq: 10, content: [imageBlock(id)] }),
            visionCallEvent({ seq: 20, callId: 'call_old', arguments: { attachmentId: id, question: 'old?' } }),
            visionCallEvent({ seq: 30, callId: 'call_new', arguments: { attachmentId: id, question: 'new?' } }),
            { type: 'tool/result', seq: 40, data: { message: { source: { kind: 'tool', callId: 'call_new' } } } }
          ]
        }
      }
    });

    const result = await locateImageAnchors(service, id);

    assert.equal(result.found, true);
    assert.equal(result.anchors.length, 1);
    assert.equal(result.anchors[0].messageSeq, 10);
    assert.equal(result.anchors[0].callId, 'call_new');
    assert.equal(result.anchors[0].callSeq, 30);
  });
});

test('locateImageAnchors: matches imagePath and images array hashes', async () => {
  await withFixture(async (fixture) => {
    const id = attachmentIdFor('vision-path');
    await fixture.writeSessionImages({ 'session-a': [id] });
    const service = makeService({
      sessions: {
        'session-a': {
          id: 'session-a',
          events: [
            visionCallEvent({ seq: 11, callId: 'call_path', arguments: { imagePath: imagePathFor(id), question: 'path?' } }),
            visionCallEvent({
              seq: 12,
              callId: 'call_batch',
              arguments: {
                question: 'batch?',
                images: [
                  { imagePath: '/tmp/unrelated/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png' },
                  { attachmentId: id }
                ]
              }
            })
          ]
        }
      }
    });

    const result = await locateImageAnchors(service, id);

    assert.equal(result.found, true);
    assert.equal(result.anchors[0].callId, 'call_batch');
    assert.equal(result.anchors[0].callSeq, 12);
    assert.equal(result.anchors[0].messageSeq, null);
  });
});

test('locateImageAnchors: owner session with unreadable/no-matching events yields empty anchors', async () => {
  await withFixture(async (fixture) => {
    const id = attachmentIdFor('no-events');
    await fixture.writeSessionImages({
      'session-a': [id],
      'session-b': [id],
      'session-c': [id]
    });
    const service = makeService({
      sessions: {
        'session-a': {
          id: 'session-a',
          events: [
            userMessageEvent({ seq: 1, content: [{ type: 'text', text: 'no image here' }] }),
            visionCallEvent({ seq: 2, callId: 'call_other', arguments: { attachmentId: attachmentIdFor('other'), question: '?' } })
          ]
        },
        'session-b': { id: 'session-b', events: [] },
        // session-c is absent from persistence => inspect returns empty (unreadable-like)
      }
    });

    const result = await locateImageAnchors(service, id);

    assert.equal(result.attachmentId, id);
    assert.equal(result.found, false);
    assert.deepEqual(result.anchors, []);
  });
});

test('locateImageAnchors: --session filter restricts lookup', async () => {
  await withFixture(async (fixture) => {
    const id = attachmentIdFor('filtered');
    await fixture.writeSessionImages({
      'session-a': [id],
      'session-b': [id]
    });
    const service = makeService({
      sessions: {
        'session-a': { id: 'session-a', events: [userMessageEvent({ seq: 5, content: [imageBlock(id)] })] },
        'session-b': { id: 'session-b', events: [userMessageEvent({ seq: 8, content: [imageBlock(id)] })] }
      }
    });

    const result = await locateImageAnchors(service, id, { sessionId: 'session-a' });

    assert.equal(result.found, true);
    assert.equal(result.anchors.length, 1);
    assert.equal(result.anchors[0].sessionId, 'session-a');
    assert.equal(result.anchors[0].messageSeq, 5);

    const miss = await locateImageAnchors(service, id, { sessionId: 'session-zzz' });
    assert.equal(miss.found, false);
    assert.deepEqual(miss.anchors, []);
  });
});

test('handleImageCommand: locate --json returns success + locate JSON', async () => {
  await withFixture(async (fixture) => {
    const id = attachmentIdFor('command-json');
    await fixture.writeSessionImages({ 'session-a': [id] });
    const service = makeService({
      sessions: {
        'session-a': {
          id: 'session-a',
          events: [
            userMessageEvent({ seq: 4, content: [imageBlock(id)] }),
            visionCallEvent({ seq: 9, callId: 'call_cmd', arguments: { attachmentId: id, question: 'what?' } })
          ]
        }
      }
    });

    const result = await handleImageCommand(service, ['locate', id, '--json']);

    assert.equal(result.kind, 'success');
    const data = JSON.parse(result.text);
    assert.equal(data.attachmentId, id);
    assert.equal(data.found, true);
    assert.equal(data.anchors.length, 1);
    assert.equal(data.anchors[0].messageSeq, 4);
    assert.equal(data.anchors[0].callId, 'call_cmd');
    assert.equal(data.anchors[0].callSeq, 9);
  });
});

test('handleImageCommand: locate human text and not-found error', async () => {
  await withFixture(async (fixture) => {
    const id = attachmentIdFor('command-human');
    await fixture.writeSessionImages({ 'session-a': [id] });
    const service = makeService({
      sessions: {
        'session-a': { id: 'session-a', events: [userMessageEvent({ seq: 3, content: [imageBlock(id)] })] }
      }
    });

    const hit = await handleImageCommand(service, ['locate', id]);
    assert.equal(hit.kind, 'success');
    assert.match(hit.text, /图片定位: sha256:/);
    assert.match(hit.text, /session-a/);
    assert.match(hit.text, /消息 seq 3/);

    const miss = await handleImageCommand(service, ['locate', attachmentIdFor('missing-command')]);
    assert.equal(miss.kind, 'error');
    assert.match(miss.text, /NOT_FOUND/);
    assert.match(miss.text, /未找到图片/);
  });
});

test('locateImageAnchors: liveSession events are used without persistence inspect', async () => {
  await withFixture(async (fixture) => {
    const id = attachmentIdFor('live-session');
    await fixture.writeSessionImages({ 'session-current': [id] });
    const liveSession = {
      id: 'session-current',
      events: [
        userMessageEvent({ seq: 12, content: [imageBlock(id)] }),
        visionCallEvent({ seq: 18, callId: 'call_live', arguments: { attachmentId: id, question: 'live?' } })
      ]
    };
    // No sessionPersistence in ctx at all; the locate must read live events.
    const service = {
      ctx: { get: () => void 0 },
      _sessionImages: new Map(),
      _sessionImagesLoaded: false,
      _sessionImagesDirty: false,
      _sessionImagesWriteQueue: Promise.resolve()
    };

    const result = await locateImageAnchors(service, id, { liveSession });

    assert.equal(result.found, true);
    assert.equal(result.anchors[0].sessionId, 'session-current');
    assert.equal(result.anchors[0].messageSeq, 12);
    assert.equal(result.anchors[0].callId, 'call_live');
    assert.equal(result.anchors[0].callSeq, 18);
  });
});
