<?php
/**
 * Plugin Name: Blue Search Chat (Embed + Launcher)
 * Plugin URI:  https://www.blueboot.ai
 * Description: Embeds the Blue Search Angular chat as a floating launcher or a full-width embed.
 * Version:     1.0.28
 * Author:      BlueBoot
 * Text Domain: blue-search
 * License:     GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

if (!defined('ABSPATH')) exit;

/* =============================================================================
 * Auto-updates (BlueBoot CDN)
 * - Requires: /lib/plugin-update-checker/plugin-update-checker.php inside plugin
 * - Manifest URL: https://blueboot-cdn.web.app/blue-search/latest/lib/plugin-update-checker/blue-search.json
 * ============================================================================= */
add_action('plugins_loaded', function () {

    $allowed =
        is_admin()
        || (defined('DOING_CRON') && DOING_CRON)
        || (defined('WP_CLI') && WP_CLI);

    if (!$allowed) return;

    $puc = __DIR__ . '/lib/plugin-update-checker/plugin-update-checker.php';
    if (!file_exists($puc)) return;

    require_once $puc;

    if (class_exists('\YahnisElsts\PluginUpdateChecker\v5\PucFactory')) {
        $GLOBALS['blue_search_update_checker'] =
            \YahnisElsts\PluginUpdateChecker\v5\PucFactory::buildUpdateChecker(
                'https://blueboot-cdn.web.app/blue-search/latest/lib/plugin-update-checker/blue-search.json',
                __FILE__,
                'blue-search'
            );

    }

}, 1);



// Buffer for one or more launchers to print at end of <body>
$GLOBALS['bsrch_launcher_markup'] = [];

/* =============================================================================
 * Assets (register; enqueue only when shortcode is used)
 * ============================================================================= */
function bsrch_register_assets() {
    $assets_uri = trailingslashit(plugin_dir_url(__FILE__)) . 'assets/';
    $assets_dir = trailingslashit(plugin_dir_path(__FILE__)) . 'assets/';

    $css  = current(glob($assets_dir . 'styles*.css')) ?: '';
    $poly = current(glob($assets_dir . 'polyfills*.js')) ?: '';
    $main = current(glob($assets_dir . 'main*.js')) ?: '';

    if ($css) {
        wp_register_style(
            'blue-search-styles',
            $assets_uri . basename($css),
            [],
            @filemtime($css) ?: null
        );
    }

    if ($poly) {
        wp_register_script(
            'blue-search-polyfills',
            $assets_uri . basename($poly),
            [],
            @filemtime($poly) ?: null,
            true
        );
    }

    if ($main) {
        wp_register_script(
            'blue-search-main',
            $assets_uri . basename($main),
            $poly ? ['blue-search-polyfills'] : [],
            @filemtime($main) ?: null,
            true
        );

        // Provide an assets base for images consumed by the Angular bundle
        $imgBase = esc_url_raw($assets_uri . 'img/');
        wp_add_inline_script(
            'blue-search-main',
            'window.__BLUE_SEARCH_ASSETS_BASE = ' . wp_json_encode($imgBase) . ';',
            'before'
        );
    }
}
add_action('init', 'bsrch_register_assets');

add_action('wp_footer', function () {
    if (wp_script_is('blue-search-main', 'enqueued')) {
        echo '<app-root style="display:none" aria-hidden="true" role="presentation"></app-root>';
    }
    if (!empty($GLOBALS['bsrch_launcher_markup'])) {
        foreach ($GLOBALS['bsrch_launcher_markup'] as $html) {
            echo $html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
        }
        $GLOBALS['bsrch_launcher_markup'] = [];
    }
}, 100);

/** Mark Angular bundles as ES modules. */
add_filter('script_loader_tag', function ($tag, $handle) {
    if ($handle === 'blue-search-polyfills' || $handle === 'blue-search-main') {
        if (strpos($tag, 'type="module"') === false) {
            $tag = str_replace('<script ', '<script type="module" ', $tag);
        }
    }
    return $tag;
}, 10, 2);

/** Enqueue helper (called inside each shortcode so assets load only where used). */
function bsrch_enqueue_assets_for_shortcode() {
    if (wp_style_is('blue-search-styles', 'registered')) {
        wp_enqueue_style('blue-search-styles');
    }
    if (wp_script_is('blue-search-main', 'registered')) {
        if (wp_script_is('blue-search-polyfills', 'registered')) {
            wp_enqueue_script('blue-search-polyfills');
        }
        wp_enqueue_script('blue-search-main');
    }
}

/* =============================================================================
 * Helpers
 * ============================================================================= */

