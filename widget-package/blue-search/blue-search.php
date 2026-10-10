<?php
/**
 * Plugin Name: Blue Search
 * Plugin URI:  https://www.blueboot.ai
 * Description: Embeds the Blue Search Angular chat as a floating launcher or a full-width embed.
 * Version:     1.0.34
 * Author:      BlueBoot
 * Text Domain: blue-search
 * License:     GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

if (!defined('ABSPATH')) exit;

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

    }
}
add_action('init', 'bsrch_register_assets');

add_action('wp_footer', function () {
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
      blue-search-embed, blue-search-embed-popup, blue-search-embed-docked, blue-search-launcher{display:block;background:transparent!important;}
    </style>';
}

/** Sanitizers */
function bsrch_sanitize_lang($lang) {
    $lang = strtolower(trim((string)$lang));
    return preg_match('/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/', $lang) ? $lang : '';
}
/** App ids are Firestore document ids: case-sensitive, so not sanitize_key(). */
function bsrch_sanitize_slug($val) {
    return preg_replace('/[^A-Za-z0-9_\-]/', '', (string)$val);
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
            <code>[blue-search-launcher appid="YOUR_APP_ID"]</code> &mdash; Chat button<br/>
            <code>[blue-search-embed appid="YOUR_APP_ID"]</code> &mdash; Search box<br/>
            <code>[blue-search-embed-icon appid="YOUR_APP_ID"]</code> &mdash; Icon<br/>
            <code>[blue-search-embed-popup appid="YOUR_APP_ID"]</code> &mdash; Panel<br/>
            <code>[blue-search-embed-docked appid="YOUR_APP_ID"]</code> &mdash; Panel, part of the page<br/>
            Optional: <code>defaultlang="no"</code> to choose the language for visitors who have not picked one.
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
 * Shortcode attributes shared by every widget tag
 *
 * The bundle is widget2 (./widget2 in this repository), the same widget
 * served at https://blueboot.ai/assets/widget/latest/. Title, logo, colours and
 * welcome text come from the app's own settings, looked up by appid, so a
 * shortcode only needs appid. The rest are optional overrides.
 *
 * Attributes the older bundle read (welcometext, logosrc, logoalt, robotsrc,
 * env) are still accepted so existing shortcodes keep working, and ignored.
 *
 * `lang` is kept as an alias of `defaultlang`. Neither is sent unless given:
 * an empty value lets the widget use the visitor's own choice or browser
 * language instead of forcing one on everybody.
 * ============================================================================= */
function bsrch_widget_atts_defaults() {
    return [
        'appid'        => '',
        'defaultlang'  => '',
        'lang'         => '',
        'title'        => '',
        'assistantid'  => '',
        'fontsize'     => '',
        'fontfamily'   => '',
        'backcolor'    => '',
        'messagecolor' => '',
    ];
}

function bsrch_widget_attrs(array $a) {
    $lang = bsrch_sanitize_lang($a['defaultlang'] !== '' ? $a['defaultlang'] : $a['lang']);
    return bsrch_build_attrs([
        'appid'        => bsrch_sanitize_slug($a['appid']),
        'defaultlang'  => $lang,
        'title'        => $a['title'],
        'assistantid'  => sanitize_text_field($a['assistantid']),
        'fontsize'     => sanitize_text_field($a['fontsize']),
        'fontfamily'   => sanitize_text_field($a['fontfamily']),
        'backcolor'    => sanitize_text_field($a['backcolor']),
        'messagecolor' => sanitize_text_field($a['messagecolor']),
    ]);
}

/* =============================================================================
 * Shortcode: [blue-search-launcher ...]  Chat button, bottom corner.
 * ============================================================================= */
add_shortcode('blue-search-launcher', function ($atts = []) {
    bsrch_enqueue_assets_for_shortcode();

    $a = shortcode_atts(bsrch_widget_atts_defaults(), $atts, 'blue-search-launcher');
    $attrs = bsrch_widget_attrs($a);

    // Render as direct child of <body> to escape transformed/overflowed wrappers
    $html  = '<blue-search-launcher class="bsrch-launcher-el" ' . $attrs . '></blue-search-launcher>';
    $html .= '<style class="bsrch-launcher-css">blue-search-launcher{display:block;position:relative;z-index:2147483647;}</style>';
    $html .= '<script class="bsrch-launcher-mount">(function(){'
          .  'var els=document.getElementsByClassName("bsrch-launcher-el");'
          .  'if(!els||!els.length) return;'
          .  'for(var i=0;i<els.length;i++){var el=els[i];if(document.body && el.parentNode!==document.body){document.body.appendChild(el);}}'
          .  '})();</script>';

    $GLOBALS['bsrch_launcher_markup'][] = $html;

    // Nothing in content area
    return '';
});

/** Block-level embed (search box, popup, docked): wrapped, with a width. */
function bsrch_render_block_embed($tag, $atts) {
    bsrch_enqueue_assets_for_shortcode();

    $a = shortcode_atts(
        array_merge(bsrch_widget_atts_defaults(), ['width' => '100%']),
        $atts,
        $tag
    );
    $width = bsrch_sanitize_size($a['width'], '100%');
    $el_style = sprintf(
        'display:block;width:%s;--bb-back:transparent;--bb-hdr-bg:transparent;',
        esc_attr($width)
    );

    return bsrch_transparent_bg_inline_css() .
        sprintf(
            '<div class="bb-embed-host" style="display:block;"><%1$s %2$s style="%3$s"></%1$s></div>',
            $tag,
            bsrch_widget_attrs($a),
            $el_style
        );
}

/* [blue-search-embed ...]         Search box, in the page's flow. */
add_shortcode('blue-search-embed', function ($atts = []) {
    return bsrch_render_block_embed('blue-search-embed', $atts);
});

/* [blue-search-embed-popup ...]   Panel, already open, over the content. */
add_shortcode('blue-search-embed-popup', function ($atts = []) {
    return bsrch_render_block_embed('blue-search-embed-popup', $atts);
});

/* [blue-search-embed-docked ...]  Same open panel, part of the page. */
add_shortcode('blue-search-embed-docked', function ($atts = []) {
    return bsrch_render_block_embed('blue-search-embed-docked', $atts);
});

/* [blue-search-embed-icon ...]    Compact mark for a header or menu bar. */
add_shortcode('blue-search-embed-icon', function ($atts = []) {
    bsrch_enqueue_assets_for_shortcode();

    $a = shortcode_atts(bsrch_widget_atts_defaults(), $atts, 'blue-search-embed-icon');

    return bsrch_transparent_bg_inline_css() .
        sprintf(
            '<blue-search-embed-icon %s style="%s"></blue-search-embed-icon>',
            bsrch_widget_attrs($a),
            esc_attr('display:inline-block;--bb-back:transparent;--bb-hdr-bg:transparent;')
        );
});

/* Avoid WordPress smart quotes breaking our shortcodes inside blocks */
add_filter('no_texturize_shortcodes', function($shortcodes){
    $shortcodes[] = 'blue-search-launcher';
    $shortcodes[] = 'blue-search-embed';
    $shortcodes[] = 'blue-search-embed-icon';
    $shortcodes[] = 'blue-search-embed-popup';
    $shortcodes[] = 'blue-search-embed-docked';
    return $shortcodes;
});
