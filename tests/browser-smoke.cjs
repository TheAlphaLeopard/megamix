// Boots the real game under its GitHub Pages or jsDelivr origin, while serving
// the checked-in files locally. No production deployment or network is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');
const svgMode = process.argv.includes('--svg');
const origin = svgMode ? 'https://cdn.jsdelivr.net' : 'https://thealphaleopard.github.io';
const prefix = svgMode ? '/gh/TheAlphaLeopard/megamix/' : '/megamix/';
const pageName = svgMode ? 'loader.svg' : 'index.html';
const touchMode = process.argv.includes('--touch');
const allowed = /^(?:index\.html|loader\.svg|dataloader\.js|RSDKv5U\.(?:js|wasm|data(?:\.manifest\.json)?)|chunks\/RSDKv5U\.data\.p\d{3})$/;

// These addresses apply only to the exact, checksum-guarded engine in this
// repository. They let the test time the tutorial portal jump and inspect the
// loaded scene; they are not a general interface for other RSDK builds.
const playerPosition = 17673188;
const sceneInfo = 8878812;
const currentFolder = 12957088;

async function key(page, name, down) {
  if (!touchMode) return down ? page.keyboard.down(name) : page.keyboard.up(name);
  const selectors = {
    a: '.btn-a', Enter: '.btn-start', ArrowLeft: '.left', ArrowRight: '.right',
  };
  await page.locator('#touch-controls ' + selectors[name]).dispatchEvent(down ? 'touchstart' : 'touchend');
}

async function tap(page, name, duration = 120) {
  await key(page, name, true);
  await page.waitForTimeout(duration);
  await key(page, name, false);
}

// Exercise hit testing with an actual touchscreen contact, not just a DOM
// event dispatched straight to the element (which could be hidden or covered).
async function touchscreenPress(page, selector, duration = 120) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `Touch target has no box: ${selector}`);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 }],
    });
    await page.waitForTimeout(duration);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

