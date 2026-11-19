import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AiOutcome, AiQuery } from '../ai/ai-query';
import { PlainEnglishBar } from './plain-english-bar';

describe('PlainEnglishBar', () => {
  let fixture: ComponentFixture<PlainEnglishBar>;
  let asked: { mode: string; text: string }[];
  let answers: Subject<AiOutcome>;
  let written: string[];

  const el = () => fixture.nativeElement as HTMLElement;
  const button = () => el().querySelector<HTMLButtonElement>('button')!;
  const feedback = () => el().querySelector('.feedback')!.textContent!.replace(/\s+/g, ' ').trim();

  async function ask(question: string): Promise<void> {
    const input = el().querySelector<HTMLInputElement>('#question')!;
    input.value = question;
    input.dispatchEvent(new Event('input'));
    el()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  }

  async function answer(outcome: AiOutcome): Promise<void> {
    answers.next(outcome);
    answers.complete();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    asked = [];
    written = [];
    const ai = {
      ask: (mode: string, text: string) => {
        asked.push({ mode, text });
        answers = new Subject<AiOutcome>();
        return answers;
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: AiQuery, useValue: ai }] });
    fixture = TestBed.createComponent(PlainEnglishBar);
    fixture.componentInstance.queryWritten.subscribe((query) => written.push(query));
    await fixture.whenStable();
  });

  it('asks for a translation and hands the query on', async () => {
    await ask('  papers about drones since 2020 ');
    expect(asked).toEqual([{ mode: 'translate', text: 'papers about drones since 2020' }]);
    expect(button().disabled).toBe(true);
    expect(button().textContent).toContain('Writing the query');

    await answer({ kind: 'queries', queries: ['drone AND yearPublished>=2020'] });
    expect(written).toEqual(['drone AND yearPublished>=2020']);
    expect(button().disabled).toBe(false);
  });

  it('shows the written query only while it is the one applied', async () => {
    await ask('papers about drones');
    await answer({ kind: 'queries', queries: ['drone'] });
    expect(feedback()).toBe('');

    fixture.componentRef.setInput('currentQuery', 'drone');
    await fixture.whenStable();
    expect(feedback()).toContain('Searched for drone, written from your question');

    fixture.componentRef.setInput('currentQuery', 'something else');
    await fixture.whenStable();
    expect(feedback()).toBe('');
  });

  it.each<[AiOutcome, string]>([
    [{ kind: 'refused', reason: 'not_a_search' }, 'does not look like a request for research'],
    [{ kind: 'refused', reason: 'unclear' }, 'could not be turned into a search'],
    [{ kind: 'limited', retryAt: null }, 'Try again in a minute'],
    [{ kind: 'unavailable' }, 'The Boolean box above still works'],
  ])('explains %o in its own words and runs no search', async (outcome, message) => {
    await ask('write me a poem');
    await answer(outcome);

    expect(feedback()).toContain(message);
    expect(written).toEqual([]);
  });

  it('does nothing for an empty question', async () => {
    await ask('   ');
    expect(asked).toEqual([]);
  });
});
