import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ImageUploadComponent } from 'nexprime';
import { errorMessage } from '../../../core/services/api-error';
import { MAX_IMAGE_BYTES, UploadService } from '../../../core/services/upload.service';

@Component({
  selector: 'bb-image-upload',
  imports: [ImageUploadComponent, MatProgressBarModule],
  templateUrl: './image-upload.html',
  styleUrl: './image-upload.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageUpload {
  private readonly uploads = inject(UploadService);

  readonly url = model<string>('');
  readonly label = input('Upload image');
  readonly aspectRatio = input<string | number>('16 / 9');

  protected readonly maxBytes = MAX_IMAGE_BYTES;
  protected readonly preview = signal('');
  protected readonly uploading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const url = this.url();
      untracked(() => {
        if (!this.uploading()) this.preview.set(url);
      });
    });
  }

  protected onFile(file: File): void {
    const problem = this.uploads.validate(file);
    if (problem) {
      this.error.set(problem);
      this.preview.set(this.url()); // drop the local preview of a file we will not upload
      return;
    }
    this.error.set(null);
    this.uploading.set(true);
    this.uploads.uploadImage(file).subscribe({
      next: (serverUrl) => {
        this.uploading.set(false);
        this.url.set(serverUrl);
        this.preview.set(serverUrl);
      },
      error: (err: unknown) => {
        this.uploading.set(false);
        this.error.set(errorMessage(err, 'Upload failed. Please try again.'));
        this.preview.set(this.url()); // back to the previously stored image
      },
    });
  }

  protected onRemove(): void {
    this.error.set(null);
    this.url.set('');
  }
}
