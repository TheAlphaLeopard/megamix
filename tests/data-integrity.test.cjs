const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('all game data parts match the manifest and the engine package size', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'RSDKv5U.data.manifest.json'), 'utf8'));
  const engine = fs.readFileSync(path.join(root, 'RSDKv5U.js'), 'utf8');
  const metadata = engine.match(/remote_package_size:(\d+)/);
  assert.ok(metadata, 'could not find the package size in RSDKv5U.js');
  assert.equal(manifest.totalSize, Number(metadata[1]));

  const wholeHash = createHash('sha256');
  let total = 0;
  for (const part of manifest.parts) {
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of fs.createReadStream(path.join(root, part.name))) {
      size += chunk.length;
      hash.update(chunk);
      wholeHash.update(chunk);
    }
    assert.equal(size, part.size, `${part.name} size`);
    assert.equal(hash.digest('hex'), part.sha256, `${part.name} checksum`);
    total += size;
  }
  assert.equal(total, manifest.totalSize);
  assert.equal(wholeHash.digest('hex'), manifest.sha256);
});
