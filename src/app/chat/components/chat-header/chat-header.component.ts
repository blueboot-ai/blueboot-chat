import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DEFAULT_WIDGET_THEME } from '../../../core/theme/default-widget-theme';
import { resolveHeaderText } from '../../../core/theme/header-contrast';
import { LangPickerComponent } from '../../../core/components/lang-picker/lang-picker.component';

@Component({
  selector: 'app-chat-header',
  standalone: true,
  imports: [CommonModule, LangPickerComponent],
  templateUrl: './chat-header.component.html',
  styleUrl: './chat-header.component.css',
})
export class ChatHeaderComponent {
  @Input() mode: 'compact' | 'full' = 'compact';

  @Input() title = 'Assistant';
  @Input() displayName?: string;

  @Input() logo?: string;
  @Input() logoAlt?: string;
  @Input() logoVisible = true;

  @Input() headerIsRound = true;
  @Input() headerLogoBg?: string;
  @Input() headerLogoInitialLocal = true;
  @Input() headerBg?: string | null;
  @Input() headerText?: string | null;

  @Input() t: (key: string) => string = () => '';

  /** The language being rendered, for the picker in the actions group. */
  @Input() currentLang = '';
  /**
   * Hide the language control entirely.
   *
   * Set when the host declared a language on the tag. That is an instruction
   * about what language this widget speaks, not a starting point — offering a
   * picker beside it would let a visitor contradict the embed and, because the
   * choice is then remembered, keep contradicting it on later visits. A site
   * that wants visitors to choose simply does not declare one.
   */
  @Input() langLocked = false;

  /**
   * `null` used to be read as a deliberate "make it transparent" signal —
   * but the backend sends widgetParams fields as `null`, not omitted, when
   * an app simply hasn't configured them (confirmed for logoSrc/title, same
   * pattern everywhere else). That made "not configured" indistinguishable
   * from "force transparent", so every app with no headerBg/headerText of
   * its own rendered a transparent header instead of the default theme —
   * there is no `<input type="color">` that can even produce a real null to
   * legitimately ask for transparency, so this only ever fired by accident.
   * `null`/undefined/'' all just mean "the app hasn't set one" now, which is
   * where the shared default theme kicks in.
   */
  get effectiveHeaderBg(): string {
    return this.headerBg || DEFAULT_WIDGET_THEME.headerBg;
  }

  /**
   * Matched to the background rather than defaulted on its own.
   *
   * These two settings were independent, and the default pair is a navy header
   * with near-white text. Change only the background — the usual case; the
   * background is the visible brand choice, the text colour is not something
   * anyone thinks to pick — and the near-white text stayed. On a white header
   * the title greys out and the icons, which inherit this at opacity .85,
   * disappear: it reads as though something is dimming the header, and nothing
   * is. The same happens to an app that has white stored in headerText from
   * when its header was dark, so readability is checked whether the colour was
   * configured or defaulted. See resolveHeaderText.
   */
  get effectiveHeaderText(): string {
    return resolveHeaderText(this.headerText, this.effectiveHeaderBg);
  }

  get effectiveHeaderLogoBg(): string {
    return this.headerLogoBg || DEFAULT_WIDGET_THEME.headerLogoBg;
  }

  @Output() toggleFullscreen = new EventEmitter<HTMLButtonElement>();
  @Output() close = new EventEmitter<void>();
  @Output() newChat = new EventEmitter<void>();
  @Output() logoError = new EventEmitter<void>();

  /** A language the visitor chose. Relayed up: switching re-seeds the string
   *  packs and re-runs buildConfig, which is chat-core's work. */
  @Output() langPicked = new EventEmitter<string>();

  /**
   * chat-core's applyConfig() already guarantees `title` is never blank —
   * it falls back to the compiled pack for the active language before it
   * ever reaches this component. This is the last-resort backstop beneath
   * that, so it should use the same localized source (via `t()`, which
   * itself falls back to the pack) rather than a hardcoded English word.
   */
  get titleText(): string {
    return this.title || this.displayName || this.t('assistant') || 'Assistant';
  }

  onToggleFullscreen(btn: HTMLButtonElement) {
    this.toggleFullscreen.emit(btn);
  }
}
