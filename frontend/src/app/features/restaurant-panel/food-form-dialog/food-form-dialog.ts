import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { errorMessage, fieldErrors } from '../../../core/services/api-error';
import { MyRestaurantService } from '../../../core/services/my-restaurant.service';
import { ImageUpload } from '../../../shared/components/image-upload/image-upload';
import { FoodCategory, FoodItem, FoodItemInput, categoryIdOf } from '../../../shared/models/catalog.models';
import { rupeesToPaise } from '../../../shared/pipes/money.pipes';
import { applyServerErrors, controlError } from '../../../shared/validators/form-validators';

export interface FoodFormData {
  item?: FoodItem;
  categories: FoodCategory[];
}

/** Add or edit a menu item. Closes with the saved item. */
@Component({
  selector: 'bb-food-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSlideToggleModule,
    ImageUpload,
  ],
  templateUrl: './food-form-dialog.html',
  styleUrl: './food-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FoodFormDialog {
  protected readonly data = inject<FoodFormData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<FoodFormDialog, FoodItem>);
  private readonly service = inject(MyRestaurantService);
  protected readonly controlError = controlError;

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly imageUrl = signal(this.data.item?.imageUrl ?? '');

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: [this.data.item?.name ?? '', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    category: [this.data.item ? categoryIdOf(this.data.item) : '', Validators.required],
    price: [this.data.item ? this.data.item.pricePaise / 100 : (null as number | null), [Validators.required, Validators.min(1), Validators.max(100000)]],
    description: [this.data.item?.description ?? '', Validators.maxLength(500)],
    isVeg: [this.data.item?.isVeg ?? true],
    prepTimeMinutes: [this.data.item?.prepTimeMinutes ?? (null as number | null), [Validators.min(1), Validators.max(180)]],
    isAvailable: [this.data.item?.isAvailable ?? true],
  });

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const input: FoodItemInput = {
      name: v.name.trim(),
      category: v.category,
      pricePaise: rupeesToPaise(Number(v.price)),
      description: v.description.trim(),
      isVeg: v.isVeg,
      isAvailable: v.isAvailable,
      imageUrl: this.imageUrl(),
      prepTimeMinutes: v.prepTimeMinutes ? Number(v.prepTimeMinutes) : null,
    };
    this.saving.set(true);
    this.error.set(null);
    const request = this.data.item ? this.service.updateFood(this.data.item.id, input) : this.service.createFood(input);
    request.subscribe({
      next: (item) => this.ref.close(item),
      error: (err: unknown) => {
        applyServerErrors(this.form, fieldErrors(err));
        this.error.set(errorMessage(err, 'Could not save this dish.'));
        this.saving.set(false);
      },
    });
  }
}
