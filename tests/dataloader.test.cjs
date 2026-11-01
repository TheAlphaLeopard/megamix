const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const loaderSource = fs.readFileSync(path.join(root, 'dataloader.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(root, 'RSDKv5U.js'), 'utf8');

function makeResponse(status, bytes = [], json = null) {
  const data = Uint8Array.from(bytes);
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => String(data.byteLength) },
    body: {
      getReader() {
        return {
          async read() {
            if (sent) return { done: true };
            sent = true;
            return { done: false, value: data };
          },
        };
      },
    },
    async json() { return json; },
  };
}

function makeHarness(options = {}) {
  const calls = [];
  const messages = [];
  const status = { textContent: '' };
  const fill = { style: {} };
  const elements = {
    'loader-overlay': { style: {} },
    'loader-progress': { firstElementChild: fill },
    'loader-status': status,
    canvas: { addEventListener() {} },
  };
  const module = options.module || {};
  const window = {
    location: { href: 'https://thealphaleopard.github.io/megamix/', search: options.search || '?noidbfs=1' },
    __MMX_BASE__: options.base || '',
    Module: module,
    addEventListener() {},
  };
  const document = {
    getElementById: id => elements[id] || null,
    body: { classList: { add() {} } },
  };
  const manifest = options.manifest || {
    totalSize: 5,
    parts: [
      { name: 'chunks/part0', size: 2 },
      { name: 'chunks/part1', size: 3 },
    ],
  };
  const parts = options.parts || { 'chunks/part0': [1, 2], 'chunks/part1': [3, 4, 5] };
  const base = options.base || '';
  const fetch = async (url, request = {}) => {
    calls.push({ url, method: request.method || 'GET' });
    if (url === options.overrideUrl) return makeResponse(200, options.overrideBytes);
    if (url === base + 'RSDKv5U.data') return makeResponse(options.direct ? 200 : 404);
    if (url === base + 'RSDKv5U.data.manifest.json') {
      return options.manifestMissing ? makeResponse(404) : makeResponse(200, [], manifest);
    }
    const name = url.startsWith(base) ? url.slice(base.length) : url;
    if (Object.hasOwn(parts, name)) return makeResponse(200, parts[name]);
    return makeResponse(404);
  };
  const sandbox = {
    window, document, fetch, URLSearchParams,
    console: {
      log: (...args) => messages.push(args.join(' ')),
      warn: (...args) => messages.push(args.join(' ')),
      error: (...args) => messages.push(args.join(' ')),
    },
    setInterval() {},
    setTimeout,
  };
  vm.runInNewContext(loaderSource, sandbox, { filename: 'dataloader.js' });
  return { window, module, status, fill, calls, messages, sandbox };
}

test('manifest parts are assembled once and supplied directly to Emscripten', async () => {
  const fallback = (name, size) => `previous:${name}:${size}`;
  const h = makeHarness({ base: '/cdn/', module: { getPreloadedPackage: fallback } });
  assert.equal(await h.window.__dataloaderReady, '/cdn/RSDKv5U.data');
  assert.equal(h.module.locateFile('RSDKv5U.data', '/ignored/'), '/cdn/RSDKv5U.data');
  assert.equal(h.module.locateFile('RSDKv5U.wasm', '/engine/'), '/engine/RSDKv5U.wasm');
  assert.equal(h.module.getPreloadedPackage('other.data', 10), 'previous:other.data:10');
  assert.throws(() => h.module.getPreloadedPackage('/cdn/RSDKv5U.data', 6), /does not match the engine/);
  const buffer = h.module.getPreloadedPackage('/cdn/RSDKv5U.data', 5);
  assert.deepEqual([...new Uint8Array(buffer)], [1, 2, 3, 4, 5]);
  assert.equal(h.module.getPreloadedPackage('/cdn/RSDKv5U.data', 5), 'previous:/cdn/RSDKv5U.data:5');
  assert.equal(h.fill.style.width, '100%');
  assert.deepEqual(h.calls.map(c => `${c.method} ${c.url}`), [
    'HEAD /cdn/RSDKv5U.data',
    'HEAD /cdn/RSDKv5U.data.manifest.json',
    'GET /cdn/RSDKv5U.data.manifest.json',
    'GET /cdn/chunks/part0',
    'GET /cdn/chunks/part1',
  ]);
});

