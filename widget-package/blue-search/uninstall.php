<?php
/**
 * Fired when the plugin is deleted (not just deactivated) from
 * Plugins → Installed Plugins → Delete.
 *
 * Removes the two options this plugin stores, so nothing lingers
 * in wp_options after uninstall.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('bsrch_global_launcher_enabled');
delete_option('bsrch_global_appid');
