<?php
/**
 * Plugin Name:       BlueSearch – AI Site Search & Chatbot
 * Plugin URI:        https://blueboot.ai/bs/home
 * Description:       AI search and chat that answers visitors' questions from your own website content, in 18 languages, with a link to the source.
 * Version:           1.0.36
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            BlueBoot R&D AS
 * Author URI:        https://blueboot.ai
 * Text Domain:       blue-search
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 */

if (!defined('ABSPATH')) exit;

define('BSRCH_SIGNUP_URL', 'https://blueboot.ai/bs/home');
define('BSRCH_DOCS_URL', 'https://blueboot.ai/bs/docs/install-guide');

// Launchers to print at the end of <body>: attribute arrays, escaped on output.
$GLOBALS['bsrch_launchers'] = [];

/* =============================================================================
 * The five layouts. One list, used by the shortcodes, the block and the
 * settings page, so they cannot disagree.
 * ============================================================================= */
function bsrch_layouts() {
    return [
        'launcher' => [
            'tag'       => 'blue-search-launcher',
            'shortcode' => 'blue-search-launcher',
            'label'     => __('Chat button', 'blue-search'),
            'help'      => __('A floating button in the corner of the page.', 'blue-search'),
        ],
        'embed' => [
            'tag'       => 'blue-search-embed',
            'shortcode' => 'blue-search-embed',
            'label'     => __('Search box', 'blue-search'),
            'help'      => __('An AI search field inside your page.', 'blue-search'),
        ],
        'icon' => [
            'tag'       => 'blue-search-embed-icon',
            'shortcode' => 'blue-search-embed-icon',
            'label'     => __('Icon', 'blue-search'),
            'help'      => __('A compact mark for a header or menu.', 'blue-search'),
        ],
        'popup' => [
            'tag'       => 'blue-search-embed-popup',
            'shortcode' => 'blue-search-embed-popup',
            'label'     => __('Panel', 'blue-search'),
            'help'      => __('The conversation already open, over your content.', 'blue-search'),
        ],
        'docked' => [
            'tag'       => 'blue-search-embed-docked',
            'shortcode' => 'blue-search-embed-docked',
            'label'     => __('Docked panel', 'blue-search'),
            'help'      => __('The open conversation as part of the page.', 'blue-search'),
        ],
    ];
}

/* =============================================================================
 * Assets (registered on init; enqueued only where a shortcode, the block or
 * the global chat button is used)
 * ============================================================================= */
function bsrch_register_assets() {
    $dir = trailingslashit(plugin_dir_path(__FILE__)) . 'assets/';
    $uri = trailingslashit(plugin_dir_url(__FILE__)) . 'assets/';

    if (!file_exists($dir . 'main.js') || !file_exists($dir . 'polyfills.js')) {
        return;
    }

    // zone.js; must run before the widget bundle.
    wp_register_script(
        'blue-search-polyfills',
        $uri . 'polyfills.js',
        [],
        (string) filemtime($dir . 'polyfills.js'),
        true
    );

    // The widget (widget2). Defines the <blue-search-*> custom elements.
    wp_register_script(
        'blue-search-main',
        $uri . 'main.js',
        ['blue-search-polyfills'],
        (string) filemtime($dir . 'main.js'),
        true
    );

    // Moves chat buttons to be direct children of <body>, so a transformed or
    // overflow-clipped theme wrapper cannot trap the fixed-position button.
    wp_add_inline_script(
        'blue-search-polyfills',
        '(function(){var els=document.getElementsByClassName("bsrch-launcher-el");'
        . 'for(var i=0;i<els.length;i++){if(document.body&&els[i].parentNode!==document.body){document.body.appendChild(els[i]);}}})();',
        'before'
    );

    // Layout for the custom elements. A style handle with no file of its own,
    // so the CSS is printed by WordPress, only on pages using the widget.
    wp_register_style('blue-search-inline', false, [], '1');
    wp_add_inline_style(
        'blue-search-inline',
        'blue-search-embed,blue-search-embed-popup,blue-search-embed-docked{display:block;background:transparent!important;}'
        . 'blue-search-launcher{display:block;position:relative;z-index:2147483647;background:transparent!important;}'
    );
}
add_action('init', 'bsrch_register_assets');

