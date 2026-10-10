import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Message } from '../../models/chat-message.model';

/**
 * The small form the visitor sees when the backend asks who they are, in place
 * of a written reply (see the contact pre-step in contact-pre-call.ts).
 *
 * Presentational only: it collects values and emits them. Deciding what to do
 * with them — putting them on chatInfo, sending the follow-up turn — belongs
 * with the conversation logic, not in a form.
 */
@Component({
  selector: 'app-contact-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contact-form.component.html',
  styleUrl: './contact-form.component.css',
})
export class ContactFormComponent implements OnInit {
  @Input({ required: true }) message!: Message;
  @Input() t: (key: string) => string = () => '';

  /**
   * What the visitor told us last time, if anything — see loadContact().
   * Supplied by the host rather than read here so this component keeps no
   * dependency on storage, and so the embed and panel widgets can scope it
   * the same way they scope everything else.
   */
  @Input() remembered?: { name?: string; info?: string };

  /** Field key -> what the visitor typed. */
  values: Record<string, string> = {};

  ngOnInit(): void {
    // Prefill rather than autofill-and-submit: they still see exactly what is
    // about to be sent, and can correct it. Someone who has already given
    // their number once should not have to find it again.
    if (this.remembered) {
      if (this.remembered.name) this.values['name'] = this.remembered.name;
      if (this.remembered.info) this.values['info'] = this.remembered.info;
    }
  }

  @Output() submitted = new EventEmitter<{ message: Message; values: Record<string, string> }>();
  @Output() skipped = new EventEmitter<{ message: Message }>();

  /**
   * The visitor changed their mind about asking for a person at all.
   *
   * Distinct from `skipped`, which still goes ahead — that one hands the
   * request over without details. This one withdraws the request: nothing is
   * sent, no session opens, and the host removes the message from the
   * conversation so the ask is not left sitting there half-answered.
   */
  @Output() cancelled = new EventEmitter<{ message: Message }>();

  /**
   * The visitor asked to forget what is remembered about them.
   *
   * Separate from `cancelled` because the two differ in what they leave behind:
   * cancelling withdraws this request and leaves the stored details alone, this
   * erases the details and leaves the form open to type new ones. Emitted so
   * the host can clear the cache — the component has no business touching
   * storage itself.
   */
  @Output() cleared = new EventEmitter<{ message: Message }>();

  get fields() {
    return this.message.contactRequest?.fields ?? [];
  }

  /**
   * The field's label, in the visitor's language.
   *
   * Resolved here rather than used as sent: the backend builds the fields
   * (contactRequestFields() in contact-pre-call.ts) and has no idea what
   * language this visitor is reading in, so its label is English. The widget
   * does know — it is already rendering every other string through `t` — so
   * the wire label is treated as a fallback for a key we don't have a
   * translation for, not as the text to display.
   */
  labelFor(field: { key: string; label?: string }): string {
    const key = field.key === 'name' ? 'contactFieldName'
        : field.key === 'info' ? 'contactFieldInfo'
        : '';

    return (key && this.t(key)) || field.label || '';
  }

  /**
   * Example text in the input itself.
   *
   * The contact field especially needs one: called "Contact info" and left
   * blank, most people assume email and stop there. Showing three unlike
   * examples is what tells them the field really does take whatever they
   * prefer — which is the whole point of it being free text.
   */
  placeholderFor(key: string): string {
    if (key === 'name') {
      return this.t('contactNamePlaceholder') || 'e.g. Anna';
    }
    if (key === 'info') {
      return this.t('contactInfoPlaceholder') || 'Email, phone, or wherever suits you';
    }
    return '';
  }

  get reason(): string {
    return this.message.contactRequest?.reason?.trim() || '';
  }

  get skippable(): boolean {
    return this.message.contactRequest?.skippable !== false;
  }

  /** Already submitted or skipped — show the outcome, not the form again. */
  get answered(): boolean {
    return !!this.message.contactAnswered;
  }

  /**
   * What was actually shared, as label/value pairs for display.
   *
   * Shown back to the visitor rather than a bare "passed that on": they just
   * handed over personal details, and being told exactly what was sent — and
   * being able to re-read it later — is the difference between an
   * acknowledgement and a claim they have to take on trust. Empty when the
   * form was dismissed.
   */
  get answerLines(): Array<{ label: string; value: string }> {
    const answer = this.message.contactAnswer ?? {};
    return this.fields
      // labelFor(), not f.label — the acknowledgement has to read in the same
      // language as the form the visitor just filled in.
      .map(f => ({ label: this.labelFor(f), value: (answer[f.key] || '').trim() }))
      .filter(line => !!line.value);
  }

  /** Dismissed, or submitted with everything left blank. */
  get wasSkipped(): boolean {
    return this.answered && this.answerLines.length === 0;
  }

  /**
   * Submit is blocked only by an empty *required* field. A form where every
   * field is optional is still submittable while empty — that is the visitor
   * declining by another route, and refusing them would be worse than
   * accepting an empty answer.
   */
  get canSubmit(): boolean {
    return this.fields
      .filter(f => f.required)
      .every(f => (this.values[f.key] || '').trim().length > 0);
  }

  onSubmit(): void {
    if (!this.canSubmit) return;

    const trimmed: Record<string, string> = {};
    for (const field of this.fields) {
      const value = (this.values[field.key] || '').trim();
      if (value) trimmed[field.key] = value;
    }

    this.submitted.emit({ message: this.message, values: trimmed });
  }

  onSkip(): void {
    this.skipped.emit({ message: this.message });
  }

  onCancel(): void {
    this.cancelled.emit({ message: this.message });
  }

  /**
   * Forget the details entirely — here and in storage.
   *
   * Distinct from all three above, and the only one that reaches backwards: the
   * others decide what happens with this request, while this one withdraws
   * details the visitor gave earlier. Someone who typed a phone number on a
   * shared machine needs a way to take it back that is not "wait twenty-four
   * hours for the cache to lapse".
   *
   * The fields are emptied here rather than waiting for the host, so the effect
   * is visible in the form the visitor is looking at. The host does the durable
   * half — see onContactCleared().
   */
  onClear(): void {
    for (const field of this.fields) this.values[field.key] = '';
    this.cleared.emit({ message: this.message });
  }

  /**
   * Only offered when there is something to clear. A "Clear" button beside two
   * empty fields is a control that cannot do anything, and the visitor cannot
   * tell that from one that silently failed.
   */
  get canClear(): boolean {
    if (this.remembered?.name || this.remembered?.info) return true;
    return this.fields.some(f => (this.values[f.key] || '').trim().length > 0);
  }
}
