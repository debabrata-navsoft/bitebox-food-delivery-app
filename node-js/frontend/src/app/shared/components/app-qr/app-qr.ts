import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, afterNextRender, inject, signal } from '@angular/core';

/** Shown size of the code in px (app-qr.scss `$code`); it is drawn at twice that for sharp screens. */
const CODE_PX = 164;

/**
 * A phone with a QR code that opens BiteBox's install section on the phone (desktop and tablet
 * visitors scan it). The QR is drawn in the browser only: `qrcode` is loaded on demand, so it stays
 * out of the server render and the main bundle.
 */
@Component({
  selector: 'bb-app-qr',
  templateUrl: './app-qr.html',
  styleUrl: './app-qr.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppQr {
  protected readonly src = signal<string | null>(null);

  constructor() {
    const document = inject(DOCUMENT);
    afterNextRender(async () => {
      const { toDataURL } = await import('qrcode');
      this.src.set(
        await toDataURL(`${document.location.origin}/#app-download`, {
          margin: 0,
          width: CODE_PX * 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#2e1a3d', light: '#ffffff' }, // brand plum on white (scanners need contrast)
        }),
      );
    });
  }
}
