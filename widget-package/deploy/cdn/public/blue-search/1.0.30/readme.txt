=== Blue Search Chat (Embed + Launcher) ===
Contributors: blueboot
Tags: chat, embed, launcher, angular
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.7
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html



Short Description:
Embeds the Blue Search Angular chat as a floating launcher or full-width embed via shortcodes.

== Description ==
Blue Search Chat provides two shortcodes:
- [blue-search-launcher] – a floating launcher button that opens the chat.
- [blue-search-embed] – an inline, full-width embed.

Assets are enqueued only when shortcodes are present.
No API keys are accepted via shortcodes.

== Assets & Downloads ==
For advanced users and integrators, the plugin assets and installer are also available via our official CDN.

Latest release:
https://cdn.blueboot.ai/blue-search/latest/

This location contains:
- The latest plugin ZIP installer
- Versioned, production-ready JavaScript and static assets used by the chat widget

These URLs are intended for manual installation, testing, or non-WordPress integrations.
For most users, installing via the plugin ZIP is recommended.

== Installation ==
0. (Optional) Download the latest installer from:
   https://cdn.blueboot.ai/blue-search/latest/blue-search.zip

1. Upload the plugin ZIP.
2. Activate the plugin.
3. Add `[blue-search-launcher appid="your-app-id"]`
   or `[blue-search-embed appid="your-app-id"]` to a page.

== Frequently Asked Questions ==

= Does this plugin expose API keys? =
No. The plugin does not accept or render API keys in markup.

= Where can I download the plugin or access the assets directly? =
The latest plugin installer and compiled assets are available via our official CDN:

https://cdn.blueboot.ai/blue-search/latest/

This is useful for advanced integrations, testing, or non-WordPress environments.
For standard WordPress usage, installing the plugin ZIP is recommended.

== Changelog ==
= 1.0.7 =
* Made ready for production system
* Added attribute for running with dev environment
  Add `[blue-search-launcher appid="your-app-id" env="DEV"]`
  or `[blue-search-embed appid="your-app-id" env="DEV"]`

= 1.0.6 =
* Hardened asset loading
* Improved shortcode sanitization
* Removed manual textdomain loader per Plugin Check

== Upgrade Notice ==
= 1.0.7 =
Production-ready release with support for DEV environment.

= 1.0.6 =
Security and compatibility improvements.
