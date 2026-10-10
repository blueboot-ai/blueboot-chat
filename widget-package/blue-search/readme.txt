=== BlueSearch ===
Contributors: blueboot
Tags: chat, embed, launcher, angular
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.34
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Embeds the BlueSearch AI chat widget in five layouts via shortcodes: chat button, search box, icon, panel, or docked panel.

== Description ==

BlueSearch adds an AI-powered search and chat widget to your WordPress site, in five layouts:

* `[blue-search-launcher]` – Chat button: a floating launcher button that opens the chat.
* `[blue-search-embed]` – Search box: an inline, full-width embed.
* `[blue-search-embed-icon]` – Icon: a compact, inline icon version of the embed.
* `[blue-search-embed-popup]` – Panel: a panel-style embed of the assistant.
* `[blue-search-embed-docked]` – Docked panel: the same open panel, as part of the page instead of over it.

You can also enable the launcher globally from **Settings → BlueSearch**.

BlueSearch can help you:

* Answer visitor questions using your website content.
* Help users find pages, products and services.
* Reduce repetitive customer support requests.
* Add an AI assistant without modifying your WordPress theme.

Assets are enqueued only when a shortcode (or the global launcher) is present on the page. No API keys are accepted via shortcodes.

= Source Code =

The bundled assets/main.js and assets/polyfills.js are the compiled output of the Angular widget published at:

https://github.com/blueboot-ai/blueboot-chat

Relevant directories in that repository:

* `widget2` – the Angular chat widget source.
* `widget-package/blue-search` – the WordPress plugin.
* `tools` – the packaging script. `npm install && npm run release` builds the widget and produces the plugin zip.

This plugin does not include any automatic update mechanism outside of the official WordPress.org update system. For questions, contact hello@blueboot.ai.

== External services ==

This plugin relies on the BlueSearch service, provided by BlueBoot R&D AS (the author of this plugin), to answer visitors' questions. Without it the widget cannot work.

The widget runs in the visitor's browser and connects to the BlueSearch API at https://bluebootapi-nouhm5zjqa-uc.a.run.app (operated by BlueBoot R&D AS, hosted on Google Cloud Run). It connects only on pages where one of the plugin's shortcodes, or the global launcher, is present. Nothing is sent when the plugin is activated or configured, and nothing is sent from the WordPress admin.

What is sent, and when:

* When a page with the widget loads: the App ID set in the shortcode or settings, to load that assistant's configuration (name, colours, logo, welcome text, language). The assistant's logo and other images are loaded from the same API.
* When a visitor sends a message: the text they typed, any file they choose to attach, the conversation ID, the language in use and the App ID, so the service can generate an answer from the content the site owner has configured in their BlueBoot account.
* When a visitor rates an answer or fills in the contact form: the rating, comment or contact details they enter.
* When a visitor starts a new conversation: a request to delete the files attached to the previous one.

The visitor's browser also sends the usual technical information included with any web request, such as IP address and user agent.

BlueSearch is a product of BlueBoot R&D AS, https://blueboot.ai

* Terms of Service: https://blueboot.ai/bs/terms
* Privacy Policy: https://blueboot.ai/bs/privacy-policy

Site owners should mention their use of BlueSearch in their own privacy policy.

== Assets & Downloads ==

The compiled widget files are also published at https://blueboot.ai/assets/widget/latest/ for embedding outside WordPress. To install or update this plugin on a WordPress site, use the WordPress.org plugin directory.

== Installation ==

1. Upload the plugin ZIP through **Plugins → Add New → Upload Plugin**.
2. Activate the plugin.
3. Go to **Settings → BlueSearch**.
4. Enter your BlueSearch App ID.
5. Enable the global launcher, or insert one of the following shortcodes:

`[blue-search-launcher appid="your-app-id"]` (Chat button)

`[blue-search-embed appid="your-app-id"]` (Search box)

`[blue-search-embed-icon appid="your-app-id"]` (Icon)

`[blue-search-embed-popup appid="your-app-id"]` (Panel)

`[blue-search-embed-docked appid="your-app-id"]` (Docked panel)

== Frequently Asked Questions ==

= Do I need a BlueSearch account? =

Yes. You need a BlueSearch App ID from your BlueSearch account at https://blueboot.ai.

= Does the plugin expose API keys? =

No. The plugin does not accept or expose API keys in shortcodes or page markup.

= Does this plugin connect to an external service? =

Yes. See "External services" above for what is sent, when, and to whom.

= Can I use it with WooCommerce? =

Yes. If your BlueSearch application has been configured with your WooCommerce catalogue, it can help visitors discover products through natural-language search.

== Screenshots ==

1. Floating BlueSearch launcher.
2. Inline BlueSearch embed.
3. Plugin settings page.

== Changelog ==

= 1.0.34 =

* Plugin name now matches the product name, BlueSearch.
* Updated to the current widget build. Title, logo, colours and welcome text now come from the assistant's own settings, so a shortcode only needs `appid`.
* Language is no longer forced to Norwegian: the widget uses the visitor's own choice or browser language, unless `defaultlang` (or `lang`) is set. Any language the widget supports is accepted.
* App IDs keep their capital letters.
* New shortcode `[blue-search-embed-docked]`: the open panel as part of the page.
* Optional shortcode attributes: `assistantid`, `fontsize`, `fontfamily`, `backcolor`, `messagecolor`.
* Smaller package: the widget no longer needs separate image files.

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
