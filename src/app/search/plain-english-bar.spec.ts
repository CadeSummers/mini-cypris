import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AiOutcome, AiQuery } from '../ai/ai-query';
import { AI_SUGGESTIONS_STORAGE_KEY, AiSuggestionsSetting } from '../ai/ai-suggestions-setting';
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
    localStorage.removeItem(AI_SUGGESTIONS_STORAGE_KEY);
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
    [
      { kind: 'limited', scope: 'visitor', retryAt: null },
      'The AI model (Llama) has received too many requests from you',
    ],
    [
      { kind: 'limited', scope: 'model', retryAt: null },
      'too many requests from all visitors of this demo',
    ],
    [{ kind: 'unavailable' }, 'The Boolean box above still works'],
  ])('explains %o in its own words and runs no search', async (outcome, message) => {
    await ask('write me a poem');
    await answer(outcome);

    expect(feedback()).toContain(message);
    expect(written).toEqual([]);
  });

  it('drops an answer that arrives after the visitor has searched for something else', async () => {
    fixture.componentRef.setInput('currentQuery', 'drone');
    await ask('papers about solar cells');

    fixture.componentRef.setInput('currentQuery', 'uav AND delivery');
    await answer({ kind: 'queries', queries: ['"solar cells"'] });

    expect(written).toEqual([]);
    expect(button().textContent).toContain('Ask');
  });

  it('says which searches reach the model, and lets the visitor turn suggestions off', async () => {
    const note = () => el().querySelector('#question-note')!.textContent!.replace(/\s+/g, ' ');
    const toggle = el().querySelector<HTMLInputElement>('.ai-switch input')!;
    expect(toggle.checked).toBe(true);
    expect(note()).toContain('every search you run from either box, is sent to an AI model');

    toggle.click();
    await fixture.whenStable();

    expect(TestBed.inject(AiSuggestionsSetting).enabled()).toBe(false);
    expect(note()).toContain('Only a question typed in this box is sent to an AI model');
    expect(localStorage.getItem(AI_SUGGESTIONS_STORAGE_KEY)).toBe('off');
  });

  it('does nothing for an empty question', async () => {
    await ask('   ');
    expect(asked).toEqual([]);
  });
});
