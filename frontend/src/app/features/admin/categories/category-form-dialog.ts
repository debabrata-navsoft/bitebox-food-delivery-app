import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { AdminCatalogService } from '../../../core/services/admin/admin-catalog.service';
import { errorMessage, fieldErrors } from '../../../core/services/api-error';
import { FoodCategory } from '../../../shared/models/catalog.models';
import { applyServerErrors, controlError } from '../../../shared/validators/form-validators';

/** A few suggestions; any Material Symbols name works. */
const ICON_SUGGESTIONS = ['restaurant', 'rice_bowl', 'local_pizza', 'lunch_dining', 'ramen_dining', 'soup_kitchen', 'breakfast_dining', 'bakery_dining', 'icecream', 'cake', 'local_cafe', 'local_bar', 'kebab_dining', 'set_meal', 'egg_alt', 'eco'];

@Component({
  selector: 'bb-category-form-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSlideToggleModule],
  templateUrl: './category-form-dialog.html',
  styleUrl: './category-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryFormDialog {
  protected readonly data = inject<FoodCategory | null>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<CategoryFormDialog, FoodCategory>);
  private readonly service = inject(AdminCatalogService);
  protected readonly controlError = controlError;
  protected readonly icons = ICON_SUGGESTIONS;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: [this.data?.name ?? '', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
    description: [this.data?.description ?? '', Validators.maxLength(300)],
    icon: [this.data?.icon ?? 'restaurant', Validators.pattern(/^[a-z0-9_]{1,40}$/)],
    sortOrder: [this.data?.sortOrder ?? 0, [Validators.min(0), Validators.max(10000)]],
    isActive: [this.data?.isActive ?? true],
  });

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const input = { ...v, name: v.name.trim(), description: v.description.trim(), sortOrder: Number(v.sortOrder) };
    this.saving.set(true);
    this.error.set(null);
    (this.data ? this.service.updateCategory(this.data.id, input) : this.service.createCategory(input)).subscribe({
      next: (category) => this.ref.close(category),
      error: (err: unknown) => {
        applyServerErrors(this.form, fieldErrors(err));
        this.error.set(errorMessage(err));
        this.saving.set(false);
      },
    });
  }
}
