/* Writes the real host into INSTALL.md, in this folder, before the build.
 *
 * INSTALL.md ships as an asset, so the build copies whatever is here into
 * dist/. Rewriting the source rather than the copy means the file people read
 * in the repo and the file a customer receives are the same file, always
 * agreeing — and the doc is correct even when someone opens it without having
 * built anything.
 *
 * IT REWRITES THE HOST, NOT A PLACEHOLDER. The obvious implementation replaces
 * YOUR-ASSISTANT-HOST once, works, and then has nothing to match on the next
 * run — leaving the address frozen at whatever it was the first time, which is
 * exactly the drift the script exists to prevent. So it matches the host
 * POSITION in the widget URLs instead: anything sitting where the host goes is
 * replaced, whether that is the placeholder or an address written by an
 * earlier run. Running it twice is the same as running it once, and changing
 * appUrl is picked up.
 *
 * It degrades rather than fails. No address to be found means the file is left
 * exactly as it is and the build says so — a doc still reading
 * YOUR-ASSISTANT-HOST is obviously unfinished, whereas stopping the build
 * would block a bundle that is otherwise perfectly good.
 */

const fs = require('node:fs');
const path = require('node:path');

const PLACEHOLDER = 'YOUR-ASSISTANT-HOST';

/* The widget URLs in the doc, with the host as the part to replace. Anchored
 * on the path that follows it, so prose mentioning the placeholder elsewhere
 * is left alone. */
const WIDGET_URL = /(https?:\/\/)([^/\s`]+)(\/assets\/widget\/)/g;

/* Every file that names where the widget is served from.
 *
 * The admin test page is here for the same reason INSTALL.md is: it loads the
 * bundle by absolute URL on purpose — a relative path would be fetched
 * same-origin and would skip the cross-origin module fetch, which is the thing
 * most worth testing — and an address maintained by hand in two files is an
 * address that ends up different in two files. */
const DOCS = [
  path.join(__dirname, 'INSTALL.md'),
  path.join(__dirname, '..', '..', '..', 'public', 'widget-test.html'),

  // The customer-facing install documents under assets/help-md are NOT here,
  // and that is the point of this note.
  //
  // They name the PRODUCTION host and nothing else. A customer pasting from
  // them is installing on their own live site, so the address has to be the one
  // that will still serve the bundle tomorrow — not whichever environment
  // happened to build the console they were reading it in. Rewriting them from
  // `appUrl` did exactly that, and a dev build quietly published documentation
  // telling customers to load scripts from dev.blueboot.ai.
  //
  // The two files above are different: INSTALL.md ships beside a bundle
  // somebody just built, and widget-test.html tests the environment it is
  // served from. Both should follow appUrl. Customer documentation should not.
];

const ENV_COMMON = path.join(__dirname, '..', '..', 'environments', 'env.common.ts');

/**
 * Where the widget is served from, as a bare host.
 *
 * WIDGET_APP_URL first, so a build for a customer on their own domain does not
 * need a code change. Then `appUrl` out of env.common.ts, which
 * sync-env-secrets.js keeps in step with blueboot.secrets.ts — regex rather
 * than import, the same way update-widget-env.js reads publicApiUrl from that
 * file, because a .ts module is not loadable from a plain Node script.
 *
 * env.common.ts is outside widget2's tree. That is deliberate and safe: it is
 * read only if it exists, so widget2 copied into another repo simply falls
 * through to the placeholder rather than breaking.
 */
function resolveHost() {
    const fromEnv = (process.env.WIDGET_APP_URL || '').trim();
    if (fromEnv) return toHost(fromEnv);

    if (!fs.existsSync(ENV_COMMON)) return null;

    const match = fs.readFileSync(ENV_COMMON, 'utf8').match(/export const appUrl\s*=\s*["']([^"']+)["']/);
    return match ? toHost(match[1]) : null;
}

/** Strips the scheme and any trailing slash: the placeholder sits after
 *  `https://` in the doc, so the scheme would be doubled. */
function toHost(url) {
    return url.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
}

const host = resolveHost();

if (!host) {
    console.warn(
        `[build-install-doc] no appUrl found — files left as they are (${PLACEHOLDER}).\n` +
        '                    Set WIDGET_APP_URL, or run this inside gpt-chat where\n' +
        '                    env.common.ts carries appUrl (see sync-env-secrets.js).'
    );
    process.exit(0);
}

for (const doc of DOCS) {
    const name = path.basename(doc);

    // A missing file is not a failure: widget2 copied into another repo has
    // INSTALL.md and no console around it, so the test page simply is not there.
    if (!fs.existsSync(doc)) {
        console.log(`[build-install-doc] ${name} not found, skipping`);
        continue;
    }

    const src = fs.readFileSync(doc, 'utf8');

    // test() leaves lastIndex set on a /g regex and replace() would resume from
    // there — so it is reset before each use, not once.
    WIDGET_URL.lastIndex = 0;

    if (!WIDGET_URL.test(src)) {
        // Not an error: the URLs may have been reworded. Worth saying, because
        // the address is then no longer being maintained here.
        console.warn(`[build-install-doc] no widget URL in ${name} — nothing replaced`);
        continue;
    }

    WIDGET_URL.lastIndex = 0;
    const updated = src.replace(WIDGET_URL, (full, scheme, current, tail) => `${scheme}${host}${tail}`);

    if (updated === src) {
        console.log(`[build-install-doc] ${name} already points at ${host}`);
        continue;
    }

    fs.writeFileSync(doc, updated);
    console.log(`[build-install-doc] ${name} -> ${host}`);
}
