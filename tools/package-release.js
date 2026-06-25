/* Build Angular, update WP zip, and prepare Firebase CDN public folder (versioned + latest alias)
   FIXES:
   - Version is read from blue-search.php "Version:" header (NOT package.json)
   - ZIP name is blue-search-<version>.zip
   - Delete and exclude *.bak files (blue-search.php.bak etc.)
   - Copy lib/ folder to CDN targets (to include lib/plugin-update-checker/blue-search.json)
   - Prefer copying images from build output: <buildDir>/assets/img, fallback src/assets/img
   - ✅ NEW FIX: Update Plugin Update Checker manifest blue-search.json with the new VERSION + download_url
   - ✅ NEW FIX: Publish stable zip name to /blue-search/latest/blue-search.zip (clients + PUC)
*/

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { execSync } = require("child_process");
const archiver = require("archiver");

const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");

// WP plugin structure
const pluginRoot = path.join(projectRoot, "widget-package", "blue-search");
const pluginMainPhp = path.join(pluginRoot, "blue-search.php");
const pluginAssets = path.join(pluginRoot, "assets");
const pluginImg = path.join(pluginAssets, "img");
const pluginAssetsSubAssets = path.join(pluginAssets, "assets");
const pluginZipDir = path.join(projectRoot, "widget-package");

// ✅ lib folder source
const pluginLib = path.join(pluginRoot, "lib");

// ✅ Plugin Update Checker manifest path (inside plugin)
const pucManifestPath = path.join(
  pluginRoot,
  "lib",
  "plugin-update-checker",
  "blue-search.json"
);

// Firebase CDN structure (inside repo)
const cdnDeployRoot = path.join(projectRoot, "widget-package", "deploy", "cdn");
const cdnPublic = path.join(cdnDeployRoot, "public");

// Images source (fallback)
const srcImgDir = path.join(projectRoot, "src", "assets", "img");

// Keep these plugin files when cleaning WP plugin assets
const PRESERVE_FILE_NAMES = new Set(["blue-search.php", "readme.txt"]);

// --------------------------- helpers ---------------------------

async function ensureDir(d) {
  await fsp.mkdir(d, { recursive: true });
}

async function copyFile(src, dst) {
  await ensureDir(path.dirname(dst));
  await fsp.copyFile(src, dst);
}

async function copyDirRecursive(src, dst) {
  await ensureDir(dst);
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      await copyDirRecursive(s, d);
    } else {
      await copyFile(s, d);
    }
  }
}

async function fileExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

