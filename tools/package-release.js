/* npm run release
 *
 * Builds the WordPress plugin zip from this repository:
 *
 *   1. checks the version: blue-search.php "Version:" must equal readme.txt
 *      "Stable tag:" (WordPress.org rejects a mismatch)
 *   2. builds ./widget2 (installs its dependencies the first time)
 *   3. puts the bundle into widget-package/blue-search/assets/
 *   4. zips the plugin into release/blue-search-<version>.zip and
 *      release/blue-search.zip
 *   5. if the monorepo is configured (tools/config.js), hands the zip to
 *      gpt-chat, which serves it at
 *        https://blueboot.ai/assets/widget/wordpress/blue-search.zip
 *      along with blue-search-<version>.zip (rollback) and blue-search.json
 *      (version info for the console's install guide). It goes live with
 *      gpt-chat's own deploy: npm run deploy-ui.
 *
 * Options:
 *   --no-build   package the existing widget2/dist without rebuilding
 *
 * There is no update checker in the plugin: WordPress.org allows updates only
 * through its own system, so nothing here publishes an update manifest.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { execSync } = require("child_process");
const { projectRoot, monorepoRoot, gptChatWordpressAssets } = require("./config");

const pluginRoot = path.join(projectRoot, "widget-package", "blue-search");
const pluginAssets = path.join(pluginRoot, "assets");
const widget2Root = path.join(projectRoot, "widget2");
const widget2Dist = path.join(widget2Root, "dist");
const releaseDir = path.join(projectRoot, "release");

// What the plugin ships from the widget2 build. Not index.html (the local
// test page) or prerendered-routes.json; widget2 embeds its own images.
const WIDGET_FILES = ["main.js", "polyfills.js", "3rdpartylicenses.txt"];
const REQUIRED = ["main.js", "polyfills.js"];

// Files in the plugin folder that never go into the zip.
const ZIP_IGNORE = /(\.bak|\.DS_Store|Thumbs\.db)$/;

const PUBLIC_BASE_URL = "https://blueboot.ai/assets/widget/wordpress";
const KEEP_PINNED_ZIPS = 3;

const NO_BUILD = process.argv.includes("--no-build");

const exists = (p) => fs.existsSync(p);
const run = (cmd, cwd) => execSync(cmd, { stdio: "inherit", cwd, shell: true });

function readVersion() {
  const php = fs.readFileSync(path.join(pluginRoot, "blue-search.php"), "utf8");
  const readme = fs.readFileSync(path.join(pluginRoot, "readme.txt"), "utf8");
  const v = (php.match(/^[ \t\/*#@]*Version:\s*([0-9]+(?:\.[0-9]+){1,3})\s*$/mi) || [])[1];
  const tag = (readme.match(/^Stable tag:\s*([0-9]+(?:\.[0-9]+){1,3})\s*$/mi) || [])[1];
  if (!v) throw new Error('No "Version:" header in blue-search.php');
  if (!tag) throw new Error('No "Stable tag:" in readme.txt');
  if (v !== tag) {
    throw new Error(`Version mismatch: blue-search.php says ${v}, readme.txt Stable tag says ${tag}. Make them equal.`);
  }
  if (!new RegExp(`^= ${v.replace(/\./g, "\\.")} =\\s*$`, "m").test(readme)) {
    console.warn(`⚠️  readme.txt has no "= ${v} =" changelog entry.`);
  }
  return v;
}

function zipPlugin(zipPath) {
  let archiver;
  try { archiver = require("archiver"); }
  catch { throw new Error("archiver is not installed. Run `npm install` in this folder first."); }

  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    out.on("close", () => resolve(archive.pointer()));
    out.on("error", reject);
    archive.on("error", reject);
    archive.pipe(out);
    archive.directory(pluginRoot, "blue-search", (entry) => (ZIP_IGNORE.test(entry.name) ? false : entry));
    archive.finalize();
  });
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function handToGptChat(version, zipPath) {
  const root = monorepoRoot();
  if (!root) {
    console.log("ℹ️  Monorepo not configured (tools/config.js) — zip not copied to gpt-chat.");
    return;
  }
  const dir = gptChatWordpressAssets(root);
  if (!exists(path.dirname(dir))) {
    console.log(`ℹ️  No gpt-chat assets folder at ${path.dirname(dir)} — zip not copied.`);
    return;
  }
  await fsp.mkdir(dir, { recursive: true });
  await fsp.copyFile(zipPath, path.join(dir, "blue-search.zip"));
  await fsp.copyFile(zipPath, path.join(dir, `blue-search-${version}.zip`));
  const info = {
    name: "Blue Search",
    slug: "blue-search",
    version,
    download_url: `${PUBLIC_BASE_URL}/blue-search.zip`,
    last_updated: new Date().toISOString().slice(0, 10),
  };
  await fsp.writeFile(path.join(dir, "blue-search.json"), JSON.stringify(info, null, 2) + "\n");

  const pinned = (await fsp.readdir(dir))
    .map((n) => n.match(/^blue-search-(\d+(?:\.\d+)+)\.zip$/))
    .filter(Boolean).map((m) => m[1])
    .sort(compareVersions).reverse();
  for (const v of pinned.slice(KEEP_PINNED_ZIPS)) {
    await fsp.rm(path.join(dir, `blue-search-${v}.zip`), { force: true });
    console.log(`🧹 removed old pinned zip blue-search-${v}.zip`);
  }

  console.log(`✅ Copied to gpt-chat: ${dir}`);
  console.log("➡️  Make it live: cd <monorepo>/assist-app/gpt-chat && npm run deploy-ui");
}

(async () => {
  const version = readVersion();
  console.log(`=== Blue Search ${version}`);

  if (!exists(path.join(widget2Root, "package.json"))) {
    throw new Error("No ./widget2. Run `npm run sync-widget` first.");
  }

  if (!NO_BUILD) {
    if (!exists(path.join(widget2Root, "node_modules"))) {
      console.log("=== Installing widget2 dependencies (first run)...");
      run("npm install", widget2Root);
    }
    await fsp.rm(widget2Dist, { recursive: true, force: true });
    console.log("=== Building widget2...");
    run("npm run build", widget2Root);
  }
  for (const f of REQUIRED) {
    if (!exists(path.join(widget2Dist, f))) throw new Error(`widget2/dist/${f} is missing — build failed?`);
  }

  console.log("=== Copying the bundle into the plugin");
  await fsp.rm(pluginAssets, { recursive: true, force: true });
  await fsp.mkdir(pluginAssets, { recursive: true });
  for (const f of WIDGET_FILES) {
    const src = path.join(widget2Dist, f);
    if (exists(src)) await fsp.copyFile(src, path.join(pluginAssets, f));
  }

  await fsp.mkdir(releaseDir, { recursive: true });
  const zipPath = path.join(releaseDir, `blue-search-${version}.zip`);
  await fsp.rm(zipPath, { force: true });
  const bytes = await zipPlugin(zipPath);
  await fsp.copyFile(zipPath, path.join(releaseDir, "blue-search.zip"));
  console.log(`✅ ${path.relative(projectRoot, zipPath)} (${Math.round(bytes / 1024)} KB)`);

  await handToGptChat(version, zipPath);
  console.log("✅ Done.");
})().catch((e) => {
  console.error("\n❌ release failed:", e.message);
  process.exit(1);
});
