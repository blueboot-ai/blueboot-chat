=== Blue Search ===
Contributors: moeznejah
Tags: chat, embed, launcher, angular
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.33
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Embeds the Blue Search AI chat widget in four layouts via shortcodes: chat button, search box, icon, or panel.

== Description ==

Blue Search adds an AI-powered search and chat widget to your WordPress site, in four layouts:

* `[blue-search-launcher]` – Chat button: a floating launcher button that opens the chat.
* `[blue-search-embed]` – Search box: an inline, full-width embed.
* `[blue-search-embed-icon]` – Icon: a compact, inline icon version of the embed.
* `[blue-search-embed-popup]` – Panel: a panel-style embed of the assistant.

You can also enable the launcher globally from **Settings → BlueSearch**.

Blue Search can help you:

* Answer visitor questions using your website content.
* Help users find pages, products and services.
* Reduce repetitive customer support requests.
* Add an AI assistant without modifying your WordPress theme.

Assets are enqueued only when a shortcode (or the global launcher) is present on the page. No API keys are accepted via shortcodes.

= Source Code =

The bundled assets/main.js and assets/polyfills.js are the compiled output of the Angular application published at:

https://github.com/blueboot-ai/blueboot-chat

Relevant directories in that repository:

* `widget-package/blue-search` – the WordPress plugin.
* `src/app/widget2` – the Angular chat widget source.
* `tools` – build and packaging scripts (`npm install && npm run build:wp` builds the widget and assembles the plugin folder).

This plugin does not include any automatic update mechanism outside of the official WordPress.org update system. For questions, contact hello@blueboot.ai.

== External services ==

This plugin connects the embedded chat widget (added via the `[blue-search-launcher]` and `[blue-search-embed]` shortcodes, or the global launcher) to Blue Search's own hosted API, provided by BlueBoot, so it can generate AI-assisted answers.

What is sent: the App ID configured for the widget, the text a visitor types into the chat, and page/technical context needed to operate the widget are sent from the visitor's browser to BlueBoot's backend at https://blueboot.ai, so it can generate an AI-assisted response using retrieval-augmented search over the content the site owner has configured in their BlueBoot account. No API keys are accepted or rendered by this plugin, and no data is sent unless the widget is loaded on a page where the shortcode (or global launcher) is active.

Site owners should update their own privacy policy to disclose their use of the Blue Search service.

Service provider: BlueBoot
Website: https://www.blueboot.ai
Privacy Policy: https://blueboot.ai/bs/privacy-policy-bluesearch
Terms of Service: https://blueboot.ai/bs/terms

== Assets & Downloads ==

For advanced integrators who need direct access to the compiled widget assets (for example, embedding outside of WordPress), the underlying JavaScript and CSS are also published at:

https://cdn.blueboot.ai/blue-search/latest/

This location is for asset access only. To install or update this plugin on a WordPress site, always use the WordPress.org plugin directory.

== Installation ==

1. Upload the plugin ZIP through **Plugins → Add New → Upload Plugin**.
2. Activate the plugin.
3. Go to **Settings → BlueSearch**.
4. Enter your Blue Search App ID.
5. Enable the global launcher, or insert one of the following shortcodes:

`[blue-search-launcher appid="your-app-id"]` (Chat button)

`[blue-search-embed appid="your-app-id"]` (Search box)

`[blue-search-embed-icon appid="your-app-id"]` (Icon)

`[blue-search-embed-popup appid="your-app-id"]` (Panel)

== Frequently Asked Questions ==

= Do I need a Blue Search account? =

Yes. You need a Blue Search App ID provided by BlueBoot.

= Does the plugin expose API keys? =

No. The plugin does not accept or expose API keys in shortcodes or page markup.

= Does this plugin connect to an external service? =

Yes. See "External services" above for what is sent, when, and to whom.

= Can I use it with WooCommerce? =

Yes. If your Blue Search application has been configured with your WooCommerce catalogue, it can help visitors discover products through natural-language search.

== Screenshots ==

1. Floating Blue Search launcher.
2. Inline Blue Search embed.
3. Plugin settings page.

== Changelog ==

= 1.0.33 =

* Added two new shortcodes, exposing all four widget layouts: `[blue-search-embed-icon]` (Icon) and `[blue-search-embed-popup]` (Panel).
* Synced plugin code with the latest widget build.
* Fixed a version mismatch between the plugin header and this readme's Stable tag.

= 1.0.32 =

* Housekeeping release ahead of WordPress.org submission.
* Renamed plugin listing to match the plugin header (Blue Search).
* Restored and corrected the External services disclosure, Source Code section, FAQ and Screenshots (the Privacy Policy and Terms of Service links now point at the pages that actually exist: /bs/privacy-policy-bluesearch and /bs/terms).
* Trimmed the Assets & Downloads section to raw-asset access only, so the WordPress.org directory remains the only advertised place to install/update the plugin.
* Removed the previously bundled self-update library reference; this plugin has no external auto-update mechanism.
* Removed a stray build artifact from the assets folder.
* Synced plugin version and readme stable tag.
* Bumped "Tested up to" to the current WordPress version.

= 1.0.31 =

* Removed the bundled self-update library (plugin-update-checker) and its manifest from the packaged plugin. WordPress.org plugins must rely solely on the WordPress.org update system; this release no longer ships any alternate update channel.
* Synced the Stable tag with the plugin's Version header.
* Compressed oversized launcher images to reduce plugin package size.

= 1.0.26 =

* Prepared WordPress.org release.
* Removed the custom update mechanism from the WordPress.org package.
* Improved settings page.
* Improved external service disclosure.
* Added public source code reference.
* Updated bundled widget assets.

= 1.0.7 =

* Production release.
* Added DEV environment support.

= 1.0.6 =

* Hardened asset loading.
* Improved shortcode sanitisation.
* Removed manual textdomain loader.

== Upgrade Notice ==

= 1.0.33 =

Adds Icon and Panel shortcodes (all four widget layouts now available). No breaking changes.

= 1.0.32 =

Housekeeping release: corrected external-service disclosure links, restored full documentation sections, no functional changes.

= 1.0.26 =

WordPress.org release with updated assets, improved disclosure and public source code reference.
