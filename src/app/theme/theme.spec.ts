import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY, ThemeStore } from './theme';

describe('ThemeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.resetTestingModule();
  });

  it('starts light when nothing is saved and the device does not ask for dark', () => {
    const store = TestBed.inject(ThemeStore);

    expect(store.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('starts with the saved choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    const store = TestBed.inject(ThemeStore);

    expect(store.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores a saved value it does not know', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');

    expect(TestBed.inject(ThemeStore).theme()).toBe('light');
  });

  it('toggles, updates the page and remembers the choice', () => {
    const store = TestBed.inject(ThemeStore);

    store.toggle();
    expect(store.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    store.toggle();
    expect(store.theme()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});
