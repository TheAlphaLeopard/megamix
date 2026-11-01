const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const loader = fs.readFileSync(path.join(root, 'dataloader.js'), 'utf8');
const realWasm = fs.readFileSync(path.join(root, 'RSDKv5U.wasm'));
const SCENE = 8878812;
const FOLDER = 12957088;
const GLOBAL_POINTER = 21563912;
const SCENE_POINTER = 21562544;
const GLOBALS = 26828184;
const CATEGORIES = 30000000;
const SCENES = 30010000;

function realArchiveFS(options = {}) {
  return {
    stat() { return { size: options.wrongSize ? 1 : 247953543 }; },
    open() { return {}; },
    close() {},
    read(_stream, target, targetOffset, length, position) {
      const part = Math.floor(position / 18000000);
      const fd = fs.openSync(path.join(root, 'chunks', `RSDKv5U.data.p${String(part).padStart(3, '0')}`), 'r');
      try {
        const count = fs.readSync(fd, target, targetOffset, length, position % 18000000);
        if (options.corruptData && position === 126904929) target[0] ^= 0xff;
        return options.shortRead && position === 126904929 ? count - 1 : count;
      } finally {
        fs.closeSync(fd);
      }
    },
  };
}

async function harness(options = {}) {
  const timers = [];
  const calls = [];
  const module = options.module || {};
  const window = {
    location: { href: 'https://example.test/', search: options.search || '' },
    Module: module,
    addEventListener() {},
    crypto: options.noCrypto ? undefined : webcrypto,
  };
  const document = {
    getElementById() { return null; },
    body: { classList: { add() {} } },
  };
  const fetch = async (url, request = {}) => {
    calls.push(`${request.method || 'GET'} ${url}`);
    if (url === 'RSDKv5U.wasm') {
      const body = Uint8Array.from(realWasm);
      if (options.corruptWasm) body[0] ^= 0xff;
      return { ok: true, async arrayBuffer() { return body.buffer; } };
    }
    if (url === 'RSDKv5U.data') return { ok: true, status: 200 };
    if (url === 'https://example.test/override') {
      const body = Uint8Array.of(1, 2, 3);
      return {
        ok: true, status: 200,
        headers: { get() { return String(body.length); } },
        body: null,
        async arrayBuffer() { return body.buffer; },
      };
    }
    return { ok: false, status: 404 };
  };
  const messages = [];
  vm.runInNewContext(loader, {
    window, document, fetch, URLSearchParams,
    console: {
      log: (...args) => messages.push(args.join(' ')),
      warn: (...args) => messages.push(args.join(' ')),
      error: (...args) => messages.push(args.join(' ')),
    },
    setInterval: (callback, milliseconds) => timers.push({ callback, milliseconds }),
    setTimeout,
  }, { filename: 'dataloader.js' });
  await window.__dataloaderReady;
  module.FS = realArchiveFS(options);
  module.postRun.forEach(callback => callback());
  for (let i = 0; i < 200 && window.__MMX_TUTORIAL_COMPAT__ === 'checking data'; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return { window, module, calls, timers, messages };
}

function gameMemory() {
  const heap = new Uint8Array(32 * 1024 * 1024);
  const view = new DataView(heap.buffer);
  const str = (address, value) => {
    heap.fill(0, address, address + value.length + 1);
    for (let i = 0; i < value.length; i++) heap[address + i] = value.charCodeAt(i);
  };
  view.setUint32(SCENE_POINTER, SCENE, true);
  view.setUint32(GLOBAL_POINTER, GLOBALS, true);
  view.setUint32(SCENE + 4, SCENES, true);
  view.setUint32(SCENE + 8, CATEGORIES, true);
  view.setUint16(SCENE + 24, 166, true);
  heap[SCENE + 52] = 6;
  heap[SCENE + 53] = 8;
  heap[SCENE + 54] = 1;
  heap[SCENE + 55] = 3;
  str(FOLDER, 'TUTORIAL');
  str(CATEGORIES + 56 + 16, 'Mania Mode');
  view.setUint16(CATEGORIES + 56 + 48, 6, true);
  view.setUint16(CATEGORIES + 56 + 50, 21, true);
  str(CATEGORIES + 6 * 56 + 16, 'Cutscenes');
  view.setUint16(CATEGORIES + 6 * 56 + 48, 166, true);
  view.setUint16(CATEGORIES + 6 * 56 + 50, 169, true);
  str(SCENES + 6 * 76 + 16, 'Sunny Shores Zone 1');
  str(SCENES + 6 * 76 + 48, 'GHZ');
  str(SCENES + 6 * 76 + 64, '1');
  str(SCENES + 166 * 76 + 16, 'Intro');
  str(SCENES + 166 * 76 + 48, 'TUTORIAL');
  str(SCENES + 167 * 76 + 16, 'Intro 2');
  str(SCENES + 167 * 76 + 48, 'ERZ');
  view.setInt32(GLOBALS + 200876, 1, true);
  view.setInt32(GLOBALS + 200880, 1, true);
  return { heap, view, str };
}

function watcher(h, memory) {
  h.window.HEAPU8 = memory.heap;
  const timer = h.timers.find(item => item.milliseconds === 16);
  assert.ok(timer, 'verified engine/data should install the transition watcher');
  return timer.callback;
}

function assertUnchanged(memory) {
  assert.equal(memory.heap[SCENE + 52], 6);
  assert.equal(memory.view.getUint16(SCENE + 24, true), 167);
  assert.equal(memory.view.getInt32(GLOBALS + 200876, true), 1);
  assert.equal(memory.view.getInt32(GLOBALS + 200880, true), 1);
}

test('only the supported engine and archive enable the tutorial transition workaround', async () => {
  const h = await harness();
  assert.equal(h.window.__MMX_TUTORIAL_COMPAT__, 'active');
  assert.equal(h.module.wasmBinary.byteLength, realWasm.length);
  assert.equal(h.calls.filter(call => call === 'GET RSDKv5U.wasm').length, 1);
  const memory = gameMemory();
  const tick = watcher(h, memory);
  tick(); // Observe Intro in the actual tutorial folder.
  memory.view.setUint16(SCENE + 24, 167, true);
  tick(); // RubyPortal has queued Intro 2 and set the suppression flags.
  assert.equal(h.window.__MMX_TUTORIAL_COMPAT__, 'redirected');
  assert.equal(memory.heap[SCENE + 52], 1);
  assert.equal(memory.view.getUint16(SCENE + 24, true), 6);
  assert.equal(memory.view.getInt32(GLOBALS + 200876, true), 0);
  assert.equal(memory.view.getInt32(GLOBALS + 200880, true), 0);
});

test('altered engine or game data disables the workaround without blocking startup', async () => {
  for (const options of [{ corruptWasm: true }, { corruptData: true }, { wrongSize: true }, { shortRead: true }]) {
    const h = await harness(options);
    assert.equal(h.window.__MMX_TUTORIAL_COMPAT__, 'unavailable');
    assert.equal(h.timers.some(item => item.milliseconds === 16), false);
    if (options.corruptWasm) assert.equal(h.module.wasmBinary, undefined);
  }
});

test('custom loaders, data overrides, and environments without Web Crypto are not patched', async () => {
  for (const options of [
    { noCrypto: true },
    { module: { wasmBinary: Uint8Array.of(1) } },
    { module: { locateFile() {} } },
    { module: { instantiateWasm() {} } },
    { search: '?data=' + encodeURIComponent('https://example.test/override') },
  ]) {
    const h = await harness(options);
    assert.equal(h.window.__MMX_TUTORIAL_COMPAT__, 'unavailable');
    assert.equal(h.calls.some(call => call === 'GET RSDKv5U.wasm'), false);
    assert.equal(h.timers.some(item => item.milliseconds === 16), false);
  }
});

test('a pending transition is untouched unless the live scene and flags match', async () => {
  const h = await harness();
  for (const change of [
    ({ str }) => str(FOLDER, 'ERZ'), // Intro 2 already loaded, too late to redirect.
    ({ heap }) => { heap[SCENE + 54] = 2; }, // Paused.
    ({ heap }) => { heap[SCENE + 55] = 1; }, // A different scene filter.
    ({ view }) => view.setInt32(GLOBALS, 1, true), // Encore, not Mania Mode.
    ({ str }) => str(CATEGORIES + 56 + 16, 'Different mode'),
    ({ str }) => str(SCENES + 167 * 76 + 48, 'OTHER'),
    ({ str }) => str(SCENES + 6 * 76 + 64, '2'),
    ({ view }) => view.setUint32(SCENE_POINTER, SCENE + 4, true),
    ({ view }) => view.setUint32(GLOBAL_POINTER, 0, true),
    ({ view }) => view.setUint32(SCENE + 8, 0xffffffff, true),
  ]) {
    const memory = gameMemory();
    const tick = watcher(h, memory);
    tick();
    memory.view.setUint16(SCENE + 24, 167, true);
    change(memory);
    assert.doesNotThrow(tick);
    assertUnchanged(memory);
  }
  const memory = gameMemory();
  const tick = watcher(h, memory);
  tick();
  memory.view.setUint16(SCENE + 24, 167, true);
  memory.view.setInt32(GLOBALS + 200880, 0, true);
  tick();
  assert.equal(memory.heap[SCENE + 52], 6);
  assert.equal(memory.view.getUint16(SCENE + 24, true), 167);
  assert.equal(memory.view.getInt32(GLOBALS + 200876, true), 1);
});

test('a transition without first observing the tutorial is not redirected', async () => {
  const h = await harness();
  const memory = gameMemory();
  memory.view.setUint16(SCENE + 24, 167, true);
  watcher(h, memory)();
  assertUnchanged(memory);
});
