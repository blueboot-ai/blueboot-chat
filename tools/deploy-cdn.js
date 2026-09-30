// tools/deploy-cdn.js
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const cdnDeployRoot = path.join(projectRoot, "widget-package", "deploy", "cdn");

function run(cmd) {
  execSync(cmd, { stdio: "inherit", cwd: cdnDeployRoot, shell: true });
}

try {
  const firebaseJson = path.join(cdnDeployRoot, "firebase.json");
  if (!fs.existsSync(firebaseJson)) {
    throw new Error(`firebase.json not found in: ${cdnDeployRoot}`);
  }

  // ✅ IMPORTANT: Firebase PROJECT ID (from console URL)
  // Project: blueboot-prod
  //
  // Site:    blueboot-wporg-cdn (in firebase.json)
  //
  // -- OLD site, DO NOT deploy this repo's build there --
  // Site:    blueboot-cdn  (https://blueboot-cdn.web.app)
  // This is the CDN that DEV/PROD's blue-search.php still polls for
  // auto-updates (the self-update block + plugin-update-checker library,
  // deliberately NOT present in this public/WordPress.org repo's build).
  // Deploying this repo's clean build there would 404 the manifest at
  // /blue-search/latest/lib/plugin-update-checker/blue-search.json and
  // silently break update checks for every already-installed client that
  // still has the old self-updater. Left here as a comment (not deleted)
  // in case the DEV/PROD side of the CDN deploy is ever needed from this
  // script again -- but keep it pointed at its OWN site, never this one.
  //
  // One-time setup before this script's target site works:
  //   npx firebase-tools hosting:sites:create blueboot-wporg-cdn --project blueboot-prod
  const FIREBASE_PROJECT_ID =
    process.env.FIREBASE_PROJECT_ID || "blueboot-prod";

  run(`npx firebase-tools deploy --only hosting --project ${FIREBASE_PROJECT_ID}`);

  console.log("✅ CDN deploy complete.");
} catch (e) {
  process.exit(e.status || 1);
}