// ✅ Read plugin version from blue-search.php header
async function readVersionFromPhpHeader() {
  const content = await fsp.readFile(pluginMainPhp, "utf8");
  // Matches: Version:     1.0.12
  const m = content.match(/^[ \t\/*#@]*Version:\s*([0-9]+(?:\.[0-9]+){1,3})/mi);
  if (!m) {
    throw new Error(`Could not find "Version:" header in ${pluginMainPhp}`);
  }
  return m[1].trim();
}

// ✅ Delete *.bak in pluginRoot recursively (optional but helps)
async function deleteBakFilesUnder(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await deleteBakFilesUnder(full);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".bak")) {
      await fsp.rm(full, { force: true });
      console.log("🧹 Removed backup file:", full);
    }
  }
}

/**
 * ✅ Update Plugin Update Checker manifest (blue-search.json)
 * - Sets json.version to VERSION
 * - Sets json.download_url to the stable latest zip URL on your CDN
 */
async function updatePucManifest(VERSION) {
  if (!(await fileExists(pucManifestPath))) {
    console.warn("⚠️ PUC manifest not found, skipping:", pucManifestPath);
    return;
  }

  let json;
  try {
    const raw = await fsp.readFile(pucManifestPath, "utf8");
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to read/parse PUC manifest JSON at ${pucManifestPath}: ${e.message}`);
  }

  const downloadUrl = `https://blueboot-cdn.web.app/blue-search/latest/blue-search.zip`;

  json.version = VERSION;
  json.download_url = downloadUrl;

  await fsp.writeFile(pucManifestPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log("✅ Updated PUC manifest:", pucManifestPath);
  console.log("   - version:", VERSION);
  console.log("   - download_url:", downloadUrl);
}

/**
 * Find the real browser build dir.
 * Supports:
 *   dist/<project>/browser
 *   dist/<project>/browser/browser
 */
async function pickBuildDir() {
  const entries = await fsp.readdir(distRoot, { withFileTypes: true });
  const firstProj = entries.find((e) => e.isDirectory());
  if (!firstProj) throw new Error(`No project folder under ${distRoot}`);

  let dir = path.join(distRoot, firstProj.name);

  for (let depth = 0; depth < 4; depth++) {
    const ents = await fsp.readdir(dir, { withFileTypes: true });
    const hasIndex = ents.some((e) => e.isFile() && e.name === "index.html");
    const hasJs = ents.some((e) => e.isFile() && /\.m?js$/i.test(e.name));
    if (hasIndex || hasJs) return dir;

    const browserSub = ents.find(
      (e) => e.isDirectory() && e.name.toLowerCase() === "browser"
    );
    if (browserSub) {
      dir = path.join(dir, browserSub.name);
      continue;
    }
    return dir;
  }
  return dir;
}

/**
 * Clean old build output from WP plugin assets but keep plugin files
 * (blue-search.php, readme.txt).
 */
async function cleanPluginAssets() {
  await ensureDir(pluginAssets);
  const entries = await fsp.readdir(pluginAssets, { withFileTypes: true });

  for (const e of entries) {
    const full = path.join(pluginAssets, e.name);

    if (e.isDirectory()) {
      await fsp.rm(full, { recursive: true, force: true });
    } else if (!PRESERVE_FILE_NAMES.has(e.name)) {
      await fsp.rm(full, { force: true });
    }
  }
}

/**
 * Copy images from build output: <buildDir>/assets/img (preferred)
 * Fallback to src/assets/img
 */
async function copyImagesPreferred(buildDir, dstImgFolder) {
  const buildImgDir = path.join(buildDir, "assets", "img");

  if (await fileExists(buildImgDir)) {
    await copyDirRecursive(buildImgDir, dstImgFolder);
    return;
  }

  if (await fileExists(srcImgDir)) {
    await copyDirRecursive(srcImgDir, dstImgFolder);
    return;
  }

  console.warn("No images found in build/assets/img or src/assets/img. Skipping img copy.");
}

/**
 * Zip the blue-search folder into blue-search-<VERSION>.zip
 * Excludes *.bak files even if they exist.
 */
async function zipBlueSearchFolder(pluginZip) {
  await fsp.rm(pluginZip, { force: true });
  await ensureDir(path.dirname(pluginZip));

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(pluginZip);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(`Created zip: ${pluginZip} (${archive.pointer()} bytes)`);
      resolve();
    });

    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);

    // ✅ Include folder as "blue-search" root, but ignore .bak files
    archive.directory(pluginRoot, "blue-search", {
      ignore: ["**/*.bak"],
    });

    archive.finalize();
  });
}

/**
 * Build a CDN target folder:
 * - copies build into assets/
 * - copies php/readme into root
 * - copies lib/ into root
 * - copies zip into root
 */
async function buildCdnTarget(
  targetRoot,
  targetAssets,
  targetZip,
  targetPhp,
  targetReadme,
  buildDir,
  pluginZip
) {
  console.log("=== Prepare CDN target:", targetRoot);
  await fsp.rm(targetRoot, { recursive: true, force: true });
  await ensureDir(targetAssets);

  console.log("=== Copy build ->", targetAssets);
  await copyDirRecursive(buildDir, targetAssets);

  // Remove nested assets/assets if it appears
  await fsp.rm(path.join(targetAssets, "assets"), { recursive: true, force: true });

  console.log("=== Copy images ->", path.join(targetAssets, "img"));
  await copyImagesPreferred(buildDir, path.join(targetAssets, "img"));

  console.log("=== Copy php/readme ->", targetRoot);
  await copyFile(path.join(pluginRoot, "blue-search.php"), targetPhp);
  await copyFile(path.join(pluginRoot, "readme.txt"), targetReadme);

  // ✅ Copy lib folder into CDN targetRoot
  const targetLib = path.join(targetRoot, "lib");
  console.log("=== Copy lib ->", targetLib);
  await copyDirRecursive(pluginLib, targetLib);

  // ✅ Copy zip
  console.log("=== Copy zip ->", targetZip);
  await copyFile(pluginZip, targetZip);

  // ✅ Safety: remove any .bak that could have been copied by accident
  await deleteBakFilesUnder(targetRoot);
}

