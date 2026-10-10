# Blue Search — WordPress plugin

Public source of the **Blue Search** WordPress plugin.

| Folder | What it is |
|---|---|
| `widget-package/blue-search/` | The WordPress plugin: PHP, `readme.txt`, `uninstall.php`. |
| `widget2/` | Source of the Angular chat widget the plugin bundles (`assets/main.js`, `assets/polyfills.js`). |
| `tools/` | The scripts below. |

## Build the plugin

```bash
npm install
npm run release
```

`release` checks that the plugin's `Version:` header matches `readme.txt`'s
`Stable tag:`, builds `widget2`, copies the bundle into the plugin, and writes
`release/blue-search-<version>.zip` (plus `release/blue-search.zip`). That zip
is what you upload to WordPress (Plugins → Add New → Upload Plugin) or submit
to WordPress.org.

`npm run release -- --no-build` packages the existing `widget2/dist` without
rebuilding.

## Where widget2 comes from

`widget2/` is a copy. The master lives in the private BlueBoot monorepo
(`assist-app/gpt-chat/src/app/widget2`), where the same widget is built for
https://blueboot.ai/assets/widget/latest/. Change widget2 there, not here.

To bring this copy up to date:

```bash
npm run sync-widget      # replace ./widget2 with the master (read-only on the monorepo)
git diff -- widget2      # review what changed
npm run release
```

or both in one go: `npm run update`.

The monorepo's location on your machine is read from `local.config.json`
(git-ignored):

```json
{ "monorepo": "~/Documents/bluesearch projects/prod recent" }
```

or from the `BLUESEARCH_MONOREPO` environment variable. When it is set,
`npm run release` also copies the zip into gpt-chat
(`src/assets/widget/wordpress/`), so the next `npm run deploy-ui` there
publishes it at https://blueboot.ai/assets/widget/wordpress/blue-search.zip.
Without it, everything else works the same: the zip stays in `release/`.

## Releasing a new version

1. Bump `Version:` in `widget-package/blue-search/blue-search.php` and
   `Stable tag:` in `readme.txt`, and add a `= x.y.z =` changelog entry.
2. `npm run update` (or `npm run release` if widget2 has not changed).
3. Install `release/blue-search.zip` on a test site and check the shortcodes.
4. Commit and push; submit to WordPress.org; deploy gpt-chat for the
   blueboot.ai download.

The plugin has no update checker of its own: WordPress.org allows updates only
through its own system.

## License

GPL-2.0-or-later.
