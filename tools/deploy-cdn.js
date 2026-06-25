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
  // Site:    blueboot-cdn (already in firebase.json)
  const FIREBASE_PROJECT_ID =
    process.env.FIREBASE_PROJECT_ID || "blueboot-prod";

  run(`npx firebase-tools deploy --only hosting --project ${FIREBASE_PROJECT_ID}`);

  console.log("✅ CDN deploy complete.");
} catch (e) {
  process.exit(e.status || 1);
}
