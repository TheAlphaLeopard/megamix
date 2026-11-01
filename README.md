# Sonic Megamix Mania in the browser

A work-in-progress browser port of Sonic Megamix Mania, based on the web port by [KBH Games](https://kbhgames.com/).

## Playing

Open the [GitHub Pages site](https://thealphaleopard.github.io/megamix/). The first load downloads approximately 236 MiB of game data; a modern browser with WebAssembly and WebGL is required. Click or tap the game to enable audio. Use the arrow keys to move, **A** to confirm or jump, and **S** to go back. Touch controls are shown on touch devices. Saves are periodically stored in the browser's IndexedDB, so clearing site data also clears the saves.

For local development, serve the repository over HTTP rather than opening the HTML file directly:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

## Tests

With Node.js 20 or newer:

```sh
npm ci
npm test
npx playwright-core install chromium
npm run test:browser
npm run test:browser -- --touch
```

The browser smoke test serves the checked-in files under a simulated GitHub Pages origin. It checks that the game gets past the splash and title screens, reaches a new save and the tutorial, persists a save, and reports runtime errors. It does not modify the live site.

The bundled engine has a KBH-specific site check that otherwise leaves the game on a black screen on GitHub Pages. The loader uses the engine's local/offline startup path without changing the browser's real origin or requesting a localhost service. The compatibility callback is specific to the checked-in `RSDKv5U.js`/`RSDKv5U.wasm` pair; review it and rerun the browser tests when updating either file.

GitHub Pages currently publishes the repository's `main` branch. Changes on a working branch do not appear on the public site until they are merged into `main` and Pages rebuilds.
