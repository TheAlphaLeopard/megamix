# Sonic Megamix Mania in the browser

A work-in-progress browser port of Sonic Megamix Mania, based on the web port by [KBH Games](https://kbhgames.com/).

## Playing

Open the [GitHub Pages site](https://thealphaleopard.github.io/megamix/) or open the [SVG launcher on jsDelivr](https://cdn.jsdelivr.net/gh/TheAlphaLeopard/megamix/loader.svg) directly in a browser tab. The SVG must be opened as a document, not embedded in an `<img>` tag (browsers disable its scripts in image mode). The first load downloads approximately 236 MiB of game data; a modern browser with WebAssembly and WebGL is required. Click or tap the game to enable audio. Use the arrow keys to move, **A** to confirm or jump, **S** to go back, and **Enter** to pause. Touch controls are shown on touch devices; their separate **START** button pauses the game. Saves are periodically stored in the browser's IndexedDB, so clearing site data also clears the saves. Saves on GitHub Pages and jsDelivr are separate because they have different origins.

## Compatibility and known limitations

This is an unofficial, incomplete decomp-based port. The [Megamix authors say the mod requires Steam Sonic Mania Plus and does not work with the decomp](https://shc.zone/entries/contest2023/906). The in-game compatibility warning is therefore still relevant: custom moves, objects, graphics, and later levels may be missing or broken, and the game can softlock. This repository does not contain a compatible implementation of all of the original mod's game code.

For the checked-in engine and data, the loader works around one specific softlock: the tutorial exit is sent directly to Sunny Shores Zone 1 instead of the broken Intro 2 scene. The intro cutscene is skipped. The workaround verifies the engine and relevant archive records and checks the live scene state before redirecting; it is disabled for custom data overrides, custom engine loaders, unfamiliar versions, or browsers without Web Crypto. Web Crypto requires a secure context such as HTTPS or localhost. If you are already stuck after skipping the tutorial, reload and select the existing save; in testing the default save resumed at Sunny Shores. This workaround is not a complete repair of the game.

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
npm run test:browser -- --svg
npm run test:browser -- --svg --touch
```

The browser smoke test serves the checked-in files under a simulated GitHub Pages origin, or the exact jsDelivr SVG URL with `--svg`. It skips the tutorial through the portal, checks movement, jumping, pause, the first zone's scenery and timer, reloads the save, and checks the first-to-second-act transition. The last check teleports to the signpost for speed, so it does not establish that the full level or later zones are playable. Run the touch variants to exercise the on-screen controls. The tests do not request the live game files or modify either site.

The bundled engine has a KBH-specific site check that otherwise leaves the game on a black screen on GitHub Pages. The loader uses the engine's local/offline startup path without changing the browser's real origin or requesting a localhost service. The compatibility callback is specific to the checked-in `RSDKv5U.js`/`RSDKv5U.wasm` pair; review it and rerun the browser tests when updating either file.

GitHub Pages currently publishes the repository's `main` branch. Changes on a working branch do not appear on the public site until they are merged into `main` and Pages rebuilds. The unversioned jsDelivr URL also follows the default branch but may continue serving cached files after a merge; a hard refresh can bypass an older browser cache, while the CDN's own cache must expire or be purged. The SVG uses a content-derived query for `dataloader.js` to avoid reusing an older browser-cached loader. Update `DATALOADER_REVISION` in `loader.svg` to the first 12 hexadecimal digits of `dataloader.js`'s SHA-256 whenever that file changes; a test checks this.