function contentType(name) {
  if (name.endsWith('.html')) return 'text/html';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.js')) return 'application/javascript';
  if (name.endsWith('.wasm')) return 'application/wasm';
  if (name.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

// Approximate colors in the displayed canvas to recognize the title, the save
// selection menu, and the orange tutorial level. The game doesn't expose DOM
// elements for its menus. Sampling colors is tolerant of animation and scaling.
async function screenColors(page) {
  const image = await page.screenshot();
  return page.evaluate(async base64 => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + base64;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 36;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let blue = 0, orange = 0, black = 0, lavender = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      if (b > 145 && b > r * 1.2 && b > g * 1.07 && r < 145) blue++;
      if (r > 100 && g > 30 && g < 190 && b < 100 && r > g * 1.3) orange++;
      if (r < 25 && g < 25 && b < 25) black++;
      if (r > 100 && b > r && b > g && g > 80) lavender++;
    }
    const count = pixels.length / 4;
    return { blue: blue / count, orange: orange / count, black: black / count, lavender: lavender / count };
  }, image.toString('base64'));
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--enable-unsafe-swiftshader', ...JSON.parse(process.env.PLAYWRIGHT_EXTRA_ARGS || '[]')],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    isMobile: touchMode,
    hasTouch: touchMode,
  });
  const page = await context.newPage();
  const unexpectedRequests = [];
  const pageErrors = [];
  const requests = [];
  const requestUrls = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('crash', () => pageErrors.push('Browser tab crashed'));

  try {
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin || !url.pathname.startsWith(prefix)) {
        // The HTML launcher uses optional Google fonts; the SVG does not.
        if (svgMode || (url.hostname !== 'fonts.googleapis.com' && url.hostname !== 'fonts.gstatic.com')) {
          unexpectedRequests.push(request.url());
        }
        return route.abort();
      }
      const name = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
      requests.push(`${request.method()} ${name}`);
      requestUrls.push(request.url());
      if (!allowed.test(name)) return route.fulfill({ status: 404 });
      const file = path.join(root, name);
      if (!fs.existsSync(file)) return route.fulfill({ status: 404 });
      if (request.method() === 'HEAD') {
        return route.fulfill({ status: 200, headers: { 'content-length': String(fs.statSync(file).size) } });
      }
      return route.fulfill({ path: file, contentType: contentType(name) });
    });

    console.log(`Loading ${origin + prefix + (svgMode ? pageName : '')} with local game files...`);
    await page.goto(origin + prefix + (svgMode ? pageName : ''), { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (svgMode) {
      assert.deepEqual(await page.evaluate(() => ({
        contentType: document.contentType,
        root: document.documentElement.localName,
        namespace: document.documentElement.namespaceURI,
        parseErrors: document.getElementsByTagName('parsererror').length,
        bodies: document.querySelectorAll('body').length,
        bodyContainsGame: document.body && document.body.contains(document.getElementById('canvas')),
      })), {
        contentType: 'image/svg+xml', root: 'svg',
        namespace: 'http://www.w3.org/2000/svg', parseErrors: 0,
        bodies: 1, bodyContainsGame: true,
      });
    }
    await page.waitForFunction(() => document.body.classList.contains('engine-ready'), null, { timeout: 120000 });
    if (svgMode) {
      const loaderUrl = requestUrls.map(url => new URL(url)).find(url => url.pathname === prefix + 'dataloader.js');
      assert.ok(loaderUrl && loaderUrl.searchParams.has('v'), 'SVG must use a fresh dataloader cache key');
    }
    assert.ok(await page.locator('#fs-btn').isVisible(), 'Fullscreen button must be visible after startup');
    if (touchMode) {
      assert.ok(await page.locator('#touch-controls .btn-start').isVisible(), 'Touch START button must be visible');
    }
    if (svgMode) {
      await page.locator('#fs-btn').click();
      await page.waitForFunction(() => document.fullscreenElement === document.documentElement, null, { timeout: 5000 });
      if (touchMode) {
        assert.ok(await page.locator('#touch-controls .btn-start').isVisible(), 'Touch controls must remain available in fullscreen');
      }
      await page.locator('#fs-btn').click();
      await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 });
    }
    assert.equal(await page.evaluate(() => Module.FS.stat('/Data.rsdk').size), 247953543);
    assert.equal(await page.evaluate(() => Module.FS.readlink('/idbfs/Data.rsdk')), '/Data.rsdk');
    assert.equal(requests.filter(request => request.startsWith('GET chunks/')).length, 14);
    assert.ok(!requests.includes('GET RSDKv5U.data'), 'Emscripten should reuse the assembled buffer');

    await page.locator('#canvas').click({ position: { x: 25, y: 25 } });
    let colors;
    const titleDeadline = Date.now() + 70000;
    do {
      await page.waitForTimeout(2000);
      colors = await screenColors(page);
    } while (!(colors.blue > 0.30 && colors.black < 0.15) && Date.now() < titleDeadline);
    assert.ok(colors.blue > 0.30 && colors.black < 0.15,
      `The title screen never appeared (possible post-splash black screen): ${JSON.stringify(colors)}`);
    console.log('Reached the title screen.');

    let sawSaveSelect = false;
    let reachedTutorial = false;
    for (let i = 0; i < 14 && !reachedTutorial; i++) {
      await tap(page, 'a', 250);
      await page.waitForTimeout(5000);
      colors = await screenColors(page);
      if (colors.lavender > 0.50 && colors.blue > 0.05) sawSaveSelect = true;
      if (colors.orange > 0.40 && colors.blue < 0.15) reachedTutorial = true;
    }
    assert.ok(sawSaveSelect, 'Game did not reach the save selection menu');
    assert.ok(reachedTutorial, `Game did not reach the tutorial level: ${JSON.stringify(colors)}`);
    assert.deepEqual(unexpectedRequests, [], 'Game should not depend on a third-party site check');
    assert.deepEqual(pageErrors, [], 'Game produced an uncaught browser error');
    console.log('Reached save select and the tutorial level without errors.');

    await page.waitForFunction(() => window.__MMX_TUTORIAL_COMPAT__ === 'active', null, { timeout: 15000 });
    // The first portal is at x=1536; approach from the right and jump into it.
    // Waiting for position rather than wall-clock timing makes this stable at
    // different rendering speeds. The portal takes a moment to open.
    await page.waitForTimeout(4000);
    await key(page, 'ArrowLeft', true);
    await page.waitForFunction(address => HEAP32[address >> 2] / 65536 < 1610, playerPosition, { timeout: 15000 });
    await tap(page, 'a');
    await page.waitForFunction(address => HEAP32[address >> 2] / 65536 < 1540, playerPosition, { timeout: 6000 });
    await key(page, 'ArrowLeft', false);
    await page.waitForFunction(() => window.__MMX_TUTORIAL_COMPAT__ === 'redirected', null, { timeout: 15000 });
    await page.waitForFunction(({ scene, folder }) =>
      HEAPU8[scene + 52] === 1 && HEAPU16[(scene + 24) >> 1] === 6 &&
      HEAPU8[folder] === 71 && HEAPU8[folder + 1] === 72 && HEAPU8[folder + 2] === 90 &&
      HEAP32[(scene + 48) >> 2] === 1 && HEAPU8[scene + 57] >= 8,
    { scene: sceneInfo, folder: currentFolder }, { timeout: 40000 });
    const firstActLog = await page.evaluate(() => Module.FS.readFile('/idbfs/log.txt', { encoding: 'utf8' }));
    assert.match(firstActLog, /Loading Scene "Mania Mode - Sunny Shores Zone 1"/);
    assert.doesNotMatch(firstActLog, /Loading Scene "Cutscenes - Intro 2"/);
    assert.match(firstActLog, /Loaded data file Data\/Music\/SunnyShores1\.ogg/);
    colors = await screenColors(page);
    assert.ok(colors.blue > 0.05 && colors.orange > 0.05,
      `First zone did not render its expected scenery: ${JSON.stringify(colors)}`);

    // Exercise the actual gameplay controls. In particular touch A must not
    // send Enter as well: Enter pauses the level instead of jumping.
    const startY = await page.evaluate(address => HEAP32[(address >> 2) + 1] / 65536, playerPosition);
    await key(page, 'a', true);
    await page.waitForFunction(({ address, y }) => HEAP32[(address >> 2) + 1] / 65536 < y - 5,
      { address: playerPosition, y: startY }, { timeout: 3000 });
    await key(page, 'a', false);
    assert.equal(await page.evaluate(address => HEAPU8[address + 54], sceneInfo), 1, 'Jump unexpectedly paused the game');
    const startX = await page.evaluate(address => HEAP32[address >> 2] / 65536, playerPosition);
    await key(page, 'ArrowRight', true);
    await page.waitForFunction(({ address, x }) => HEAP32[address >> 2] / 65536 > x + 30,
      { address: playerPosition, x: startX }, { timeout: 6000 });
    await key(page, 'ArrowRight', false);
    if (touchMode) await touchscreenPress(page, '#touch-controls .btn-start');
    else await tap(page, 'Enter');
    await page.waitForFunction(address => HEAPU8[address + 54] === 3, sceneInfo, { timeout: 5000 });
    await page.waitForTimeout(1500);
    await tap(page, 'a');
    await page.waitForFunction(address => HEAPU8[address + 54] === 1, sceneInfo, { timeout: 5000 });
    console.log('Skipped the tutorial and played Sunny Shores with a running timer.');

    const savedKeys = await page.evaluate(async () => {
      await new Promise((resolve, reject) => Module.FS.syncfs(false, error => error ? reject(error) : resolve()));
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('/idbfs');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const keys = db.transaction('FILE_DATA', 'readonly').objectStore('FILE_DATA').getAllKeys();
          keys.onerror = () => reject(keys.error);
          keys.onsuccess = () => { db.close(); resolve(keys.result); };
        };
      });
    });
    assert.ok(savedKeys.includes('/idbfs/SaveData.bin'), 'Game save was not persisted to IndexedDB');
    console.log('Game save persisted to IndexedDB.');

    // Reload the same browser context and select the existing save. It should
    // resume in the first zone rather than repeat the tutorial or enter Intro 2.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('engine-ready'), null, { timeout: 120000 });
    await page.locator('#canvas').click({ position: { x: 25, y: 25 } });
    const reloadTitleDeadline = Date.now() + 70000;
    do {
      await page.waitForTimeout(2000);
      colors = await screenColors(page);
    } while (!(colors.blue > 0.30 && colors.black < 0.15) && Date.now() < reloadTitleDeadline);
    assert.ok(colors.blue > 0.30 && colors.black < 0.15, 'Title screen did not return after reload');
    let resumedFirstAct = false;
    for (let i = 0; i < 14 && !resumedFirstAct; i++) {
      await tap(page, 'a', 250);
      await page.waitForTimeout(4000);
      resumedFirstAct = await page.evaluate(({ scene, folder }) =>
        HEAPU8[scene + 52] === 1 && HEAPU16[(scene + 24) >> 1] === 6 &&
        HEAPU8[folder] === 71 && HEAPU8[folder + 1] === 72 && HEAPU8[folder + 2] === 90,
      { scene: sceneInfo, folder: currentFolder });
    }
    assert.ok(resumedFirstAct, 'The persisted save did not resume in Sunny Shores');
    await page.waitForFunction(address => HEAP32[(address + 48) >> 2] === 1, sceneInfo, { timeout: 25000 });
    console.log('Reloaded the saved game in Sunny Shores.');

    // Diagnostic shortcut: move the player to the first act's signpost. This
    // checks the act transition, but deliberately does not claim that the
    // entire level is playable or that later mod-specific objects work.
    await page.evaluate(address => {
      HEAP32[address >> 2] = 24840 * 65536;
      HEAP32[(address >> 2) + 1] = 680 * 65536;
    }, playerPosition);
    await key(page, 'ArrowRight', true);
    await page.waitForFunction(({ scene, folder }) =>
      HEAPU8[scene + 52] === 1 && HEAPU16[(scene + 24) >> 1] === 7 &&
      HEAPU8[folder] === 80 && HEAPU8[folder + 1] === 83 && HEAPU8[folder + 2] === 90 && HEAPU8[folder + 3] === 49,
    { scene: sceneInfo, folder: currentFolder }, { timeout: 50000 });
    await key(page, 'ArrowRight', false);
    await page.waitForFunction(address => HEAP32[(address + 48) >> 2] === 1 && HEAPU8[address + 57] >= 1,
      sceneInfo, { timeout: 25000 });
    const progressionLog = await page.evaluate(() => Module.FS.readFile('/idbfs/log.txt', { encoding: 'utf8' }));
    assert.match(progressionLog, /Loading Scene "Mania Mode - 2"/);
    assert.deepEqual(unexpectedRequests, [], 'Game should not depend on a third-party site check');
    assert.deepEqual(pageErrors, [], 'Game produced an uncaught browser error');
    console.log('The first act signpost led to act 2 (using a diagnostic teleport).');

    // A fatal error after the splash screen must be visible instead of leaving
    // the user with an unexplained frozen/black canvas.
    await page.evaluate(() => Module.onAbort('browser smoke test'));
    assert.equal(await page.locator('#loader-overlay').evaluate(el => getComputedStyle(el).display), 'flex');
    assert.match(await page.locator('#loader-status').textContent(), /Engine aborted: browser smoke test/);
    console.log('Runtime errors are visible after startup.');
  } catch (error) {
    await page.screenshot({ path: 'browser-smoke-failure.png' }).catch(() => {});
    if (pageErrors.length) console.error('Browser errors:', pageErrors);
    if (unexpectedRequests.length) console.error('Unexpected requests:', unexpectedRequests);
    console.error('Failure screenshot: browser-smoke-failure.png');
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
