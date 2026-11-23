import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { ContactOptions, SUPPORT } from '../contact-options/contact-options';

/** Contact us: phone, chat and email, the office, and shortcuts to self-help. */
@Component({
  selector: 'bb-contact-page',
  imports: [RouterLink, IconComponent, PageHeader, ContactOptions],
  templateUrl: './contact-page.html',
  styleUrl: './contact-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactPage {
  protected readonly support = SUPPORT;
}