/**
 * Print queued chat buttons at the end of <body>, before the footer scripts
 * (priority 20), so the elements exist when the scripts run.
 */
add_action('wp_footer', function () {
    foreach ($GLOBALS['bsrch_launchers'] as $pairs) {
        echo '<blue-search-launcher class="bsrch-launcher-el"';
        foreach ($pairs as $k => $v) {
            if ($v === '' || $v === null) continue;
            echo ' ' . esc_attr($k) . '="' . esc_attr($v) . '"';
        }
        echo '></blue-search-launcher>';
    }
    $GLOBALS['bsrch_launchers'] = [];
}, 5);

/**
 * The widget bundles are ES modules. $tag can also hold the handle's inline
 * scripts, so only the tag that loads the file (the one with src=) is changed.
 */
add_filter('script_loader_tag', function ($tag, $handle) {
    if ($handle === 'blue-search-polyfills' || $handle === 'blue-search-main') {
        $tag = preg_replace('/<script(?![^>]*\stype=)([^>]*\ssrc=)/', '<script type="module"$1', $tag, 1);
    }
    return $tag;
}, 10, 2);

/** Load the widget on this page (called by every shortcode and the block). */
function bsrch_enqueue_assets_for_shortcode() {
    if (wp_script_is('blue-search-main', 'registered')) {
        wp_enqueue_script('blue-search-main');
        wp_enqueue_style('blue-search-inline');
    }
}

/* =============================================================================
 * Helpers
 * ============================================================================= */

/** Build HTML attributes string from key=>value pairs (skip empty) */
function bsrch_build_attrs(array $pairs) {
    $out = [];
    foreach ($pairs as $k => $v) {
        if ($v === '' || $v === null) continue;
        $out[] = sprintf('%s="%s"', esc_attr($k), esc_attr($v));
    }
    return implode(' ', $out);
}

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

/** The App ID saved under Settings → BlueSearch. */
function bsrch_global_appid() {
    return bsrch_sanitize_slug(trim((string) get_option('bsrch_global_appid', '')));
}

/* =============================================================================
 * Admin: Settings → BlueSearch
 * ============================================================================= */

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
            'sanitize_callback' => 'bsrch_sanitize_slug',
            'default'           => '',
        ]
    );
}
add_action('admin_init', 'bsrch_register_settings');

function bsrch_add_options_page() {
    add_options_page(
        __('BlueSearch', 'blue-search'),
        __('BlueSearch', 'blue-search'),
        'manage_options',
        'blue-search-settings',
        'bsrch_render_settings_page'
    );
}
add_action('admin_menu', 'bsrch_add_options_page');

/** "Settings" link next to Deactivate on the Plugins screen. */
add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    $url = admin_url('options-general.php?page=blue-search-settings');
    array_unshift($links, sprintf('<a href="%s">%s</a>', esc_url($url), esc_html__('Settings', 'blue-search')));
    return $links;
});

/** Styles for our own settings page only. */
add_action('admin_enqueue_scripts', function ($hook) {
    if ($hook !== 'settings_page_blue-search-settings') return;
    wp_register_style('blue-search-admin', false, [], '1');
    wp_enqueue_style('blue-search-admin');
    wp_add_inline_style(
        'blue-search-admin',
        '.bsrch-start{background:#fff;border:1px solid #c3c4c7;border-left:4px solid #2d4488;padding:12px 20px;margin:16px 0;max-width:760px}'
        . '.bsrch-start h2{margin:.6em 0 .4em}.bsrch-start ol{margin-left:1.4em}.bsrch-start li{margin:.4em 0}'
        . '.bsrch-start.is-done{border-left-color:#00a32a}'
        . '.bsrch-layouts td{padding:6px 10px 6px 0;vertical-align:top}.bsrch-layouts code{white-space:nowrap}'
    );
});

