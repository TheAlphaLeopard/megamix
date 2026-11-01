const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const name of ['index.html', 'cdn.html']) {
  test(`${name} keeps jump, back, and pause as separate touch buttons`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
    assert.match(html, /class="tc-btn btn-a" data-key="a"/);
    assert.match(html, /class="tc-btn btn-b" data-key="s"/);
    assert.match(html, /class="tc-btn btn-start" data-key="Enter"/);
    assert.doesNotMatch(html, /class="tc-btn btn-a" data-key="[^"]*Enter/);
    assert.equal((html.match(/<\/html>/g) || []).length, 1);
  });
}
