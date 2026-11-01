// Boots the real game under its GitHub Pages origin, while serving the checked-in
// files locally. No production deployment or third-party network access is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');
const origin = 'https://thealphaleopard.github.io';
const prefix = '/megamix/';
const touchMode = process.argv.includes('--touch');
const allowed = /^(?:index\.html|dataloader\.js|RSDKv5U\.(?:js|wasm|data(?:\.manifest\.json)?)|chunks\/RSDKv5U\.data\.p\d{3})$/;

function contentType(name) {
  if (name.endsWith('.html')) return 'text/html';
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
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('crash', () => pageErrors.push('Browser tab crashed'));

  try {
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin || !url.pathname.startsWith(prefix)) {
        // Fonts are cosmetic and not necessary to start the game.
        if (url.hostname !== 'fonts.googleapis.com' && url.hostname !== 'fonts.gstatic.com') {
          unexpectedRequests.push(request.url());
        }
        return route.abort();
      }
      const name = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
      requests.push(`${request.method()} ${name}`);
      if (!allowed.test(name)) return route.fulfill({ status: 404 });
      const file = path.join(root, name);
      if (!fs.existsSync(file)) return route.fulfill({ status: 404 });
      if (request.method() === 'HEAD') {
        return route.fulfill({ status: 200, headers: { 'content-length': String(fs.statSync(file).size) } });
      }
      return route.fulfill({ path: file, contentType: contentType(name) });
    });

    console.log('Loading the game using the GitHub Pages origin...');
    await page.goto(origin + prefix, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('engine-ready'), null, { timeout: 120000 });
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
      if (touchMode) {
        const button = page.locator('#touch-controls .btn-a');
        await button.dispatchEvent('touchstart');
        await page.waitForTimeout(250);
        await button.dispatchEvent('touchend');
      } else {
        await page.keyboard.press('a', { delay: 250 });
      }
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