function bsrch_render_settings_page() {
    if (!current_user_can('manage_options')) return;

    $enabled = (bool) get_option('bsrch_global_launcher_enabled', 0);
    $appid   = bsrch_global_appid();
    $has_id  = $appid !== '';
    $allowed = ['a' => ['href' => [], 'target' => [], 'rel' => []], 'strong' => [], 'code' => []];
    ?>
    <div class="wrap">
        <h1><?php esc_html_e('BlueSearch', 'blue-search'); ?></h1>
        <p><?php esc_html_e('AI search and chat that answers your visitors from your own website content.', 'blue-search'); ?></p>

        <div class="bsrch-start<?php echo $has_id ? ' is-done' : ''; ?>">
            <?php if (!$has_id) : ?>
                <h2><?php esc_html_e('Get started in three steps', 'blue-search'); ?></h2>
                <ol>
                    <li>
                        <?php
                        echo wp_kses(
                            sprintf(
                                /* translators: %s: link to the BlueSearch website */
                                __('Create your assistant at %s. Enter your website address and BlueSearch reads your pages. The first month is a free trial.', 'blue-search'),
                                '<a href="' . esc_url(BSRCH_SIGNUP_URL) . '" target="_blank" rel="noopener noreferrer">blueboot.ai</a>'
                            ),
                            $allowed
                        );
                        ?>
                    </li>
                    <li>
                        <?php
                        echo wp_kses(
                            __('Copy your <strong>App ID</strong>. You find it at the top of the <strong>Install</strong> page in BlueSearch, or under <strong>Application</strong>.', 'blue-search'),
                            $allowed
                        );
                        ?>
                    </li>
                    <li><?php esc_html_e('Paste it below, tick "Show the chat button on every page" and save. Or add the BlueSearch block to any page.', 'blue-search'); ?></li>
                </ol>
                <p>
                    <a class="button button-primary" href="<?php echo esc_url(BSRCH_SIGNUP_URL); ?>" target="_blank" rel="noopener noreferrer">
                        <?php esc_html_e('Create your free assistant', 'blue-search'); ?>
                    </a>
                </p>
            <?php else : ?>
                <h2><?php esc_html_e('BlueSearch is connected', 'blue-search'); ?></h2>
                <p>
                    <?php
                    if ($enabled) {
                        esc_html_e('The chat button is shown on every page of your site.', 'blue-search');
                    } else {
                        esc_html_e('Turn on the chat button for the whole site below, or add the BlueSearch block to the pages where you want it.', 'blue-search');
                    }
                    ?>
                </p>
                <p>
                    <a href="<?php echo esc_url(BSRCH_SIGNUP_URL); ?>" target="_blank" rel="noopener noreferrer">
                        <?php esc_html_e('Open your BlueSearch dashboard', 'blue-search'); ?>
                    </a>
                    &nbsp;·&nbsp;
                    <a href="<?php echo esc_url(BSRCH_DOCS_URL); ?>" target="_blank" rel="noopener noreferrer">
                        <?php esc_html_e('Installation guide', 'blue-search'); ?>
                    </a>
                </p>
            <?php endif; ?>
        </div>

        <form method="post" action="options.php">
            <?php settings_fields('bsrch_settings_group'); ?>

            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="bsrch_global_appid"><?php esc_html_e('App ID', 'blue-search'); ?></label></th>
                    <td>
                        <input type="text"
                               id="bsrch_global_appid"
                               name="bsrch_global_appid"
                               class="regular-text"
                               value="<?php echo esc_attr($appid); ?>" />
                        <p class="description">
                            <?php esc_html_e('Used by the chat button, the BlueSearch block and the shortcodes, unless they set their own.', 'blue-search'); ?>
                        </p>
                    </td>
                </tr>

                <tr>
                    <th scope="row"><?php esc_html_e('Chat button', 'blue-search'); ?></th>
                    <td>
                        <label for="bsrch_global_launcher_enabled">
                            <input type="checkbox"
                                   id="bsrch_global_launcher_enabled"
                                   name="bsrch_global_launcher_enabled"
                                   value="1"
                                   <?php checked($enabled, true); ?> />
                            <?php esc_html_e('Show the chat button on every page', 'blue-search'); ?>
                        </label>
                        <p class="description">
                            <?php esc_html_e('A floating button in the corner of every page of your site. No theme changes needed.', 'blue-search'); ?>
                        </p>
                    </td>
                </tr>
            </table>

            <?php submit_button(); ?>
        </form>

        <hr />

        <h2><?php esc_html_e('Place it on specific pages', 'blue-search'); ?></h2>
        <p>
            <?php
            echo wp_kses(
                __('In the block editor, add the <strong>BlueSearch</strong> block and choose a layout. In other editors, use a shortcode:', 'blue-search'),
                $allowed
            );
            ?>
        </p>
        <table class="bsrch-layouts">
            <?php foreach (bsrch_layouts() as $layout) : ?>
                <tr>
                    <td><code>[<?php echo esc_html($layout['shortcode']); ?>]</code></td>
                    <td><strong><?php echo esc_html($layout['label']); ?></strong> – <?php echo esc_html($layout['help']); ?></td>
                </tr>
            <?php endforeach; ?>
        </table>
        <p class="description">
            <?php
            echo wp_kses(
                __('Optional: <code>defaultlang="no"</code> (or any supported language code) chooses the language for visitors who have not picked one. Otherwise the widget follows the visitor\'s browser.', 'blue-search'),
                $allowed
            );
            ?>
        </p>
    </div>
    <?php
}

