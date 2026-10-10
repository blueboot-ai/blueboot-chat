# widget2

Angular chat-widget module. Lives inside a host app's `src/app/` tree (in
this repo, `gpt-chat`) but is copied into other repos from time to time, so
it carries its own `package.json` and `tsconfig.json` to install and
type-check on its own before being wired into whichever host app it lands
in.

## Dependencies

Everything widget2 imports from npm, pinned to the versions used here in
`gpt-chat`:

- `@angular/common`, `@angular/core`, `@angular/forms` — Angular itself.
- `rxjs` — observables used throughout the services layer.
- `ngx-markdown` — renders markdown message content.
- `tslib` — the helpers TypeScript emits with `importHelpers`.

Needed only by the standalone bundle, never by a host app compiling this
code: `@angular/elements` (the custom-element wrapper), `@angular/compiler`
and `@angular/platform-browser` (`createApplication` at runtime), `zone.js`
(shipped as `polyfills.js`), and the build tooling — `@angular/cli`,
`@angular-devkit/build-angular`, `@angular/compiler-cli`, `typescript`.

As of this writing, widget2 no longer needs `shared-library` — see
`shared/README.md`, which holds standalone copies of the few symbols it used
to import from there.

## `environment/` — a local copy, kept in sync by a build script

`core/settings.ts` used to import two files from outside widget2's own tree
(`../../../environments/environment` and `../../../environments/env.common`
— Angular CLI's environment-file convention, resolving to
`src/environments/*.ts` in the host app). It now imports both `environment`
and `backendUrl` from a single local file, `./environment/environment`.

