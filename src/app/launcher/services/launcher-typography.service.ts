import { Injectable } from '@angular/core';

export type LauncherTypography = {
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
};

@Injectable({ providedIn: 'root' })
export class LauncherTypographyService {
  readonly defaultFontFamily =
    'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  readonly defaultFontSize = '16px';
  readonly defaultLineHeight = '1.45';

  sanitizeFontSize(v?: string): string | undefined {
    const s = String(v ?? '').trim();
    if (!s) return undefined;

    const m = s.match(/^(\d+(?:\.\d+)?)\s*px$/i);

    if (m) {
      const n = Number(m[1]);
      if (!Number.isFinite(n)) return this.defaultFontSize;

      const clamped = Math.max(10, Math.min(22, n));
      return `${clamped}px`;
    }

    if (['small', 'medium', 'large'].includes(s.toLowerCase())) return s;

    return this.defaultFontSize;
  }

  sanitizeLineHeight(v?: string): string | undefined {
    const s = String(v ?? '').trim();
    if (!s) return undefined;

    const n = Number(s);

    if (Number.isFinite(n)) {
      const clamped = Math.max(1.1, Math.min(2.0, n));
      return String(clamped);
    }

    return this.defaultLineHeight;
  }

  sanitizeFontFamily(v?: string): string | undefined {
    const s = String(v ?? '').trim();
    if (!s) return undefined;
    if (s.length > 200) return this.defaultFontFamily;

    return s;
  }

  nonEmpty(v: any): string | undefined {
    const s = String(v ?? '').trim();
    return s ? s : undefined;
  }

  fromWidgetParams(wp: any): LauncherTypography {
    const ffRaw =
      this.nonEmpty(wp?.fontFamily) ??
      this.nonEmpty(wp?.uiFontFamily) ??
      this.defaultFontFamily;

    const fsRaw =
      this.nonEmpty(wp?.fontSize) ??
      this.nonEmpty(wp?.uiFontSize) ??
      this.defaultFontSize;

    const lhRaw =
      this.nonEmpty(wp?.lineHeight) ??
      this.nonEmpty(wp?.uiLineHeight) ??
      this.defaultLineHeight;

    return {
      fontFamily: this.sanitizeFontFamily(ffRaw) ?? this.defaultFontFamily,
      fontSize: this.sanitizeFontSize(fsRaw) ?? this.defaultFontSize,
      lineHeight: this.sanitizeLineHeight(lhRaw) ?? this.defaultLineHeight,
    };
  }

  /**
   * Only sets a property when a value is actually supplied. Writing all
   * three unconditionally (as this used to) means an inline style on the
   * host — which always beats any stylesheet rule — even when nothing was
   * ever explicitly configured, permanently pinning the panel to a stale
   * value. Skipping unset ones lets the CSS default apply instead.
   *
   * fontSize specifically goes to --bb-font-size-base, not --bb-font-size:
   * chat.component.css derives the actual --bb-font-size from that base
   * (1:1 on desktop, scaled up under its mobile @media rule), so the
   * mobile bump stays relative to whatever the base is — an explicit
   * override included — rather than only applying when nothing was set.
   */
  applyToElement(el: HTMLElement, typography: Partial<LauncherTypography>): void {
    if (typography.fontFamily) el.style.setProperty('--bb-font-family', typography.fontFamily);
    if (typography.fontSize) el.style.setProperty('--bb-font-size-base', typography.fontSize);
    if (typography.lineHeight) el.style.setProperty('--bb-line-height', typography.lineHeight);
  }
}