/** Allow same-origin external images or plugin assets; block third-party hosts */
function bsrch_normalize_asset_url($val) {
    $val = trim((string)$val);
    if ($val === '') return '';
    if (preg_match('~^https?://~i', $val)) {
        $u = wp_parse_url($val);
        $s = wp_parse_url(home_url());
        if (!$u || !$s || empty($u['host']) || strcasecmp($u['host'], $s['host']) !== 0) {
            return '';
        }
        return esc_url($val);
    }
    $base = trailingslashit(plugin_dir_url(__FILE__)) . 'assets/';
    if (preg_match('~^(img/|assets/)~i', $val)) return esc_url($base . ltrim($val, '/'));
    return esc_url($base . 'img/' . ltrim($val, '/'));
}

/** Build HTML attributes string from key=>value pairs (skip empty) */
function bsrch_build_attrs(array $pairs) {
    $out = [];
    foreach ($pairs as $k => $v) {
        if ($v === '' || $v === null) continue;
        $out[] = sprintf('%s="%s"', esc_attr($k), esc_attr($v));
    }
    return implode(' ', $out);
}

/** Wrapper-scoped transparency CSS */
function bsrch_transparent_bg_inline_css() {
    return '<style class="bsrch-transparent-bg">
      blue-search-embed, blue-search-launcher{display:block;background:transparent!important;}
    </style>';
}

/** Sanitizers */
function bsrch_sanitize_lang($lang) {
    $lang = strtolower(sanitize_key($lang));
    return in_array($lang, ['en','no','ar'], true) ? $lang : 'no';
}
function bsrch_sanitize_slug($val) {
    return sanitize_key($val);
}
function bsrch_sanitize_size($val, $fallback) {
    $val = trim((string)$val);
    return preg_match('/^\d+(\.\d+)?(px|%|rem|vh|vw)$/', $val) ? $val : $fallback;
}
function bsrch_sanitize_checkbox($value) {
    return $value ? 1 : 0;
}

/* =============================================================================
 * Admin: Settings page – minimal (enable + appid only)
 * ============================================================================= */

/** Register plugin options */
function bsrch_register_settings() {
    register_setting(
        'bsrch_settings_group',
        'bsrch_global_launcher_enabled',
        [
            'type'              => 'boolean',
            'sanitize_callback' => 'bsrch_sanitize_checkbox',
            'default'           => 0,
        ]
    );

    register_setting(
        'bsrch_settings_group',
        'bsrch_global_appid',
        [
            'type'              => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default'           => '',
        ]
    );
}
add_action('admin_init', 'bsrch_register_settings');

/** Add an options page under Settings */
function bsrch_add_options_page() {
    add_options_page(
        'Blue Search Chat',
        'Blue Search Chat',
        'manage_options',
        'blue-search-settings',
        'bsrch_render_settings_page'
    );
}
add_action('admin_menu', 'bsrch_add_options_page');

/** Render settings page */
function bsrch_render_settings_page() {
    if (!current_user_can('manage_options')) return;

    $enabled = (bool) get_option('bsrch_global_launcher_enabled', 0);
    $appid   = get_option('bsrch_global_appid', '');
    ?>
    <div class="wrap">
        <h1>Blue Search Chat</h1>
        <p>Configure global launcher behavior.</p>

        <form method="post" action="options.php">
            <?php settings_fields('bsrch_settings_group'); ?>

            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row">
                        <label for="bsrch_global_launcher_enabled">
                            Show launcher on all pages
                        </label>
                    </th>
                    <td>
                        <input type="checkbox"
                               id="bsrch_global_launcher_enabled"
                               name="bsrch_global_launcher_enabled"
                               value="1"
                               <?php checked($enabled, true); ?> />
                        <p class="description">
                            If checked, the <code>[blue-search-launcher]</code> widget will be injected
                            on all front-end pages (no theme changes needed).
                        </p>
                    </td>
                </tr>

                <tr>
                    <th scope="row"><label for="bsrch_global_appid">App ID</label></th>
                    <td>
                        <input type="text"
                               id="bsrch_global_appid"
                               name="bsrch_global_appid"
                               class="regular-text"
                               value="<?php echo esc_attr($appid); ?>" />
                        <p class="description">
                            Passed as <code>appid</code> (for example: <code>iarbeid</code>).
                        </p>
                    </td>
                </tr>
            </table>

            <?php submit_button(); ?>
        </form>

        <hr/>
        <p>
            Manual usage still works:<br/>
            <code>[blue-search-launcher appid="YOUR_APP_ID"]</code><br/>
            <code>[blue-search-embed appid="YOUR_APP_ID"]</code>
        </p>
    </div>
    <?php
}

/* =============================================================================
 * Global launcher injection based on settings
 * ============================================================================= */

/**
 * Use the existing shortcode logic to enqueue the launcher globally.
 * This avoids duplicating markup logic and keeps behaviour identical.
 */
