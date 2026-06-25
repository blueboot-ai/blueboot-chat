/* Copy Angular build into widget-package/blue-search/assets and zip it (Win+Mac) */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const archiver = require("archiver");

const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");

// WP plugin structure in this repo
const pluginRoot = path.join(projectRoot, "widget-package", "blue-search");
const pluginAssets = path.join(pluginRoot, "assets");
const pluginImg = path.join(pluginAssets, "img");

// Sometimes Angular ends up nesting assets/assets
const pluginAssetsSubAssets = path.join(pluginAssets, "assets");

// Zip file next to blue-search folder
const pluginZip = path.join(projectRoot, "widget-package", "blue-search.zip");

// Prefer images from build output, fallback to src/assets/img
const srcImgDir = path.join(projectRoot, "src", "assets", "img");

const PRESERVE_FILE_NAMES = new Set(["blue-search.php", "readme.txt"]);
const SKIP_NAMES = new Set([".DS_Store", "Thumbs.db"]);

async function ensureDir(d) {
  await fsp.mkdir(d, { recursive: true });
}
async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function looksLikeBuild(dir) {
  if (!(await exists(dir))) return false;
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  const hasIndex = ents.some((e) => e.isFile() && e.name === "index.html");
  const hasJs = ents.some((e) => e.isFile() && /\.m?js$/i.test(e.name));
  return hasIndex || hasJs;
}

/**
 * Cross-platform build dir detection.
 * ✅ Prefer dist/<project>/browser if it's a real build
 * ✅ Else dist/<project>/browser/browser (only if that one is a real build)
 * ✅ Else dist/<project> if it's a real build
 * ✅ Else throw (better than copying wrong folder)
 */
async function pickBuildDir() {
  if (!(await exists(distRoot))) throw new Error(`dist folder not found: ${distRoot}`);

  const entries = await fsp.readdir(distRoot, { withFileTypes: true });
  const proj = entries.find((e) => e.isDirectory());
  if (!proj) throw new Error(`No project folder under ${distRoot}`);

  const projDir = path.join(distRoot, proj.name);

  const a = path.join(projDir, "browser");
  const b = path.join(a, "browser");

  if (await looksLikeBuild(a)) return a;
  if (await looksLikeBuild(b)) return b;
  if (await looksLikeBuild(projDir)) return projDir;

  throw new Error(`Could not locate Angular build output under: ${projDir}`);
}

async function copyDirRecursive(src, dst) {
  // Fast path (Node 16+)
  if (typeof fsp.cp === "function") {
    await ensureDir(dst);
    await fsp.cp(src, dst, {
      recursive: true,
      force: true,
      dereference: true,
      filter: (source) => !SKIP_NAMES.has(path.basename(source)),
    });
    return;
  }

  // Fallback
  await ensureDir(dst);
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_NAMES.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);

    if (e.isDirectory()) {
      await copyDirRecursive(s, d);
    } else if (e.isSymbolicLink()) {
      const real = await fsp.realpath(s);
      const st = await fsp.stat(real);
      if (st.isDirectory()) await copyDirRecursive(real, d);
      else {
        await ensureDir(path.dirname(d));
        await fsp.copyFile(real, d);
      }
    } else {
      await ensureDir(path.dirname(d));
      await fsp.copyFile(s, d);
    }
  }
}

async function cleanPluginAssets() {
  await ensureDir(pluginAssets);
  const entries = await fsp.readdir(pluginAssets, { withFileTypes: true });

  for (const e of entries) {
    const full = path.join(pluginAssets, e.name);

    if (SKIP_NAMES.has(e.name)) {
      await fsp.rm(full, { force: true, recursive: true });
      continue;
    }

    if (e.isDirectory()) {
      await fsp.rm(full, { recursive: true, force: true });
    } else if (!PRESERVE_FILE_NAMES.has(e.name)) {
      await fsp.rm(full, { force: true });
    }
  }
}

async function zipBlueSearchFolder() {
  await ensureDir(path.dirname(pluginZip));
  await fsp.rm(pluginZip, { force: true });

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

    archive.directory(pluginRoot, false, (entry) => {
      const base = path.basename(entry.name);
      if (SKIP_NAMES.has(base)) return false;
      return entry;
    });

    archive.finalize().catch(reject);
  });
}

(async () => {
  try {
    const buildDir = await pickBuildDir();
    console.log("Output location:", buildDir);

    // Prefer copying images from build output if present
    const buildImgDir = path.join(buildDir, "assets", "img");

    await ensureDir(pluginRoot);
    await ensureDir(pluginAssets);
    await cleanPluginAssets();

    console.log("Copying build -> plugin assets...");
    await copyDirRecursive(buildDir, pluginAssets);

    // Remove nested assets/assets if it exists
    await fsp.rm(pluginAssetsSubAssets, { recursive: true, force: true });

    // Images
    if (await exists(buildImgDir)) {
      console.log("Copying build assets/img -> plugin assets/img ...");
      await copyDirRecursive(buildImgDir, pluginImg);
    } else if (await exists(srcImgDir)) {
      console.log("Copying src/assets/img -> plugin assets/img ...");
      await copyDirRecursive(srcImgDir, pluginImg);
    } else {
      console.warn("No img folder found (build or src).");
    }

    console.log("Zipping blue-search folder...");
    await zipBlueSearchFolder();

    console.log("WP deploy assets updated ✅");
  } catch (e) {
    console.error("deploy-wp failed:", e);
    process.exit(1);
  }
})();
