=== BlueSearch – AI Site Search & Chatbot ===
Contributors: blueboot
Tags: ai search, chatbot, site search, ai assistant, live chat
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.35
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

AI search and chat that answers visitors' questions from your own website content, in 18 languages, with a link to the source.

== Description ==

Your website already contains the answers. BlueSearch lets visitors simply ask for them.

Add an AI assistant to your WordPress site that reads your own pages and answers questions in plain language, with a link to the page each answer came from. No FAQ to write, no content to maintain twice: change a page, and the assistant's answers change with it.

= Why BlueSearch =

* **Answers, not a list of links.** Visitors ask in their own words and get a direct answer, instead of ten search results to dig through.
* **Grounded in your content.** Answers come from your pages, not from general AI knowledge, and every answer shows its source. When your content doesn't cover something, it says so instead of guessing.
* **18 languages from content written in one.** A visitor can ask in Polish about a page written in English and get the answer in Polish, without translating your site.
* **Open around the clock.** It answers at two in the morning and never keeps anyone waiting in a queue.
* **Hands over to a person.** When a question needs a human, the conversation can continue with your team in Slack, Zendesk, Intercom, Chatwoot or LiveChat.
* **Learn what visitors want.** See the questions people actually ask, and which ones your site doesn't answer yet.
* **Webshop aware.** Connect your shop to answer questions about products, stock and orders.

= Five ways to show it =

* `[blue-search-launcher]` – **Chat button**: a floating button in the corner of every page.
* `[blue-search-embed]` – **Search box**: an AI search field inside your page.
* `[blue-search-embed-icon]` – **Icon**: a compact mark for your header or menu.
* `[blue-search-embed-popup]` – **Panel**: the conversation already open, over your content.
* `[blue-search-embed-docked]` – **Docked panel**: the same open panel, as part of the page.

Or turn on the chat button for the whole site from **Settings → BlueSearch**, with no shortcode at all. The assistant's name, logo, colours, welcome text and language are set in your BlueSearch account, so every layout matches without extra configuration.

The widget is loaded only on pages that use it, and nothing in your theme needs to change.

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

== Installation ==

1. In WordPress, go to **Plugins → Add New**, search for **BlueSearch**, then click **Install Now** and **Activate**.
2. Create your assistant at https://blueboot.ai: enter your site's address and BlueSearch reads your pages.
3. Copy your **App ID** from your BlueSearch account.
4. In WordPress, go to **Settings → BlueSearch**, paste the App ID and tick **Show launcher on all pages**. Or place one of the shortcodes in a page:

`[blue-search-launcher appid="your-app-id"]` (Chat button)

`[blue-search-embed appid="your-app-id"]` (Search box)

`[blue-search-embed-icon appid="your-app-id"]` (Icon)

`[blue-search-embed-popup appid="your-app-id"]` (Panel)

`[blue-search-embed-docked appid="your-app-id"]` (Docked panel)

Optional: add `defaultlang="no"` (or any supported language code) to choose the language for visitors who haven't picked one. Otherwise the widget follows the visitor's browser.

== Frequently Asked Questions ==

= Do I need a BlueSearch account? =

Yes. The plugin shows the assistant; the assistant itself runs on the BlueSearch service. Create one at https://blueboot.ai to get your App ID.

= What does it cost? =

You can try it free for one month, with every feature included. After that you choose pay as you go (you set a budget and pay only for what is used) or a fixed monthly managed licence. See https://blueboot.ai/bs/pricing for prices.

= How does the assistant know about my site? =

BlueSearch reads the pages of your website and keeps them up to date by re-reading your site regularly. You can also add documents and other sources. Answers are written from that content only, and each answer links to the page it came from.

= Which languages does it support? =

18: Arabic, Chinese, Danish, English, Finnish, French, German, Hebrew, Italian, Japanese, Korean, Norwegian, Polish, Portuguese, Russian, Spanish, Swedish and Ukrainian. Visitors can ask in any of them, whatever language your site is written in.

= Will it slow down my site? =

The widget is loaded only on pages where it is used, and it loads after your page content. Pages without a shortcode (and without the global chat button) load nothing from this plugin.

= Can I use it with WooCommerce? =

Yes. Your site's product pages are read like any other page, and you can connect your shop so the assistant can also answer questions about stock, prices and orders.

= Can visitors reach a real person? =

Yes, if you want them to. Live handover can pass the conversation to your team through Slack, Zendesk, Intercom, Chatwoot or LiveChat. If you don't set it up, the widget shows no trace of it.

= Does the plugin expose API keys? =

No. The plugin does not accept or expose API keys in shortcodes or page markup.

= Does this plugin connect to an external service? =

Yes. See "External services" above for what is sent, when, and to whom.

== Screenshots ==

1. The chat answering a visitor's question from the site's own content.
2. The search box on a page, with suggested questions to get visitors started.
3. The chat button opened: visitors can type a question or pick a suggestion.

== Changelog ==

= 1.0.35 =

* Clearer plugin listing: name, description, installation steps and FAQ.

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

= 1.0.35 =

Listing text only. No code changes.

= 1.0.34 =

Current widget, five layouts, and the language now follows the visitor instead of being forced to Norwegian.


= 1.0.33 =

Adds Icon and Panel shortcodes (all four widget layouts now available). No breaking changes.

= 1.0.32 =

Housekeeping release: corrected external-service disclosure links, restored full documentation sections, no functional changes.

= 1.0.26 =

WordPress.org release with updated assets, improved disclosure and public source code reference.
