import { TestBed } from '@angular/core/testing';
import { AiLimitNotice, waitText } from './ai-limit-notice';

describe('waitText', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  const after = (seconds: number) => new Date(now.getTime() + seconds * 1000);

  it.each([
    [1, 'about 10 seconds'],
    [38, 'about 40 seconds'],
    [59, 'about 60 seconds'],
    [60, 'about 1 minute'],
    [61, 'about 2 minutes'],
    [3599, 'about 60 minutes'],
    [3600, 'about 1 hour'],
    [5 * 3600 + 1, 'about 6 hours'],
  ])('describes %i seconds as "%s"', (seconds, expected) => {
    expect(waitText(after(seconds), now)).toBe(expected);
  });

  it('never gives a wait of zero for a time already passed', () => {
    expect(waitText(after(-30), now)).toBe('about 10 seconds');
  });
});

describe('AiLimitNotice', () => {
  async function render(scope: 'visitor' | 'model', retryAt: Date | null): Promise<string> {
    const fixture = TestBed.createComponent(AiLimitNotice);
    fixture.componentRef.setInput('scope', scope);
    fixture.componentRef.setInput('retryAt', retryAt);
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ').trim();
  }

  it('names the model and says how long this visitor should wait', async () => {
    const text = await render('visitor', new Date(Date.now() + 45_000));

    expect(text).toContain('The AI model (Llama) has received too many requests from you');
    expect(text).toMatch(/It will take requests again in about 50 seconds, at \d/);
  });

  it('says when the limit is on the whole demo, not this visitor', async () => {
    const text = await render('model', new Date(Date.now() + 5 * 3600_000));

    expect(text).toContain('too many requests from all visitors of this demo');
    expect(text).toMatch(/in about 5 hours, at \d/);
  });

  it('falls back to a minute when no time is known', async () => {
    expect(await render('visitor', null)).toContain('Try again in a minute.');
  });
});