function bsrch_maybe_queue_global_launcher() {
    if (is_admin()) return;

    $enabled = (bool) get_option('bsrch_global_launcher_enabled', 0);
    if (!$enabled) return;

    $appid = trim((string) get_option('bsrch_global_appid', ''));
    if ($appid === '') return;

    // If the current singular post already contains the launcher shortcode,
    // don't inject the global one (avoid duplicate launchers).
    global $post;
    if (is_singular() && $post instanceof WP_Post && !empty($post->post_content)) {
        if (has_shortcode($post->post_content, 'blue-search-launcher')) {
            return;
        }
    }

    // Otherwise queue the launcher globally
    $shortcode = sprintf('[blue-search-launcher appid="%s"]', esc_attr($appid));
    do_shortcode($shortcode);
}

add_action('wp', 'bsrch_maybe_queue_global_launcher');

/* =============================================================================
 * Shortcode: [blue-search-launcher ...]
 * ============================================================================= */
add_shortcode('blue-search-launcher', function ($atts = []) {
    bsrch_enqueue_assets_for_shortcode();

    $a = shortcode_atts([
        'title'        => 'Assistant',
        'welcometext'  => '',
        'logosrc'      => '',
        'logoalt'      => '',
        'robotsrc'     => '',
        'appid'        => '',
        'env'          => '',
        'lang'         => 'no',
    ], $atts, 'blue-search-launcher');

    $logo_url  = $a['logosrc']  !== '' ? bsrch_normalize_asset_url($a['logosrc'])  : '';
    $robot_url = $a['robotsrc'] !== '' ? bsrch_normalize_asset_url($a['robotsrc']) : trailingslashit(plugin_dir_url(__FILE__)) . 'assets/img/robot.png';

    $attrs = bsrch_build_attrs([
        'title'       => $a['title'],
        'welcometext' => $a['welcometext'],
        'logoalt'     => $a['logoalt'],
        'appid'       => bsrch_sanitize_slug($a['appid']),
        'env'         => $a['env'],
        'lang'        => bsrch_sanitize_lang($a['lang']),
        'logosrc'     => $logo_url ?: null,
        'robotsrc'    => $robot_url ?: null,
    ]);

    // Render as direct child of <body> to escape transformed/overflowed wrappers
    $html  = '<blue-search-launcher class="bsrch-launcher-el" ' . $attrs . '></blue-search-launcher>';
    // Scoped stacking/visibility (not global)
    $html .= '<style class="bsrch-launcher-css">blue-search-launcher{display:block;position:relative;z-index:2147483647;}</style>';
    // Reparent to body
    $html .= '<script class="bsrch-launcher-mount">(function(){'
          .  'var els=document.getElementsByClassName("bsrch-launcher-el");'
          .  'if(!els||!els.length) return;'
          .  'for(var i=0;i<els.length;i++){var el=els[i];if(document.body && el.parentNode!==document.body){document.body.appendChild(el);}}'
          .  '})();</script>';

    $GLOBALS['bsrch_launcher_markup'][] = $html;

    // Nothing in content area
    return '';
});

/* =============================================================================
 * Shortcode: [blue-search-embed ...]
 * ============================================================================= */
add_shortcode('blue-search-embed', function ($atts = []) {
    bsrch_enqueue_assets_for_shortcode();

    $a = shortcode_atts([
        'title'        => 'Assistant',
        'welcometext'  => '',
        'logosrc'      => '',
        'logoalt'      => '',
        'appid'        => '',
        'env'          => '',
        'lang'         => 'no',
        // layout
        'width'        => '100%',
    ], $atts, 'blue-search-embed');

    $logo_url = $a['logosrc'] !== '' ? bsrch_normalize_asset_url($a['logosrc']) : '';

    $ce_attrs = bsrch_build_attrs([
        'title'       => $a['title'],
        'welcometext' => $a['welcometext'],
        'logoalt'     => $a['logoalt'],
        'appid'       => bsrch_sanitize_slug($a['appid']),
        'env'         => $a['env'],
        'lang'        => bsrch_sanitize_lang($a['lang']),
        'logosrc'     => $logo_url ?: null,
    ]);

    $width = bsrch_sanitize_size($a['width'], '100%');

    // Let the theme/container decide max width
    $wrap_style = 'display:block;';

    $el_style = sprintf(
        'display:block;width:%s;--bb-back:transparent;--bb-hdr-bg:transparent;',
        esc_attr($width)
    );

    $transparent_css = bsrch_transparent_bg_inline_css();

    return $transparent_css .
        sprintf(
            '<div class="bb-embed-host" style="%s"><blue-search-embed %s style="%s"></blue-search-embed></div>',
            esc_attr($wrap_style),
            $ce_attrs,
            $el_style
        );
});

/* Avoid WordPress smart quotes breaking our shortcodes inside blocks */
add_filter('no_texturize_shortcodes', function($shortcodes){
    $shortcodes[] = 'blue-search-launcher';
    $shortcodes[] = 'blue-search-embed';
    return $shortcodes;
});
