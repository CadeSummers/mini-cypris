import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

/** Where the visitor's choice is remembered. */
export const AI_SUGGESTIONS_STORAGE_KEY = 'mini-cypris-ai-suggestions';

/**
 * Whether searches are sent to the AI model for suggestions (related searches
 * and "Did you mean").
 *
 * On by default. Turned off, a search from the Boolean box reaches CORE and
 * nothing else, which is what a visitor with confidential queries needs. The
 * plain-English box is not covered: typing a question there is itself a
 * request to the model. The choice is remembered in this browser.
 */
@Injectable({ providedIn: 'root' })
export class AiSuggestionsSetting {
  private readonly document = inject(DOCUMENT);
  private readonly _enabled = signal(this.initial());

  readonly enabled = this._enabled.asReadonly();

  set(enabled: boolean): void {
    this._enabled.set(enabled);
    try {
      this.document.defaultView?.localStorage.setItem(
        AI_SUGGESTIONS_STORAGE_KEY,
        enabled ? 'on' : 'off',
      );
    } catch {
      // Storage can be blocked (private windows); the choice then lasts for this visit.
    }
  }

  private initial(): boolean {
    try {
      return this.document.defaultView?.localStorage.getItem(AI_SUGGESTIONS_STORAGE_KEY) !== 'off';
    } catch {
      return true;
    }
  }
}
