/* Where the private monorepo is on this machine, for the two steps that touch
 * it: copying widget2 in (sync-widget2.js) and handing the finished zip to
 * gpt-chat (package-release.js). Neither is needed to build the plugin.
 *
 * Read from, in order:
 *   1. the BLUESEARCH_MONOREPO environment variable
 *   2. local.config.json in this folder: { "monorepo": "/path/to/prod recent" }
 *      (git-ignored: it is a path on your machine, not part of the project)
 *
 * Returns null when neither is set or the path does not exist.
 */
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function monorepoRoot() {
  let p = process.env.BLUESEARCH_MONOREPO || "";
  if (!p) {
    const cfg = path.join(projectRoot, "local.config.json");
    if (fs.existsSync(cfg)) {
      try { p = JSON.parse(fs.readFileSync(cfg, "utf8")).monorepo || ""; }
      catch (e) { throw new Error(`local.config.json is not valid JSON: ${e.message}`); }
    }
  }
  if (!p) return null;
  p = path.resolve(projectRoot, p.replace(/^~(?=$|\/)/, require("os").homedir()));
  return fs.existsSync(p) ? p : null;
}

module.exports = {
  projectRoot,
  monorepoRoot,
  widget2InMonorepo: (root) => path.join(root, "assist-app", "gpt-chat", "src", "app", "widget2"),
  gptChatWordpressAssets: (root) => path.join(root, "assist-app", "gpt-chat", "src", "assets", "widget", "wordpress"),
};
