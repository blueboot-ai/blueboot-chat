/* npm run sync-widget
 *
 * Replaces ./widget2 with a fresh copy of widget2 from the monorepo
 * (assist-app/gpt-chat/src/app/widget2). That copy in the monorepo is the
 * master: gpt-chat builds the HTML widget from it. Edit widget2 there; edits
 * made in ./widget2 are overwritten by the next sync.
 *
 * Read-only on the monorepo. Replaces rather than merges, so a file deleted in
 * the master is deleted here too. Installed and built output is left out (and
 * an existing ./widget2/node_modules is kept, so builds stay fast).
 *
 * The monorepo's location comes from tools/config.js.
 */
const fs = require("fs");
const path = require("path");
const { projectRoot, monorepoRoot, widget2InMonorepo } = require("./config");

const SKIP = new Set(["node_modules", "dist", ".angular", "out-tsc", ".DS_Store", "Thumbs.db"]);
const target = path.join(projectRoot, "widget2");

const root = monorepoRoot();
if (!root) {
  console.error(
    "\nMonorepo not found. Tell this project where it is, either:\n" +
    '  - create local.config.json here:  { "monorepo": "/path/to/prod recent" }\n' +
    "  - or set BLUESEARCH_MONOREPO=/path/to/prod recent\n"
  );
  process.exit(1);
}
const master = widget2InMonorepo(root);
if (!fs.existsSync(path.join(master, "elements.ts"))) {
  console.error(`\nNo widget2 at ${master}\n`);
  process.exit(1);
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

// Clear everything in ./widget2 except node_modules, then copy.
fs.mkdirSync(target, { recursive: true });
for (const name of fs.readdirSync(target)) {
  if (name === "node_modules") continue;
  fs.rmSync(path.join(target, name), { recursive: true, force: true });
}
copyTree(master, target);

let count = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    e.isDirectory() ? walk(path.join(d, e.name)) : count++;
  }
})(target);
console.log(`[sync-widget] ./widget2 copied from ${master} (${count} files).`);
console.log("[sync-widget] Review with `git diff -- widget2`, then run `npm run release`.");
