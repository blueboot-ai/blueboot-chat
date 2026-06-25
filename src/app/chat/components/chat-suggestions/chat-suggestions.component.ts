import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  QueryList,
  SimpleChanges,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-chat-suggestions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chat-suggestions.component.html',
  styleUrl: './chat-suggestions.component.css',
})
export class ChatSuggestionsComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() suggestions: string[] = [];
  @Input() showSuggestions = true;
  @Input() isEmpty = true;
  @Input() isComposing = false;

  @Input() composerEl?: HTMLElement;
  @Input() historyEl?: HTMLElement;

  @Input() t: (key: string) => string = () => '';

  @Output() applySuggestion = new EventEmitter<string>();

  @ViewChild('suggestionsBar') suggestionsBar?: ElementRef<HTMLElement>;
  @ViewChildren('suggBtn') suggBtns!: QueryList<ElementRef<HTMLButtonElement>>;

  visibleSuggestionCount = 0;
  hiddenSuggestionsCount = 0;

  suggestionsModalOpen = false;
  modalPage = 0;
  modalPageSize = 12;
  modalTotalPages = 1;
  pagedSuggestions: string[] = [];

  private resizeObserver?: ResizeObserver;
  private btnChangesSub?: Subscription;
  private reflowLock = false;
  private reflowTimer: any;

  trackBySuggestion = (_: number, s: string) => s;

  get shouldShowSuggestions(): boolean {
    return !!this.showSuggestions && this.isEmpty && !this.isComposing && !!this.suggestions?.length;
  }

  ngAfterViewInit() {
    this.btnChangesSub = this.suggBtns?.changes?.subscribe(() => {
      this.scheduleReflow(20);
    });

    this.recomputeModalPage();
    this.initResizeObserver();
    this.scheduleReflow(30);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (
      changes['suggestions'] ||
      changes['showSuggestions'] ||
      changes['isEmpty'] ||
      changes['isComposing']
    ) {
      this.recomputeModalPage();
      this.scheduleReflow(30);
    }

    if (changes['composerEl'] || changes['historyEl']) {
      this.initResizeObserver();
      this.scheduleReflow(30);
    }
  }

  ngOnDestroy() {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.btnChangesSub) this.btnChangesSub.unsubscribe();
    if (this.reflowTimer) clearTimeout(this.reflowTimer);
  }

  onApplySuggestion(s: string) {
    this.applySuggestion.emit(s);
  }

  openSuggestionsModal() {
    this.modalPage = 0;
    this.recomputeModalPage();
    this.suggestionsModalOpen = true;
  }

  closeSuggestionsModal() {
    this.suggestionsModalOpen = false;
  }

  nextSuggestionsPage() {
    this.modalPage = Math.min(this.modalPage + 1, this.modalTotalPages - 1);
    this.recomputeModalPage();
  }

  prevSuggestionsPage() {
    this.modalPage = Math.max(this.modalPage - 1, 0);
    this.recomputeModalPage();
  }

  private recomputeModalPage() {
    const total = this.suggestions?.length || 0;
    const pages = Math.max(1, Math.ceil(total / this.modalPageSize));

    this.modalTotalPages = pages;
    this.modalPage = Math.min(Math.max(0, this.modalPage), pages - 1);

    const start = this.modalPage * this.modalPageSize;
    const end = Math.min(total, start + this.modalPageSize);

    this.pagedSuggestions = this.suggestions.slice(start, end);
  }

  private scheduleReflow(delay = 0) {
    if (this.reflowTimer) clearTimeout(this.reflowTimer);
    this.reflowTimer = setTimeout(() => this.reflowSuggestions(), delay);
  }

  private initResizeObserver() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }

    const bar = this.suggestionsBar?.nativeElement;
    if (!bar && !this.composerEl && !this.historyEl) return;

    this.resizeObserver = new ResizeObserver(() => {
      if (this.reflowLock) return;
      this.scheduleReflow(30);
    });

    if (bar) this.resizeObserver.observe(bar);
    if (this.composerEl) this.resizeObserver.observe(this.composerEl);
    if (this.historyEl) this.resizeObserver.observe(this.historyEl);
  }

  private reflowSuggestions() {
    if (this.reflowLock) return;

    if (!this.shouldShowSuggestions) {
      this.visibleSuggestionCount = 0;
      this.hiddenSuggestionsCount = 0;
      return;
    }

    const bar = this.suggestionsBar?.nativeElement;
    const composer = this.composerEl;
    const btns = this.suggBtns?.toArray().map(r => r.nativeElement) || [];
    const total = btns.length;

    if (!bar || !composer || !total) {
      this.visibleSuggestionCount = Math.min(1, this.suggestions.length);
      this.hiddenSuggestionsCount = Math.max(0, this.suggestions.length - this.visibleSuggestionCount);
      return;
    }

    this.reflowLock = true;
    this.visibleSuggestionCount = total;
    this.hiddenSuggestionsCount = 0;

    requestAnimationFrame(() => {
      const barRect = bar.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      const available = Math.max(60, (composerRect.top - barRect.top) - 10);
      const fitsNow = () => bar.scrollHeight <= available;

      if (fitsNow()) {
        this.visibleSuggestionCount = total;
        this.hiddenSuggestionsCount = 0;
        this.reflowLock = false;
        return;
      }

      let lo = 1;
      let hi = total;
      let best = 1;

      const apply = (n: number) => {
        this.visibleSuggestionCount = n;
        this.hiddenSuggestionsCount = total - n;
      };

      const test = (n: number) =>
        new Promise<boolean>((resolve) => {
          apply(n);
          requestAnimationFrame(() => resolve(fitsNow()));
        });

      (async () => {
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          const ok = await test(mid);

          if (ok) {
            best = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }

        apply(best);

        requestAnimationFrame(() => {
          while (this.visibleSuggestionCount > 1 && !fitsNow()) {
            apply(this.visibleSuggestionCount - 1);
          }

          this.reflowLock = false;
        });
      })();
    });
  }
}