(async () => {
  // 0) Remove any .bak files under pluginRoot before doing anything
  await deleteBakFilesUnder(pluginRoot);

  // 1) Read version from blue-search.php
  const VERSION = await readVersionFromPhpHeader();
  console.log("=== Release version (from blue-search.php):", VERSION);

  // ✅ Update PUC manifest to match VERSION (so WP can see updates)
  await updatePucManifest(VERSION);

  const pluginZip = path.join(pluginZipDir, `blue-search-${VERSION}.zip`);

  // CDN paths based on version
  const cdnVersionRoot = path.join(cdnPublic, "blue-search", VERSION);
  const cdnVersionAssets = path.join(cdnVersionRoot, "assets");
  const cdnVersionZip = path.join(cdnVersionRoot, `blue-search-${VERSION}.zip`);
  const cdnVersionPhpFile = path.join(cdnVersionRoot, "blue-search.php");
  const cdnVersionReadmeFile = path.join(cdnVersionRoot, "readme.txt");

  const cdnLatestRoot = path.join(cdnPublic, "blue-search", "latest");
  const cdnLatestAssets = path.join(cdnLatestRoot, "assets");
  const cdnLatestZip = path.join(cdnLatestRoot, `blue-search-${VERSION}.zip`);
  const cdnLatestZipStable = path.join(cdnLatestRoot, "blue-search.zip");
  const cdnLatestPhpFile = path.join(cdnLatestRoot, "blue-search.php");
  const cdnLatestReadmeFile = path.join(cdnLatestRoot, "readme.txt");

  // 2) Build Angular
  console.log("=== Running ng build...");
  execSync("npm run build", { stdio: "inherit", cwd: projectRoot });

  // 3) Find build dir
  const buildDir = await pickBuildDir();
  console.log("=== Build dir:", buildDir);

  // 4) Update WP plugin assets so the zip is correct
  await ensureDir(pluginRoot);
  await ensureDir(pluginAssets);
  await cleanPluginAssets();

  console.log("=== Copy build -> WP plugin assets");
  await copyDirRecursive(buildDir, pluginAssets);

  // Remove nested assets/assets if it appears
  await fsp.rm(pluginAssetsSubAssets, { recursive: true, force: true });

  // Copy images into WP plugin assets/img
  console.log("=== Copy images -> WP assets/img (prefer build output)");
  await copyImagesPreferred(buildDir, pluginImg);

  // 5) Create WP zip (named blue-search-<VERSION>.zip), excluding *.bak
  console.log("=== Create WP zip");
  await zipBlueSearchFolder(pluginZip);
  console.log("✅ WP zip ready:", pluginZip);

  // 6) Build CDN target: versioned
  await buildCdnTarget(
    cdnVersionRoot,
    cdnVersionAssets,
    cdnVersionZip,
    cdnVersionPhpFile,
    cdnVersionReadmeFile,
    buildDir,
    pluginZip
  );

  // 7) Build CDN target: latest alias (versioned name inside latest/)
  await buildCdnTarget(
    cdnLatestRoot,
    cdnLatestAssets,
    cdnLatestZip,
    cdnLatestPhpFile,
    cdnLatestReadmeFile,
    buildDir,
    pluginZip
  );

  // ✅ Also publish stable name inside latest/: /blue-search/latest/blue-search.zip
  await copyFile(pluginZip, cdnLatestZipStable);
  console.log("✅ CDN stable latest zip ready:", cdnLatestZipStable);

  console.log("✅ CDN version ready:", cdnVersionRoot);
  console.log("✅ CDN latest ready:", cdnLatestRoot);
  console.log("✅ Package step complete.");
})().catch((e) => {
  console.error("package-release failed:", e);
  process.exit(1);
});
