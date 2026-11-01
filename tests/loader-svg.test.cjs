const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'loader.svg'), 'utf8');

test('the direct SVG launcher stays an XML document with executable scripts', () => {
  assert.match(svg, /^<\?xml[^>]*\?>\s*<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<foreignObject\b[\s\S]*<html\b[^>]*xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  const scripts = [...svg.matchAll(/<script>(?:\/\/)?<!\[CDATA\[([\s\S]*?)\]\]><\/script>/g)];
  assert.equal(scripts.length, 2, 'Expected the XML shim and launcher scripts');
  for (const [, source] of scripts) assert.doesNotThrow(() => new vm.Script(source));
  assert.doesNotMatch(svg, /fonts\.googleapis\.com|window\.fetch\s*=/);
});

test('the SVG dataloader cache key changes with dataloader.js', () => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'dataloader.js'))).digest('hex').slice(0, 12);
  assert.match(svg, new RegExp(`var DATALOADER_REVISION = "${digest}";`));
  assert.match(svg, /dl\.src = CDN_BASE \+ "dataloader\.js\?v=" \+ DATALOADER_REVISION;/);
  assert.match(svg, /var CDN_BASE = "";/);
});