/* =============================================================================
 * Chat button on every page (Settings → BlueSearch)
 * ============================================================================= */

/** True when the current page already places its own chat button. */
function bsrch_page_has_own_launcher() {
    global $post;
    if (!is_singular() || !($post instanceof WP_Post) || empty($post->post_content)) {
        return false;
    }
    if (has_shortcode($post->post_content, 'blue-search-launcher')) {
        return true;
    }
    if (function_exists('has_block') && has_block('blue-search/widget', $post)) {
        foreach (parse_blocks($post->post_content) as $block) {
            if (bsrch_block_tree_has_launcher($block)) return true;
        }
    }
    return false;
}

function bsrch_block_tree_has_launcher($block) {
    if (($block['blockName'] ?? '') === 'blue-search/widget'
        && (($block['attrs']['layout'] ?? 'embed') === 'launcher')) {
        return true;
    }
    foreach ($block['innerBlocks'] ?? [] as $inner) {
        if (bsrch_block_tree_has_launcher($inner)) return true;
    }
    return false;
}

function bsrch_maybe_queue_global_launcher() {
    if (is_admin()) return;
    if (!get_option('bsrch_global_launcher_enabled', 0)) return;

    $appid = bsrch_global_appid();
    if ($appid === '') return;

    // A page that places its own chat button does not get a second one.
    if (bsrch_page_has_own_launcher()) return;

    bsrch_enqueue_assets_for_shortcode();
    $GLOBALS['bsrch_launchers'][] = bsrch_widget_attr_pairs(
        array_merge(bsrch_widget_atts_defaults(), ['appid' => $appid])
    );
}
add_action('wp', 'bsrch_maybe_queue_global_launcher');

/* =============================================================================
 * Attributes shared by every layout (shortcodes and the block)
 *
 * The bundle is widget2 (./widget2 in this repository), the same widget
 * served at https://blueboot.ai/assets/widget/latest/. Title, logo, colours and
 * welcome text come from the assistant's own settings, looked up by appid, so
 * appid is all a page needs; when it is left out, the App ID saved under
 * Settings → BlueSearch is used. The rest are optional overrides.
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

function bsrch_widget_attr_pairs(array $a) {
    $lang  = bsrch_sanitize_lang($a['defaultlang'] !== '' ? $a['defaultlang'] : $a['lang']);
    $appid = bsrch_sanitize_slug($a['appid']);
    if ($appid === '') {
        $appid = bsrch_global_appid();
    }
    return [
        'appid'        => $appid,
        'defaultlang'  => $lang,
        'title'        => sanitize_text_field($a['title']),
        'assistantid'  => sanitize_text_field($a['assistantid']),
        'fontsize'     => sanitize_text_field($a['fontsize']),
        'fontfamily'   => sanitize_text_field($a['fontfamily']),
        'backcolor'    => sanitize_text_field($a['backcolor']),
        'messagecolor' => sanitize_text_field($a['messagecolor']),
    ];
}

function bsrch_widget_attrs(array $a) {
    return bsrch_build_attrs(bsrch_widget_attr_pairs($a));
}

/* =============================================================================
 * Renderers (one per kind of layout)
 * ============================================================================= */

/**
 * Chat button: queued for the end of <body>. Where it is placed, only an HTML
 * comment is left. Not an empty string: since WordPress 6.9, scripts enqueued
 * while rendering a block (ours, or the post content around it) are removed
 * again when that block's output is empty, which would leave the button
 * without its widget.
 */
