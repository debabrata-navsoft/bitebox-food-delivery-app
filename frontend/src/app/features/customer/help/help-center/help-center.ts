import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormField, form } from '@angular/forms/signals';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IconComponent, TextInputComponent } from 'nexprime';
import { ContactOptions, SUPPORT } from '../contact-options/contact-options';
import { HELP_TOPICS } from './help-faqs';

/** Help center: search or browse common questions, then call, chat or email if still stuck. */
@Component({
  selector: 'bb-help-center',
  imports: [RouterLink, FormField, TextInputComponent, IconComponent, ContactOptions],
  templateUrl: './help-center.html',
  styleUrl: './help-center.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpCenter {
  protected readonly support = SUPPORT;
  /** The topic buttons: everything, then each topic. */
  protected readonly topics = [
    { id: 'all', title: 'All topics', icon: 'circle-help' },
    ...HELP_TOPICS,
  ];
  protected readonly search = form(signal({ term: '' }));

  /** /help#payments opens on that topic. */
  private readonly fragment = toSignal(inject(ActivatedRoute).fragment);
  protected readonly topic = linkedSignal(() =>
    HELP_TOPICS.some((t) => t.id === this.fragment()) ? this.fragment()! : 'all',
  );

  /** The topics to show: a search looks through every topic; otherwise the chosen one. */
  protected readonly shown = computed(() => {
    const term = this.search.term().value().trim().toLowerCase();
    if (term) {
      return HELP_TOPICS.map((t) => ({
        ...t,
        faqs: t.faqs.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(term)),
      })).filter((t) => t.faqs.length);
    }
    const id = this.topic();
    return id === 'all' ? HELP_TOPICS : HELP_TOPICS.filter((t) => t.id === id);
  });

  protected pick(id: string): void {
    this.topic.set(id);
    this.search.term().value.set('');
  }
}
