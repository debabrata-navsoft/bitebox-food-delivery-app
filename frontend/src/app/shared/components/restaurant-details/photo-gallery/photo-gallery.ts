import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { BbDialog } from '../../../dialog/bb-dialog';
import { ImageUpload } from '../../image-upload/image-upload';

/** Extra photos of the restaurant (food, inside, outside), as many as it likes, shown on its page. */
@Component({
  selector: 'bb-photo-gallery',
  imports: [ImageUpload],
  templateUrl: './photo-gallery.html',
  styleUrl: './photo-gallery.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoGallery {
  readonly photos = model<string[]>([]);
  /** Photos shown before a "+N" tile that opens them all (null: show every photo). */
  readonly limit = input<number | null>(5);

  private readonly dialog = inject(BbDialog);
  protected readonly shown = computed(() => {
    const limit = this.limit();
    return limit ? this.photos().slice(0, limit) : this.photos();
  });
  protected readonly more = computed(() => this.photos().length - this.shown().length);
  /** Key of the "Add a photo" box: a new one after each upload, so the box starts empty again. */
  protected readonly addBox = signal(0);

  /** A tile changed: a new URL replaces the photo, an empty one removes it. */
  protected set(index: number, url: string): void {
    this.photos.update((list) =>
      url ? list.map((p, i) => (i === index ? url : p)) : list.filter((_, i) => i !== index),
    );
  }

  /** Every photo in a popup, still editable; changes save as they do here. */
  protected async showAll(): Promise<void> {
    const { openAllPhotos } = await import('./all-photos-dialog');
    openAllPhotos(this.dialog, this.photos);
  }

  protected add(url: string): void {
    if (!url) return;
    this.photos.update((list) => [...list, url]);
    this.addBox.update((key) => key + 1); // the photo now has its own tile
  }
}