function bsrch_render_launcher($atts) {
    bsrch_enqueue_assets_for_shortcode();
    $a = shortcode_atts(bsrch_widget_atts_defaults(), $atts, 'blue-search-launcher');
    $GLOBALS['bsrch_launchers'][] = bsrch_widget_attr_pairs($a);
    return '<!-- BlueSearch chat button -->';
}

/** Search box, panel, docked panel: in the page, with a width. */
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
        $width
    );

    return sprintf(
        '<div class="bb-embed-host" style="display:block;"><%1$s %2$s style="%3$s"></%1$s></div>',
        $tag,
        bsrch_widget_attrs($a),
        esc_attr($el_style)
    );
}

/** Icon: inline, no width. */
function bsrch_render_icon($atts) {
    bsrch_enqueue_assets_for_shortcode();
    $a = shortcode_atts(bsrch_widget_atts_defaults(), $atts, 'blue-search-embed-icon');
    return sprintf(
        '<blue-search-embed-icon %s style="%s"></blue-search-embed-icon>',
        bsrch_widget_attrs($a),
        esc_attr('display:inline-block;--bb-back:transparent;--bb-hdr-bg:transparent;')
    );
}

/**
 * Render any layout by key ('launcher', 'embed', 'icon', 'popup', 'docked').
 * Without an App ID (given, or saved in Settings) there is nothing to show:
 * the widget would only be an empty box, so nothing is output.
 */
function bsrch_render_layout($layout, $atts) {
    $layouts = bsrch_layouts();
    if (!isset($layouts[$layout])) $layout = 'embed';

    $probe = bsrch_widget_attr_pairs(shortcode_atts(bsrch_widget_atts_defaults(), $atts));
    if ($probe['appid'] === '') return '';

    if ($layout === 'launcher') return bsrch_render_launcher($atts);
    if ($layout === 'icon')     return bsrch_render_icon($atts);
    return bsrch_render_block_embed($layouts[$layout]['tag'], $atts);
}

/* =============================================================================
 * Shortcodes
 * ============================================================================= */
add_action('init', function () {
    foreach (bsrch_layouts() as $key => $layout) {
        add_shortcode($layout['shortcode'], function ($atts = []) use ($key) {
            return bsrch_render_layout($key, (array) $atts);
        });
    }
});

/* Avoid WordPress smart quotes breaking our shortcodes inside blocks */
add_filter('no_texturize_shortcodes', function ($shortcodes) {
    foreach (bsrch_layouts() as $layout) {
        $shortcodes[] = $layout['shortcode'];
    }
    return $shortcodes;
});

/* =============================================================================
 * Block: blue-search/widget (block/block.json, block/index.js)
 *
 * Rendered on the server by the same renderers as the shortcodes, so a block
 * and a shortcode with the same settings produce the same markup. The editor
 * shows a preview card, not the live widget.
 * ============================================================================= */
add_action('init', function () {
    if (!function_exists('register_block_type')) return;

    register_block_type(__DIR__ . '/block', [
        'render_callback' => 'bsrch_render_block',
    ]);

    $handle = function_exists('generate_block_asset_handle')
        ? generate_block_asset_handle('blue-search/widget', 'editorScript')
        : 'blue-search-widget-editor-script';
    wp_set_script_translations($handle, 'blue-search');

    // Tells the editor preview whether an App ID is saved in Settings.
    wp_add_inline_script(
        $handle,
        'window.bsrchBlock=' . wp_json_encode([
            'hasGlobalAppId' => bsrch_global_appid() !== '',
            'settingsUrl'    => admin_url('options-general.php?page=blue-search-settings'),
        ]) . ';',
        'before'
    );
});

function bsrch_render_block($attributes) {
    $layout = isset($attributes['layout']) ? (string) $attributes['layout'] : 'embed';
    $atts = [
        'appid'       => isset($attributes['appId']) ? (string) $attributes['appId'] : '',
        'defaultlang' => isset($attributes['defaultLang']) ? (string) $attributes['defaultLang'] : '',
    ];
    if (!empty($attributes['width'])) {
        $atts['width'] = (string) $attributes['width'];
    }

    return bsrch_render_layout($layout, $atts);
}

