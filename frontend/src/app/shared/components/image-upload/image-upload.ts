import { ChangeDetectionStrategy, Component, inject, input, model, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { errorMessage } from '../../../core/services/api-error';
import { UploadService } from '../../../core/services/upload.service';

/**
 * Picks an image, uploads it to the API and exposes the resulting URL via
 * two-way binding: <bb-image-upload [(url)]="imageUrl" />
 */
@Component({
  selector: 'bb-image-upload',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './image-upload.html',
  styleUrl: './image-upload.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageUpload {
  private readonly uploads = inject(UploadService);

  readonly url = model<string>('');
  readonly label = input('Add a photo');

  protected readonly uploading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected onFile(picker: HTMLInputElement): void {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;

    const problem = this.uploads.validate(file);
    if (problem) {
      this.error.set(problem);
      return;
    }
    this.error.set(null);
    this.uploading.set(true);
    this.uploads.uploadImage(file).subscribe({
      next: (url) => {
        this.url.set(url);
        this.uploading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err, 'Upload failed. Please try again.'));
        this.uploading.set(false);
      },
    });
  }
}
