/**
 * BlueSearch block (editor side).
 *
 * Plain JavaScript using the WordPress globals, no build step, so this file is
 * the source. The block is rendered on the server (see bsrch_render_block() in
 * blue-search.php), so it saves nothing here: the editor shows a preview card
 * with the chosen layout, and the settings live in the sidebar.
 */
(function (wp) {
  'use strict';

  var el = wp.element.createElement;
  var __ = wp.i18n.__;
  var sprintf = wp.i18n.sprintf;
  var useBlockProps = wp.blockEditor.useBlockProps;
  var InspectorControls = wp.blockEditor.InspectorControls;
  var PanelBody = wp.components.PanelBody;
  var SelectControl = wp.components.SelectControl;
  var TextControl = wp.components.TextControl;
  var ExternalLink = wp.components.ExternalLink;

  var config = window.bsrchBlock || { hasGlobalAppId: false, settingsUrl: '' };

  // Same order and wording as the settings page.
  var LAYOUTS = [
    { value: 'launcher', label: __('Chat button', 'blue-search'), help: __('A floating button in the corner of the page.', 'blue-search') },
    { value: 'embed', label: __('Search box', 'blue-search'), help: __('An AI search field inside your page.', 'blue-search') },
    { value: 'icon', label: __('Icon', 'blue-search'), help: __('A compact mark for a header or menu.', 'blue-search') },
    { value: 'popup', label: __('Panel', 'blue-search'), help: __('The conversation already open, over your content.', 'blue-search') },
    { value: 'docked', label: __('Docked panel', 'blue-search'), help: __('The open conversation as part of the page.', 'blue-search') }
  ];

  // The 18 languages the widget speaks. Empty = follow the visitor.
  var LANGUAGES = [
    { value: '', label: __("Visitor's own language", 'blue-search') },
    { value: 'ar', label: __('Arabic', 'blue-search') },
    { value: 'zh', label: __('Chinese', 'blue-search') },
    { value: 'da', label: __('Danish', 'blue-search') },
    { value: 'en', label: __('English', 'blue-search') },
    { value: 'fi', label: __('Finnish', 'blue-search') },
    { value: 'fr', label: __('French', 'blue-search') },
    { value: 'de', label: __('German', 'blue-search') },
    { value: 'he', label: __('Hebrew', 'blue-search') },
    { value: 'it', label: __('Italian', 'blue-search') },
    { value: 'ja', label: __('Japanese', 'blue-search') },
    { value: 'ko', label: __('Korean', 'blue-search') },
    { value: 'no', label: __('Norwegian', 'blue-search') },
    { value: 'pl', label: __('Polish', 'blue-search') },
    { value: 'pt', label: __('Portuguese', 'blue-search') },
    { value: 'ru', label: __('Russian', 'blue-search') },
    { value: 'es', label: __('Spanish', 'blue-search') },
    { value: 'sv', label: __('Swedish', 'blue-search') },
    { value: 'uk', label: __('Ukrainian', 'blue-search') }
  ];

  function findLayout(value) {
    for (var i = 0; i < LAYOUTS.length; i++) {
      if (LAYOUTS[i].value === value) return LAYOUTS[i];
    }
    return LAYOUTS[1];
  }

  // The BlueSearch magnifier, in the logo's grey-blue.
  function magnifier(size) {
    return el(
      'svg',
      { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' },
      el('circle', { cx: 10.5, cy: 10, r: 6.8, fill: 'none', stroke: '#8a9aa8', strokeWidth: 2.4 }),
      el('path', { d: 'M10.6 5.6c1.9 1.1 2.6 3.3 1.8 5.3', fill: 'none', stroke: '#8a9aa8', strokeWidth: 1.6, strokeLinecap: 'round' }),
      el('path', { d: 'M13.6 16.2l3.1 5.2', fill: 'none', stroke: '#8a9aa8', strokeWidth: 2.4, strokeLinecap: 'round' })
    );
  }

  function Edit(props) {
    var a = props.attributes;
    var set = props.setAttributes;
    var layout = findLayout(a.layout);
    var hasId = (a.appId && a.appId.trim() !== '') || config.hasGlobalAppId;
    var hasWidth = a.layout === 'embed' || a.layout === 'popup' || a.layout === 'docked';

    var blockProps = useBlockProps({
      className: 'bsrch-block-preview' + (hasId ? '' : ' is-missing-id')
    });

    var description = a.layout === 'launcher'
      ? __('The chat button appears in the corner of this page when it is published.', 'blue-search')
      : layout.help;

    var sidebar = el(
      InspectorControls,
      null,
      el(
        PanelBody,
        { title: __('BlueSearch settings', 'blue-search'), initialOpen: true },
        el(SelectControl, {
          label: __('Layout', 'blue-search'),
          value: a.layout,
          options: LAYOUTS.map(function (l) { return { value: l.value, label: l.label }; }),
          help: layout.help,
          onChange: function (v) { set({ layout: v }); }
        }),
        el(TextControl, {
          label: __('App ID', 'blue-search'),
          value: a.appId,
          placeholder: config.hasGlobalAppId ? __('From Settings → BlueSearch', 'blue-search') : '',
          help: config.hasGlobalAppId
            ? __('Leave empty to use the App ID saved in Settings → BlueSearch.', 'blue-search')
            : __('Paste your App ID, or save it once in Settings → BlueSearch.', 'blue-search'),
          onChange: function (v) { set({ appId: v.replace(/[^A-Za-z0-9_\-]/g, '') }); }
        }),
        el(SelectControl, {
          label: __('Language', 'blue-search'),
          value: a.defaultLang,
          options: LANGUAGES,
          help: __('For visitors who have not chosen a language. They can always change it in the widget.', 'blue-search'),
          onChange: function (v) { set({ defaultLang: v }); }
        }),
        hasWidth && el(TextControl, {
          label: __('Width', 'blue-search'),
          value: a.width,
          placeholder: '100%',
          help: __('For example 100%, 600px or 40rem. Leave empty for full width.', 'blue-search'),
          onChange: function (v) { set({ width: v }); }
        })
      ),
      el(
        PanelBody,
        { title: __('Help', 'blue-search'), initialOpen: false },
        el('p', null,
          el(ExternalLink, { href: 'https://blueboot.ai/bs/docs/install-guide' }, __('Installation guide', 'blue-search'))
        ),
        config.settingsUrl && el('p', null,
          el('a', { href: config.settingsUrl }, __('Settings → BlueSearch', 'blue-search'))
        )
      )
    );

    var preview = el(
      'div',
      blockProps,
      el('span', { className: 'bsrch-block-preview__icon' }, magnifier(36)),
      el('div', null,
        el('p', { className: 'bsrch-block-preview__title' },
          /* translators: %s: layout name, e.g. "Search box" */
          sprintf(__('BlueSearch – %s', 'blue-search'), layout.label)
        ),
        el('p', { className: 'bsrch-block-preview__text' }, description),
        !hasId && el('p', { className: 'bsrch-block-preview__warning' },
          __('Add your App ID in the block settings, or save it in Settings → BlueSearch. Without it, nothing is shown on the page.', 'blue-search')
        )
      )
    );

    return el(wp.element.Fragment, null, sidebar, preview);
  }

  wp.blocks.registerBlockType('blue-search/widget', {
    icon: magnifier(24),
    edit: Edit,
    save: function () { return null; }
  });
})(window.wp);
