/* Makes sure @angular/elements is installed, at the exact version the Angular
 * already present is on, before the build runs.
 *
 * WHY THIS EXISTS. widget2 is normally compiled as part of a host app, and a
 * host has no reason to depend on @angular/elements — gpt-chat does not, and
 * excludes elements.ts from its own compile for that reason. The package is
 * needed only by widget2's standalone build, which is occasional, so the
 * install is exactly the step someone rediscovers at the worst moment: cutting
 * a production bundle.
 *
 * TWO THINGS IT GETS RIGHT THAT A REMEMBERED COMMAND DOES NOT.
 *
 * The VERSION. Angular's packages peer-depend on the exact patch of
 * @angular/core, not a range, so `@angular/elements@^19.2.0` resolves to the
 * newest 19.2.x and then demands a core to match. Pinned by hand it goes stale
 * the day Angular is bumped. Read from the installed core, it cannot.
 *
 * The PLACE. It installs into whichever package owns the Angular being used —
 * the host app when widget2 is nested inside one, widget2 itself when it has
 * been copied out on its own. Node resolution decides that, not a hardcoded
 * path.
 *
 * --legacy-peer-deps is passed because the host tree may carry unrelated peer
 * conflicts of its own (gpt-chat's @angular/fire wants firebase-tools ^13 and
 * has ^15) that have nothing to do with this package and must not block it.
 * The constraint that does matter — elements against core — is satisfied by
 * the version literal above, not by the peer check being on.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

/** A package's own package.json, resolved the way an import here would, or
 *  null when it is not installed anywhere up the tree. */
function manifestOf(name) {
  try {
    return require.resolve(`${name}/package.json`, { paths: [__dirname] });
  } catch {
    return null;
  }
}

const corePath = manifestOf('@angular/core');

if (!corePath) {
  console.error(
    '\n@angular/core is not installed anywhere reachable from widget2.\n' +
    'Run `npm install` here to build this folder on its own, or build it\n' +
    'from inside a host app that has Angular.\n'
  );
  process.exit(1);
}

const coreVersion = require(corePath).version;

// .../node_modules/@angular/core/package.json → the package that owns it.
const owner = path.resolve(path.dirname(corePath), '..', '..', '..');

const elementsPath = manifestOf('@angular/elements');
const elementsVersion = elementsPath ? require(elementsPath).version : null;

if (elementsVersion === coreVersion) process.exit(0);

console.log(
  elementsVersion
    // A mismatch is worth naming rather than silently corrected: it means
    // Angular moved and this is catching up, which is useful to see in a log.
    ? `@angular/elements ${elementsVersion} does not match @angular/core ${coreVersion} — reinstalling.`
    : `@angular/elements is missing — installing ${coreVersion} into ${owner}.`
);

const result = spawnSync(
  'npm',
  ['install', `@angular/elements@${coreVersion}`, '--legacy-peer-deps'],
  {
    cwd: owner,
    stdio: 'inherit',
    // Since CVE-2024-27980, Node will not spawn a .cmd shim without this, and
    // npm on Windows is a .cmd.
    shell: process.platform === 'win32',
  }
);

if (result.status !== 0) {
  console.error('\nInstalling @angular/elements failed. See the npm output above.\n');
  process.exit(result.status ?? 1);
}
