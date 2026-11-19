import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AiLimitScope } from './ai-query';

/**
 * A wait in words a person would use: "about 40 seconds", "about 3 minutes",
 * "about 5 hours". Rounded up, so the time given is never too short.
 */
export function waitText(retryAt: Date, now: Date = new Date()): string {
  const seconds = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));
  const unit = (count: number, name: string) => `about ${count} ${name}${count === 1 ? '' : 's'}`;
  if (seconds < 60) return unit(Math.ceil(seconds / 10) * 10, 'second');
  if (seconds < 3600) return unit(Math.ceil(seconds / 60), 'minute');
  return unit(Math.ceil(seconds / 3600), 'hour');
}

/**
 * Says that the model has received too many requests, and when it will take
 * more. Shared by every place that calls the model, so the wording is the same.
 */
@Component({
  selector: 'app-ai-limit-notice',
  imports: [DatePipe],
  template: `
    @if (scope() === 'model') {
      The AI model (Llama) has received too many requests from all visitors of this demo.
    } @else {
      The AI model (Llama) has received too many requests from you in a short time.
    }
    @if (retryAt(); as at) {
      It will take requests again in {{ wait() }}, at {{ at | date: 'mediumTime' }}.
    } @else {
      Try again in a minute.
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiLimitNotice {
  readonly scope = input.required<AiLimitScope>();
  readonly retryAt = input<Date | null>(null);

  /** Worked out when the notice appears; the clock time beside it stays exact. */
  protected readonly wait = computed(() => {
    const retryAt = this.retryAt();
    return retryAt ? waitText(retryAt) : '';
  });
}
