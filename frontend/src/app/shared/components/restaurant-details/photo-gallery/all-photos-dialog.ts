import { ChangeDetectionStrategy, Component, Signal, inject } from '@angular/core';
import { ButtonComponent } from 'nexprime';
import { BB_DIALOG_DATA, BbDialog, BbDialogRef, BbDialogTitle } from '../../../dialog/bb-dialog';
import { PhotoGallery } from './photo-gallery';

/** The gallery's photos: read, and set when one is replaced, removed or added here. */
export type AllPhotosData = Signal<string[]> & { set(photos: string[]): void };

/** "+N" in the gallery: every photo, to replace, remove or add more. */
@Component({
  selector: 'bb-all-photos-dialog',
  imports: [BbDialogTitle, ButtonComponent, PhotoGallery],
  templateUrl: './all-photos-dialog.html',
  styleUrl: './all-photos-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AllPhotosDialog {
  protected readonly data = inject<AllPhotosData>(BB_DIALOG_DATA);
  protected readonly ref = inject(BbDialogRef);
}

export const openAllPhotos = (dialog: BbDialog, data: AllPhotosData) =>
  dialog.open<AllPhotosDialog, AllPhotosData>(AllPhotosDialog, {
    data,
    width: '720px',
    disableClose: true, // only Done closes it (no closing by a stray click outside)
  });
