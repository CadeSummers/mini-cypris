import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

/** Where the visitor's choice is remembered. index.html reads the same key before the app starts. */
export const THEME_STORAGE_KEY = 'mini-cypris-theme';

/**
 * The light or dark palette. The choice is written to `<html data-theme>`,
 * which swaps the design tokens in styles.scss.
 *
 * Until the visitor picks one, the theme follows the device setting. A pick is
 * remembered in this browser.
 */
@Injectable({ providedIn: 'root' })
export class ThemeStore {
  private readonly document = inject(DOCUMENT);
  private readonly _theme = signal<Theme>(this.initial());

  readonly theme = this._theme.asReadonly();

  constructor() {
    this.apply(this._theme());
  }

  toggle(): void {
    this.set(this._theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    // The attribute is written before the signal changes, so anything that
    // reacts to the signal already sees the new colours.
    this.apply(theme);
    this._theme.set(theme);
    try {
      this.document.defaultView?.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage can be blocked (private windows); the choice then lasts for this visit.
    }
  }

  private apply(theme: Theme): void {
    this.document.documentElement.setAttribute('data-theme', theme);
  }

  private initial(): Theme {
    const view = this.document.defaultView;
    try {
      const saved = view?.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // Fall through to the device setting.
    }
    return view?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}