test('direct data files retain the configured asset base', async () => {
  const h = makeHarness({ base: 'https://example.test/game/', direct: true });
  assert.equal(await h.window.__dataloaderReady, 'https://example.test/game/RSDKv5U.data');
  assert.equal(h.module.locateFile('RSDKv5U.data', ''), 'https://example.test/game/RSDKv5U.data');
  assert.equal(h.module.getPreloadedPackage, undefined);
  assert.deepEqual(h.calls.map(c => `${c.method} ${c.url}`), ['HEAD https://example.test/game/RSDKv5U.data']);
});

test('data override is also passed to Emscripten without a blob URL', async () => {
  const overrideUrl = 'https://example.test/custom.data';
  const h = makeHarness({
    search: '?noidbfs=1&data=' + encodeURIComponent(overrideUrl),
    overrideUrl,
    overrideBytes: [9, 8, 7],
  });
  await h.window.__dataloaderReady;
  assert.deepEqual([...new Uint8Array(h.module.getPreloadedPackage('RSDKv5U.data', 3))], [9, 8, 7]);
  assert.deepEqual(h.calls.map(c => `${c.method} ${c.url}`), [`GET ${overrideUrl}`]);
});

test('malformed manifest is rejected before downloading its parts', async () => {
  for (const manifest of [
    { totalSize: 5, parts: [{ name: 'chunks/part0', size: 2 }] },
    { totalSize: 5, parts: [{ name: 'chunks/part0', size: -1 }] },
    { totalSize: 0, parts: [{ name: 'chunks/part0', size: 2 }] },
    { totalSize: 5, parts: [] },
  ]) {
    const h = makeHarness({ manifest });
    await assert.rejects(h.window.__dataloaderReady, /manifest/);
    assert.match(h.status.textContent, /^FATAL: /);
    assert.equal(h.calls.some(c => c.url.startsWith('chunks/')), false);
  }
});

test('a truncated chunk is reported instead of starting a corrupt game', async () => {
  const h = makeHarness({ parts: { 'chunks/part0': [1], 'chunks/part1': [3, 4, 5] } });
  await assert.rejects(h.window.__dataloaderReady, /chunk size mismatch for chunks\/part0/);
  assert.match(h.status.textContent, /^FATAL: chunk size mismatch/);
  assert.equal(h.calls.some(c => c.url === 'chunks/part1'), false);
});

test('the checked-in engine URL callback uses offline mode without changing the page origin', async () => {
  const match = engineSource.match(/399590:(\(\$0,\$1\)=>\{.*?\}),399785:/);
  assert.ok(match, 'the engine URL callback changed; review the compatibility hook');
  const originalCallback = vm.runInNewContext(match[1]);
  const h = makeHarness();
  await h.window.__dataloaderReady;
  const writes = [];
  h.window.ASM_CONSTS = { 399590: originalCallback };
  h.module.stringToUTF8 = (...args) => writes.push(args);
  h.module.preRun.forEach(callback => callback());
  assert.equal(h.window.ASM_CONSTS[399590](42, 100), 'http://127.0.0.1/'.length);
  assert.deepEqual(writes.pop(), ['http://127.0.0.1/', 42, 100]);
  assert.equal(h.window.ASM_CONSTS[399590](12, 5), 4);
  assert.deepEqual(writes.pop(), ['http', 12, 5]);
  assert.equal(h.window.location.href, 'https://thealphaleopard.github.io/megamix/');
});

test('an unfamiliar engine callback is not patched accidentally', async () => {
  const h = makeHarness();
  await h.window.__dataloaderReady;
  const otherCallback = () => 123;
  h.window.ASM_CONSTS = { 399590: otherCallback };
  h.module.stringToUTF8 = () => {};
  h.module.preRun.forEach(callback => callback());
  assert.equal(h.window.ASM_CONSTS[399590], otherCallback);
  assert.ok(h.messages.some(message => message.includes('compatibility hook not found')));
});
