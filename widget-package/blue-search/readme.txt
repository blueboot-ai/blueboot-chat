=== BlueSearch AI Search and Chatbot ===
Contributors: blueboot
Tags: ai search, chatbot, customer support, website search, ecommerce
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 1.0.26
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Embed the BlueSearch AI chat widget as a floating launcher or inline search assistant.

== Description ==

BlueSearch adds an AI-powered search and chat widget to your WordPress site.

The plugin provides two shortcodes:

* `[blue-search-launcher]` – Displays a floating launcher button that opens the chat.
* `[blue-search-embed]` – Displays an inline, full-width AI chat/search assistant.

You can also enable the launcher globally from the plugin settings page.

BlueSearch can help you:

* Answer visitor questions using your website content.
* Help users find pages, products and services.
* Reduce repetitive customer support requests.
* Add an AI assistant without modifying your WordPress theme.

== External Service ==

This plugin connects to the BlueSearch service provided by BlueBoot.

The plugin sends the configured App ID, visitor chat messages, page context and technical request information to the BlueSearch service in order to generate AI responses and operate the chat widget.

Service Provider: BlueBoot

Website:
https://www.blueboot.ai

Privacy Policy:
https://www.blueboot.ai/privacy-policy

Terms of Service:
https://www.blueboot.ai/terms

No OpenAI API keys or BlueSearch API keys are exposed in the page markup.

Website owners should update their own privacy policy to disclose their use of the BlueSearch service.

== Source Code ==

The complete source code and build tools used to generate this plugin are publicly available at:

https://github.com/blueboot-ai/blueboot-chat

Relevant directories include:

* `widget-package/blue-search` – WordPress plugin.
* `src` – Angular widget source.
* `tools` – Build and packaging scripts.

The JavaScript bundled into this plugin is generated from this source repository.

== Installation ==

1. Upload the plugin ZIP through **Plugins → Add New → Upload Plugin**.
2. Activate the plugin.
3. Go to **Settings → BlueSearch**.
4. Enter your BlueSearch App ID.
5. Enable the global launcher or insert one of the following shortcodes:

`[blue-search-launcher appid="your-app-id"]`

or

`[blue-search-embed appid="your-app-id"]`

== Frequently Asked Questions ==

= Do I need a BlueSearch account? =

Yes. You need a BlueSearch App ID provided by BlueBoot.

= Does the plugin expose API keys? =

No. The plugin does not expose API keys in WordPress pages or page markup.

= Does this plugin connect to an external service? =

Yes. The plugin connects to the BlueSearch service to process chat and search requests.

= Can I use it with WooCommerce? =

Yes. If your BlueSearch application has been configured with your WooCommerce catalogue, it can help visitors discover products through natural-language search.

== Screenshots ==

1. Floating BlueSearch launcher.
2. Inline BlueSearch embed.
3. Plugin settings page.

== Changelog ==

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

= 1.0.26 =

WordPress.org release with updated assets, improved disclosure and public source code reference.
