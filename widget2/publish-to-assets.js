/* Copies the built bundle into gpt-chat's own assets, so the app serves the
 * widget from its own domain: /assets/widget/latest/main.js.
 *
 * WHAT THIS IS FOR. It is the short route — one deploy, no CDN, no second
 * host. The console is already published somewhere with a certificate and a
 * domain, and a customer's page can load two files from it as easily as from
 * anywhere else. That makes it a real option for a handful of installs, a
 * pilot, or a customer who wants to see the thing working before anyone sets
 * up distribution properly.
 *
 * WHAT IT IS NOT. A CDN. Every widget load is a request to the app's own
 * hosting, cached by whatever that hosting sets rather than by an edge network
 * built for it. Fine at small numbers; not the answer at large ones.
 *
 * `latest` is a name, not a version. Copying over it changes the widget for
 * every site already pointing at that path, on their next uncached load — which
 * is the convenience and the hazard in the same sentence. For a customer who
 * should not move until you say so, copy to a pinned folder beside it
 * (`/assets/widget/2026-09-29/`) and give them that path.
 */

const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, 'dist');

// widget2 → app → src → assets. Anchored to this file so it does not depend on
// where the command was run from.
const TARGET = path.join(__dirname, '..', '..', 'assets', 'widget', 'latest');

if (!fs.existsSync(DIST)) {
  console.error(
    '\nNothing to publish: dist/ does not exist.\n' +
    'Run `npm run build` first, or `npm run publish` which does both.\n'
  );
  process.exit(1);
}

/* Build scaffolding, not deliverables.
 *
 * `index.html` is the local test page. Copied here it becomes a real page on
 * the app's own domain — /assets/widget/latest/ — loading the widget against
 * whatever app id the test page happens to carry. Nothing about the app links
 * to it and nobody would find it on purpose, which is precisely why it would
 * sit there unnoticed.
 *
 * `prerendered-routes.json` describes routes this bundle does not have; the
 * builder emits it regardless.
 *
 * `3rdpartylicenses.txt` is NOT in this list. It is the attribution for what
 * the bundle carries, and it belongs with the thing it attributes. */
const NOT_SHIPPED = new Set(['index.html', 'prerendered-routes.json']);

const files = fs
  .readdirSync(DIST)
  .filter(name => fs.statSync(path.join(DIST, name)).isFile())
  .filter(name => !NOT_SHIPPED.has(name));

if (!files.length) {
  console.error('\nNothing to publish: dist/ is empty.\n');
  process.exit(1);
}

// Replaced, not merged. A stale file left behind from an earlier build — a
// renamed chunk, a polyfill no longer emitted — would keep being served with
// nothing to show it is orphaned.
fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });

for (const name of files) {
  fs.copyFileSync(path.join(DIST, name), path.join(TARGET, name));
  console.log(`  ${name}`);
}

console.log(
  `\nCopied ${files.length} file(s) to src/assets/widget/latest.\n` +
  'Served at /assets/widget/latest/ once the app is deployed — the files are\n' +
  'static assets, so they ship with the next `npm run build` of gpt-chat.\n'
);