One tradeoff worth knowing: the host app's real `environment.ts` is swapped
at build time (dev vs `--configuration production`) via `angular.json`
fileReplacements, so the backend URL used to depend on which configuration
built it. The local copy under `widget2/environment/` is a single fixed
value — the production backend URL — since widget2 is the customer-facing
embed and a host that needs a different backend already has the normal
override path (`Settings.setBackendUrl` / the widget's `envurl` attribute).
`environment` and `backendUrl` started as two separate exports (one per host
file) but both ended up pinned to that same value, so they were merged into
one file with one underlying constant — see the comments in
`environment/environment.ts` for the full reasoning, and for what was left
out (only `publicApiUrl` is used anywhere in widget2 — not `firebaseConfig`,
`apiUrl`, etc.).

Unlike `shared/`, this one copy doesn't have to be refreshed by hand: `../
../update-widget-env.js` (`gpt-chat/update-widget-env.js`) reads
`backendUrl.publicApiUrl` straight out of `src/environments/env.common.ts`
and rewrites `PUBLIC_API_URL` in `environment/environment.ts` to match. It's
wired into the `copy-build` npm script, so it runs automatically on
`npm run start`, `start-prod` and `build` — the same lifecycle point that
already syncs `shared-library` into every consuming service. (`build-clean`
and `watch` skip `copy-build` entirely, same pre-existing gap as the
shared-library sync — nothing new there.) If `env.common.ts` ever renames or
removes `publicApiUrl`, the script throws loudly at build time instead of
silently leaving widget2 with a stale URL.

## Two ways this folder is used

**Inside a host app.** The normal case, and what `gpt-chat` does: the
components are imported directly by selector, compiled as part of the host's
build, and `elements.ts` is never loaded. `gpt-chat/tsconfig.app.json`
explicitly excludes that file — see the comment there for why.

**On its own**, as a distribution bundle. `npm run build` produces the two
scripts a customer's page loads. This is the short, simple route: no separate
repo, no copy step, and the bundle is built from the same files the console
runs.

### Type-checking only

```
npm run typecheck
```

`tsc --noEmit`, matching how `gpt-chat` verifies this code
(`npx tsc -p tsconfig.app.json --noEmit`). Cheap, and it does not run
Angular's template compiler. Because `shared/` and `environment/` are local,
it succeeds with nothing outside this folder.

### Building the bundle

```
npm run build
```

No `npm install` step when widget2 sits inside a host app that already has
Angular — resolution walks up and finds it, and `ensure-elements.js` (wired in
as `prebuild`) installs the one package a host has no reason to carry:
`@angular/elements`, at the exact version the installed `@angular/core` is on,
into whichever package owns that Angular. Copied out on its own, widget2 needs
its own `npm install` first, and the same script then installs into this
folder.

That script is there so cutting a production bundle does not depend on someone
remembering a command. It pins the version by reading it rather than by
hardcoding, because Angular's packages peer-depend on the exact patch of
`@angular/core` — a literal goes stale the day Angular is bumped — and it
passes `--legacy-peer-deps` so an unrelated peer conflict in the host tree
cannot block it (gpt-chat has one today: `@angular/fire` wants
`firebase-tools@^13`, the repo has `^15`).

`ng build --configuration production`, via this folder's own `angular.json`
and `tsconfig.app.json`, entered at `elements.ts`. Output lands in `dist/`:

- `main.js` — the widget and all four custom elements
- `polyfills.js` — zone.js
- `INSTALL.md` — copied in as an asset, so the folder is the whole handover

`build-install-doc.js` runs as `prebuild` and writes the real host into
**`INSTALL.md` here in the source**, before the asset copy picks it up. So the
file in the repo and the file a customer receives are the same file and cannot
disagree, and the doc is correct even for someone reading it without having
built anything.

The host comes from `WIDGET_APP_URL` if set, otherwise `appUrl` in
`src/environments/env.common.ts`, which `sync-env-secrets.js` keeps in step
with `blueboot.secrets.ts`. Found nowhere — widget2 copied into another repo,
say — the file is left exactly as it is and the build says so, rather than
failing a bundle that is otherwise fine.

It rewrites the **host position** in the widget URLs rather than a one-time
placeholder. Replacing `YOUR-ASSISTANT-HOST` would work once and then have
nothing to match, freezing the address at whatever it was the first time —
which is the drift this is meant to prevent. Matching the position means
running it twice is the same as running it once, and a changed `appUrl` is
picked up.

`outputPath` is the object form with `"browser": ""`. Left as a plain string,
the application builder puts everything under `dist/browser/`, which is right
for an app being deployed and wrong for a folder someone zips and sends: the
three files that make up the delivery should be the three files in it.

**`outputHashing` is `none`, and it has to stay that way.** The published
install guide sends hosts to `.../assets/polyfills.js` and `.../assets/main.js`
at fixed paths. Hashed filenames are the right default for an app the build
also writes an `index.html` for; here they would break every snippet already
pasted into a customer's site.

`index.html` is a local test page for `npm start` and is not part of what
ships — a customer's page supplies its own HTML and loads the two scripts.

### Serving it from the console's own domain

```
npm run publish
```

`build` followed by `publish-to-assets.js`, which copies `dist/` into
`gpt-chat/src/assets/widget/latest/`. The files are then ordinary static assets
and go out with the next gpt-chat deploy, served at
`/assets/widget/latest/main.js`.

This is an **option, not the distribution plan**. It is the short route — one
deploy, no CDN, no second host — and it suits a pilot, a handful of installs,
or showing a customer the thing working. Every widget load is a request to the
app's own hosting, so it is not the answer at volume.

The target is replaced rather than merged, so a file an earlier build emitted
and this one did not cannot linger and keep being served. And `latest` is a
name, not a version: copying over it changes the widget for every site pointing
there. For a customer who must not move until you say so, copy to a pinned
folder beside it and give them that path.

`INSTALL.md` is the instructions to hand over with the two files: it is written
for someone putting the widget on a site they run, not for anyone working in
this repo. Ship it alongside the bundle.

---

## The arrangements and the tags

One component renders every embedded arrangement. `EmbedComponent`
(`embed/embed.component.ts`) holds the whole widget — the input, the
conversation, the floating window, the icon — and a single `startmode` decides
which of them a host page gets.

There are **four** arrangements in the product and **three** of them are
embeds. The fourth, the corner Chat button, is `LauncherComponent` in
`launcher/`, a different component with its own element.

### The mapping, and the one name that does not match

The documentation (`assets/help-md/*/install-guide.md`, "Four ways the widget
can appear") is what customers read, and it uses its own words. Both columns
are correct; they are simply written for different readers.

| Docs call it | Mode value | Tag | What it is |
|---|---|---|---|
| **Search box** | `inline` | `<blue-search-embed>` | A plain input in the flow of the page. The conversation opens *over* the content below and the input's space is held, so the page does not reflow. The default, and the arrangement a host gets with no `startmode` at all. |
| **Icon** | `icon` | `<blue-search-embed-icon>` | A mark with the assistant's name for a host's own header: no box, no border, no wider than its words. The panel floats; the mark does not move. |
| **Popup** | `popup` | `<blue-search-embed-popup>` | Already open, no layout of its own, on screen for as long as the host keeps the element. |
| **Docked** | `docked` | `<blue-search-embed-docked>` | Popup, in the flow instead of over it. Takes real space and pushes the page down as the conversation grows; the host caps it with a `height` in its own CSS. No Hide button — there is nothing to collapse to. |
| **Chat button** | — | `<blue-search-launcher>` | The round corner button. Not an embed mode — see `launcher/`. |

The Search box keeps the bare `<blue-search-embed>` rather than taking an
`-inline` suffix like its siblings. That name is the legacy one — it is in
customer pages, WordPress shortcodes and published guides — and the default
arrangement keeps it. `EmbedInlineComponent` is the class behind that selector;
`EmbedComponent` itself answers to `blue-search-embed-base`, so the two do not
collide.

**`popup` still points the wrong way, and now the docs say it too.** The guide
called this arrangement *Panel* and the mode value was `popup`; the two names
have been made one, so both now say popup. The word is still misleading — a
"popup" sounds like something that opens on a click, and this one is open from
the start. What *does* open on interaction is the Search box. If you are reading
an old bug report that says "panel", it means this arrangement.

`startmode="panel"` is not accepted — `normalizeStartMode()` maps anything it
does not recognise to `inline`, so a host that writes the documented word gets
the default rather than an error. That is deliberate (a typo leaves a working
widget), and it is also why the per-mode tags exist.

### Popup and Docked are one arrangement with one difference

Both open the moment the element exists, neither has a collapsed form, and
neither shows a Hide button. The only difference is geometry, and it is one CSS
class: `.is-overlay` takes the panel out of the flow (absolute, full width of
the slot, capped against the viewport) so the host page never moves;
`.is-docked` leaves it in the flow so the page moves around it.

That is why `isOverlay` still means "the panel is open" everywhere in the
component — all nine template gates and eleven TS uses want that question — and
only the class binding asks which of the two it is:

```html
[class.is-overlay]="isOverlay && !isDocked"
[class.is-docked]="isOverlay && isDocked"
```

Three predicates carry the rest, and they exist because the answers stopped
coinciding when Docked arrived:

| Predicate | True for | What it decides |
|---|---|---|
| `floatsWhenOpen` | popup, icon | Placement, drag and resize |
| `collapsesToSomething` | inline, icon | Whether the Hide button exists, whether host navigation and "New chat" collapse the panel, whether a spacer holds its place |
| `opensOnLoad` | popup, docked | Open without waiting for a visitor or a stored flag |

`collapsesToSomething` is the one that was a bug waiting to happen. Two guards
(`onHostNavigated`, `newConversation`) used `!floatsWhenOpen`, which was the
same answer only while popup was the only mode with nothing to collapse to.
Docked does not float and has nothing to collapse to either, so both would have
emptied the host element with no way to bring it back.

### Why the wrappers

A host page can always write `<blue-search-embed startmode="icon">`. The
wrappers (`embed/embed-inline`, `embed-popup`, `embed-icon`, `embed-docked`) let it write
`<blue-search-embed-icon>` instead. The difference is failure mode: a
misspelled attribute silently falls back to the Search box —
`normalizeStartMode()` was written because that happens — while a misspelled
tag renders nothing and is noticed immediately.

They add no behaviour. Each is about fifteen lines.

### How they work, and the two rules

Each wrapper subclasses `EmbedComponent` and overrides **both halves** of the
`startMode` accessor: the getter answers a constant, and the setter ignores
what it is given, because `<blue-search-embed-icon startmode="popup">` is a
contradiction and the tag is the more explicit of the two. Overriding the
getter as well keeps the parent's private `startModeValue` out of the picture,
so there is no second place holding the mode.

**Never declare an `@Input` on a wrapper.** Angular merges input metadata down
the prototype chain; an input added there is permanent for that subclass and
invisible from the others. Everything a host can set is declared once on
`EmbedComponent` and inherited. The same warning sits at the top of
`embed.component.ts` about `ChatCoreComponent`, one level up.

**Never repeat the imports list.** `@Component` is not inherited, so each
wrapper repeats the decorator — but the `imports` array is the shared
`EMBED_VIEW_IMPORTS`, exported from `embed.component.ts`. Four hand-written
copies would be four chances to add a child component and have three
arrangements fail to render it, in whichever mode nobody opened while testing.

Everything else — template, styles, shadow root — is the same file in all four
decorators, so there is exactly one view.

### `blue-search-embed` is fixed — and `startmode` on it is the open question

The default tag keeps its name for legacy reasons: it is in customer pages, in
WordPress shortcodes, in published install guides, and in CDN snippets nobody
controls. Never rename it, and never let an arrangement other than the Search
box answer to it.

Inside this app that selector belongs to `EmbedInlineComponent`, which **pins**
the mode — so `startmode` does nothing on it here. That matters for one case
and only one: an existing install writing `<blue-search-embed startmode="icon">`
or `startmode="popup"`. Under a pinned component those render as a Search box.
No error, no missing element, just the wrong arrangement on somebody else's
site.

Which behaviour customers get is decided by `elements.ts`, not by the selector:

- register **`EmbedComponent`** as `blue-search-embed` — the attribute keeps
  working, and old installs are unaffected. This is what ships today.
- register **`EmbedInlineComponent`** — the tag means Search box and nothing
  else, and any `startmode` in the wild is ignored.

Do not make that choice by accident. If the attribute is ever dropped, the
published guides have to change first, and the old spelling has to keep working
for as long as those pages are out there.

One caution if you are looking at another repo's registration: `blueboot-chat`
has an `elements.ts` of its own, importing an `EmbedComponent` from its own
`src/app/embed/` — a much older file that is not widget2. It is a generation
behind. Do not treat it as the definition of these tags.

### When you add an arrangement

1. Add the value to `EmbedStartMode` and to `normalizeStartMode()` in
   `embed/embed.component.ts`.
2. Add a wrapper in `embed/`, copying an existing one.
3. Add the tag to `elements.ts`.
4. Update the table above, the "Four ways" section of `install-guide.md`, and
   its 17 translations.

Step 4 is the one that gets skipped, and the table above is worth nothing the
first time it is wrong.
