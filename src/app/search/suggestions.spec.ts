import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AiOutcome, AiQuery } from '../ai/ai-query';
import { Suggestions } from './suggestions';

describe('Suggestions', () => {
  let fixture: ComponentFixture<Suggestions>;
  let asked: { mode: string; text: string; answer: Subject<AiOutcome> }[];
  let picked: string[];

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ').trim();
  const buttons = () => [...el().querySelectorAll('button')];

  async function set(inputs: { query?: string; noResults?: boolean }): Promise<void> {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  }

  async function answer(index: number, outcome: AiOutcome): Promise<void> {
    asked[index].answer.next(outcome);
    asked[index].answer.complete();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    asked = [];
    picked = [];
    const ai = {
      ask: (mode: string, text: string) => {
        const answer = new Subject<AiOutcome>();
        asked.push({ mode, text, answer });
        return answer;
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: AiQuery, useValue: ai }] });
    fixture = TestBed.createComponent(Suggestions);
    fixture.componentInstance.picked.subscribe((query) => picked.push(query));
    await set({ query: 'drone AND delivery' });
  });

  it('asks the model nothing when a search has results', () => {
    expect(asked).toEqual([]);
    expect(text()).toContain('Suggest related searches');
  });

  it('asks for a spelling correction only when nothing was found', async () => {
    await set({ query: '"Abiogenisis" AND "Exoplanet"', noResults: true });
    expect(asked.map(({ mode, text }) => ({ mode, text }))).toEqual([
      // Sent the way CORE receives it, without the quotes around single words.
      { mode: 'correct', text: 'Abiogenisis AND Exoplanet' },
    ]);

    await answer(0, { kind: 'queries', queries: ['abiogenesis AND exoplanet'] });
    expect(text()).toContain('Did you mean abiogenesis AND exoplanet');

    buttons()[0].click();
    expect(picked).toEqual(['abiogenesis AND exoplanet']);
  });

  it('stays quiet when there is no correction to offer', async () => {
    await set({ noResults: true });
    await answer(0, { kind: 'refused', reason: 'unclear' });
    expect(text()).not.toContain('Did you mean');

    // Nor when the model cannot be reached: the "no papers" message is enough.
    await set({ query: 'another query' });
    await answer(1, { kind: 'unavailable' });
    expect(text()).not.toContain('Did you mean');
  });

  it('drops a correction once the query changes', async () => {
    await set({ noResults: true });
    await answer(0, { kind: 'queries', queries: ['drones AND delivery'] });
    expect(text()).toContain('Did you mean');

    await set({ query: 'uav', noResults: false });
    expect(text()).not.toContain('Did you mean');
  });

  it('suggests related searches only when asked, and offers each as a button', async () => {
    buttons()[0].click();
    await fixture.whenStable();
    expect(asked.map(({ mode, text }) => ({ mode, text }))).toEqual([
      { mode: 'related', text: 'drone AND delivery' },
    ]);
    expect(text()).toContain('Thinking of related searches');

    await answer(0, { kind: 'queries', queries: ['uav AND parcel', 'drone AND logistics'] });
    expect(buttons().map((button) => button.textContent!.trim())).toEqual([
      'uav AND parcel',
      'drone AND logistics',
    ]);

    buttons()[1].click();
    expect(picked).toEqual(['drone AND logistics']);
  });

  it('forgets related searches that belong to an earlier query', async () => {
    buttons()[0].click();
    await set({ query: 'uav' });
    // The answer for the earlier query arrives late and is ignored.
    await answer(0, { kind: 'queries', queries: ['uav AND parcel'] });

    expect(text()).toContain('Suggest related searches');
    expect(text()).not.toContain('uav AND parcel');
  });

  it.each<[AiOutcome, string]>([
    [{ kind: 'refused', reason: 'unclear' }, 'No related searches to suggest'],
    [{ kind: 'limited', retryAt: null }, 'Try again in a minute'],
    [{ kind: 'unavailable' }, 'Suggestions are unavailable right now'],
  ])('explains %o', async (outcome, message) => {
    buttons()[0].click();
    await answer(0, outcome);
    expect(text()).toContain(message);
  });
});
