import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SearchBar, clampLimit } from './search-bar';
import { SearchRequest } from './search-store';

describe('clampLimit', () => {
  it('keeps values within what CORE accepts', () => {
    expect(clampLimit('25')).toBe(25);
    expect(clampLimit('0')).toBe(1);
    expect(clampLimit('-4')).toBe(1);
    expect(clampLimit('5000')).toBe(100);
    expect(clampLimit('12.9')).toBe(12);
  });

  it('falls back when the input is not a number', () => {
    expect(clampLimit('', 30)).toBe(30);
    expect(clampLimit('abc', 30)).toBe(30);
  });
});

describe('SearchBar', () => {
  let fixture: ComponentFixture<SearchBar>;
  let emitted: SearchRequest[];

  const el = () => fixture.nativeElement as HTMLElement;
  const queryInput = () => el().querySelector<HTMLInputElement>('#query')!;
  const limitInput = () => el().querySelector<HTMLInputElement>('#limit')!;

  async function type(input: HTMLInputElement, value: string, event: string) {
    input.value = value;
    input.dispatchEvent(new Event(event));
    await fixture.whenStable();
  }

  async function submit() {
    el()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(SearchBar);
    emitted = [];
    fixture.componentInstance.submitted.subscribe((request) => emitted.push(request));
    await fixture.whenStable();
  });

  it('emits the trimmed query with the chosen limit', async () => {
    await type(queryInput(), '  (drone AND (package OR delivery)) ', 'input');
    await type(limitInput(), '25', 'change');
    await submit();

    expect(emitted).toEqual([{ query: '(drone AND (package OR delivery))', limit: 25 }]);
  });

  it('blocks a malformed query and explains why', async () => {
    await type(queryInput(), '(drone AND package', 'input');
    await submit();

    expect(emitted).toEqual([]);
    expect(el().querySelector('.issue')?.textContent).toContain('never closed');
    expect(queryInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('hints when a field name is one CORE does not have', async () => {
    await type(queryInput(), 'drone AND year>=2020', 'input');
    expect(el().querySelector('.hint')?.textContent).toContain('yearPublished');
  });

  it('applies a tip with one click', async () => {
    await type(queryInput(), 'drone AND year>=2020', 'input');
    el().querySelector<HTMLButtonElement>('.fix')?.click();
    await fixture.whenStable();

    expect(queryInput().value).toBe('drone AND yearPublished>=2020');
    expect(el().querySelector('.hint')).toBeNull();
  });

  it('snaps an out-of-range limit back into range', async () => {
    await type(limitInput(), '5000', 'change');
    expect(limitInput().value).toBe('100');
  });

  it('re-runs the applied search when the limit changes', async () => {
    fixture.componentRef.setInput('query', 'drone');
    await fixture.whenStable();

    await type(limitInput(), '40', 'change');
    expect(emitted).toEqual([{ query: 'drone', limit: 40 }]);
  });

  it('does not search on a limit change before any search has run', async () => {
    await type(queryInput(), 'drone', 'input');
    await type(limitInput(), '40', 'change');
    expect(emitted).toEqual([]);
  });
});
