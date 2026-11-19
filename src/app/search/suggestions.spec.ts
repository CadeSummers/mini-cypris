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
  const labels = () => buttons().map((button) => button.textContent!.trim());
  const questions = () => asked.map(({ mode, text }) => ({ mode, text }));
  /** The position in `asked` of the latest question of one kind. */
  const last = (mode: string) => asked.map((call) => call.mode).lastIndexOf(mode);

  async function set(inputs: {
    query?: string;
    noResults?: boolean;
    failed?: boolean;
  }): Promise<void> {
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

  it('asks for related searches by itself, and offers each as a button', async () => {
    expect(questions()).toEqual([{ mode: 'related', text: 'drone AND delivery' }]);
    expect(text()).toContain('Thinking of related searches');

    await answer(0, { kind: 'queries', queries: ['uav AND parcel', 'drone AND logistics'] });
    expect(text()).toContain('Related searches (written by an AI model):');
    expect(labels()).toEqual(['uav AND parcel', 'drone AND logistics']);

    buttons()[1].click();
    expect(picked).toEqual(['drone AND logistics']);
  });

  it('asks once per query, not again when only the result changes', async () => {
    await set({ noResults: false });
    await set({ query: 'drone AND delivery' });

    expect(asked.filter((call) => call.mode === 'related')).toHaveLength(1);
  });

  it('asks for a spelling correction as well when nothing was found', async () => {
    await set({ query: '"Abiogenisis" AND "Exoplanet"', noResults: true });
    // Sent the way CORE receives it, without the quotes around single words.
    expect(questions().slice(1)).toEqual(
      expect.arrayContaining([
        { mode: 'correct', text: 'Abiogenisis AND Exoplanet' },
        { mode: 'related', text: 'Abiogenisis AND Exoplanet' },
      ]),
    );

    await answer(last('correct'), { kind: 'queries', queries: ['abiogenesis AND exoplanet'] });
    expect(text()).toContain('Did you mean abiogenesis AND exoplanet');

    buttons()[0].click();
    expect(picked).toEqual(['abiogenesis AND exoplanet']);
  });

  it('offers similar searches when the search failed', async () => {
    await set({ query: 'drone AND delivry', failed: true });
    expect(asked.map((call) => call.mode)).toContain('correct');

    await answer(last('related'), { kind: 'queries', queries: ['uav AND delivery'] });
    expect(text()).toContain('Similar searches to try (written by an AI model):');
    expect(labels()).toEqual(['uav AND delivery']);
  });

  it('stays quiet when there is no correction to offer', async () => {
    await set({ noResults: true });
    await answer(last('correct'), { kind: 'refused', reason: 'unclear' });
    expect(text()).not.toContain('Did you mean');

    // Nor when the model cannot be reached: the "no papers" message is enough.
    await set({ query: 'another query' });
    await answer(last('correct'), { kind: 'unavailable' });
    expect(text()).not.toContain('Did you mean');
  });

  it('drops a correction once the query changes', async () => {
    await set({ noResults: true });
    await answer(last('correct'), { kind: 'queries', queries: ['drones AND delivery'] });
    expect(text()).toContain('Did you mean');

    await set({ query: 'uav', noResults: false });
    expect(text()).not.toContain('Did you mean');
  });

  it('ignores related searches that belong to an earlier query', async () => {
    await set({ query: 'uav' });
    // The answer for the earlier query arrives late and is ignored.
    await answer(0, { kind: 'queries', queries: ['uav AND parcel'] });

    expect(text()).toContain('Thinking of related searches');
    expect(text()).not.toContain('uav AND parcel');
  });

  it('says nothing when the model has no related searches and papers are on screen', async () => {
    await answer(0, { kind: 'refused', reason: 'unclear' });
    expect(text()).toBe('');
  });

  it('says so when there are no papers and no similar searches either', async () => {
    await set({ noResults: true });
    await answer(last('related'), { kind: 'refused', reason: 'unclear' });
    expect(text()).toContain('No similar searches to suggest');
  });

  it.each<[AiOutcome, string]>([
    [
      { kind: 'limited', scope: 'visitor', retryAt: null },
      'The AI model (Llama) has received too many requests from you in a short time. Try again in a minute.',
    ],
    [
      { kind: 'limited', scope: 'model', retryAt: null },
      'too many requests from all visitors of this demo',
    ],
    [{ kind: 'unavailable' }, 'Suggestions are unavailable right now'],
  ])('explains %o and lets the user ask again', async (outcome, message) => {
    await answer(0, outcome);
    expect(text()).toContain(message);
    // A limit is deliberate, and the page says what it is for; an outage is not.
    expect(text().includes('paused to conserve model usage')).toBe(outcome.kind === 'limited');

    buttons()
      .find((button) => button.textContent!.trim() === 'Try again')!
      .click();
    await fixture.whenStable();
    expect(questions()).toEqual([
      { mode: 'related', text: 'drone AND delivery' },
      { mode: 'related', text: 'drone AND delivery' },
    ]);

    await answer(1, { kind: 'queries', queries: ['uav AND parcel'] });
    expect(labels()).toEqual(['uav AND parcel']);
  });
});
