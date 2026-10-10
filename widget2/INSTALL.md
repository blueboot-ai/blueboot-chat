# Installing the widget on a site

For someone putting the widget on a website they run. No Node, no npm, no build
step: two script tags and one element.

This file covers a **self-hosted** bundle — the two files `npm run build`
produces in `dist/`. If you are serving from the hosted CDN instead, the
addresses are in the product's own install guide; everything else below is the
same.

---

## If you were given a web address instead of files

You may have been pointed at an address rather than sent the files — something
like:

```
https://blueboot.ai/assets/widget/latest/polyfills.js
https://blueboot.ai/assets/widget/latest/main.js
```

Then there is nothing to host. Skip to step 2 and use those two addresses as
the `src` values. Everything after that is identical.

Two things to know if you take this route. **`latest` means latest**: the
widget updates when the people running it publish a new one, without you doing
anything, which is usually what you want and is worth being aware of. And the
files come from that host rather than from a content network, so if your site
serves a great deal of traffic, ask them for a hosted address instead.

---

## 1. Put the two files somewhere your site serves

```
main.js
polyfills.js
```

Anywhere your site serves static files — `/assets/`, `/js/`, a CDN, an S3
bucket. They must be served as JavaScript (`Content-Type:
text/javascript`), which every normal web server does on its own.

Keep them **together and under the names they were built with**. The scripts
are referenced by path from every page you install them on, so a rename means
editing every one of those pages.

## 2. Load them

Anywhere in the page — `<head>` or the end of `<body>`, it makes no
difference:

```html
<script type="module" defer src="/assets/polyfills.js"></script>
<script type="module" defer src="/assets/main.js"></script>
```

`type="module"` and `defer` both matter. The bundle is an ES module, and
`defer` keeps it from blocking the page while it downloads — the widget does
not need to run before your content does.

Order does not matter and neither does duplication: if two parts of your site
both add these tags, the widget notices and the second copy quietly does
nothing rather than failing.

## 3. Put the widget where you want it

One element, with your app id:

```html
<blue-search-embed appid="YOUR_APP_ID"></blue-search-embed>
```

That is the whole install.

---

## Choosing the arrangement

Five to pick from. They are different tags, not settings:

| Tag | What the visitor sees |
|---|---|
| `<blue-search-embed>` | **Search box.** A plain input in the flow of your page, like your own search field. The conversation opens over the content below, and the input's space is held so nothing jumps. |
| `<blue-search-embed-icon>` | **Icon.** A small mark with the assistant's name, for your header or menu bar. No box, no border, no wider than its own words. The panel floats; the mark stays put. |
| `<blue-search-embed-popup>` | **Popup.** Already open when the page loads, over the content below and contributing no layout of its own, so your page never moves. Your page decides when it is on screen. |
| `<blue-search-embed-docked>` | **Docked.** The same open panel, but part of your page instead of over it. It takes real space and pushes what follows down as the conversation grows, unless you give it a height. |
| `<blue-search-launcher>` | **Chat button.** The round button in the bottom corner, on every page. |

The Search box is the default and the right choice for a page where asking a
question *is* the point. The Chat button is the right choice when the assistant
should be available everywhere without belonging to any one page.

**Docked is the one you size yourself.** Left alone it grows with the
conversation, which is what a help page or a documentation column usually
wants. To keep it still, give it a height in your own CSS and the conversation
will scroll inside it:

```html
<style>
  blue-search-embed-docked { height: 480px; }
</style>

<blue-search-embed-docked appid="YOUR_APP_ID"></blue-search-embed-docked>
```

Neither Popup nor Docked has a close button, because neither has anything to
collapse back to. Your page controls whether they are there — add the element
to show one, remove it to take it away.

Both take their size and their place from the element you put them in:

- **Width** is the container's, for both. A 320px column gives a 320px assistant.
- **Popup adds no height** to your layout — it opens over what follows. It must
  not sit inside an ancestor with `overflow: hidden` or `overflow: auto`, which
  crops the panel at that container's edge. That is the one thing on a host page
  that can break it.
- **Docked takes real height**, the conversation's, unless you give it one of
  your own as above.
- Neither needs `position: relative` from you, and a tall popup is already kept
  inside the window.

`<blue-search-embed>` also accepts `startmode="icon"`, `startmode="popup"` or
`startmode="docked"`,
which is the older way of writing the same thing. It still works and is not
going away. New installs are clearer with the tag.

---

## The attributes worth knowing

All optional except `appid`, and the defaults suit most sites. The full list,
including every colour and type option, is in the product's install guide.

| Attribute | Example | What it does |
|---|---|---|
| `appid` | `"abc123"` | **Required.** Which assistant this is. |
| `defaultlang` | `"no"` | The language the widget speaks, for visitors who have not picked one themselves. Leave it out and the browser decides. |
| `zindex` | `"1200"` | How high the widget sits in your stacking order. The default is deliberately low (`1`), so your own sticky headers, cookie banners and modals stay above it. Raise it when the widget needs to be on top. |
| `topoffset` | `"80"` | The height in pixels of a sticky header you keep at the top. The floating panel stays below that line so it never covers your navigation. Ignored on phones. |
| `assistantid` | `"support"` | Only when one page carries more than one widget — it keeps their conversations apart. Any short, stable string. |
| `title` | `"Ask our team"` | The name in the panel's title bar, and beside the mark in the Icon arrangement. Note that a title set here stays in that one language. |

```html
<blue-search-embed
  appid="YOUR_APP_ID"
  defaultlang="no"
  topoffset="80"
></blue-search-embed>
```

---

## Two things that can go wrong

**An empty space where the widget should be.** The element is on the page but
the script that defines it never ran, so the browser is treating
`<blue-search-embed>` as an unknown tag — which it renders as nothing, without
an error. Check the two script paths in your browser's network tab; a 404 on
either is the usual cause.

**A page that already runs Angular.** `polyfills.js` is zone.js, which patches
browser globals rather than living inside the bundle. If your site is itself an
Angular application, it has already loaded zone.js, and a second copy throws
`Zone already loaded.` — the widget and possibly your own app stop. This is the
one case where the widget can conflict with a host page. If it applies to you,
say so when you ask for the bundle; it can be built without the polyfill.

---

## Upgrading

Replace the two files. Nothing on your pages changes — the tags and attributes
are a stable interface and are not renamed between versions.

If you cache the files aggressively at a CDN, clear that cache after replacing
them, or visitors will keep the old widget until it expires.
