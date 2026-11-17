import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ButtonComponent, CheckboxComponent, IconComponent } from 'nexprime';
import { firstValueFrom } from 'rxjs';
import { AdminStaffService } from '../../../../core/services/admin/admin-staff.service';
import { errorMessage } from '../../../../core/services/api-error';
import { confirmed } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { loaded } from '../../../../shared/coupons/coupon-list';
import { BB_DIALOG_DATA, BbDialog, BbDialogRef, BbDialogTitle } from '../../../../shared/dialog/bb-dialog';
import { Permission, ROLE_META, User } from '../../../../shared/models/user.models';

/**
 * The super admin picks what one admin or operator may do: permissions in groups, ready-made sets
 * (Support, Restaurant, Delivery, KYC, Finance), or the role's preset. Shows what changes and asks
 * before saving. Closes with the saved user.
 */
@Component({
  selector: 'bb-permission-editor-dialog',
  imports: [BbDialogTitle, ButtonComponent, CheckboxComponent, IconComponent],
  templateUrl: './permission-editor-dialog.html',
  styleUrl: './permission-editor-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PermissionEditorDialog {
  protected readonly user = inject<User>(BB_DIALOG_DATA);
  protected readonly ref = inject<BbDialogRef<User>>(BbDialogRef);
  private readonly api = inject(AdminStaffService);
  private readonly dialog = inject(BbDialog);
  protected readonly roleLabel = ROLE_META[this.user.role].label;
  /** Operators have no preset: only their own list. */
  protected readonly hasPreset = this.user.role !== 'operator';

  private readonly catalogue = rxResource({ stream: () => this.api.permissionCatalogue() });
  protected readonly data = computed(() => loaded(this.catalogue));
  protected readonly loadError = computed(() =>
    this.catalogue.error() ? errorMessage(this.catalogue.error(), 'Could not load the permissions.') : null,
  );
  protected readonly groups = computed(() => {
    const byGroup = new Map<string, { key: Permission; label: string }[]>();
    for (const p of this.data()?.permissions ?? []) byGroup.set(p.group, [...(byGroup.get(p.group) ?? []), p]);
    return [...byGroup].map(([name, items]) => ({ name, items }));
  });

  private readonly start = new Set<Permission>(this.user.customPermissions ?? this.user.permissions ?? []);
  protected readonly selected = signal(new Set(this.start));
  /** True once "Use the role's preset" is picked (saves null). */
  protected readonly usePreset = signal(this.hasPreset && this.user.customPermissions == null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly added = computed(() => [...this.selected()].filter((p) => !this.start.has(p)));
  protected readonly removed = computed(() => [...this.start].filter((p) => !this.selected().has(p)));
  protected readonly changed = computed(
    () => this.added().length + this.removed().length > 0 || this.usePreset() !== (this.hasPreset && this.user.customPermissions == null),
  );

  protected toggle(key: Permission, on: boolean): void {
    this.usePreset.set(false);
    this.selected.update((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  protected toggleGroup(items: { key: Permission }[], on: boolean): void {
    this.usePreset.set(false);
    this.selected.update((s) => {
      const next = new Set(s);
      for (const { key } of items) on ? next.add(key) : next.delete(key);
      return next;
    });
  }

  protected allOn(items: { key: Permission }[]): boolean {
    return items.every(({ key }) => this.selected().has(key));
  }

  protected applyPreset(permissions: Permission[]): void {
    this.usePreset.set(false);
    this.selected.set(new Set(permissions));
  }

  /** Back to the role's own set (the API then serves the preset). */
  protected resetToRole(): void {
    this.usePreset.set(true);
    this.selected.set(new Set(this.user.customPermissions == null ? this.start : []));
  }

  protected label(key: Permission): string {
    return this.data()?.permissions.find((p) => p.key === key)?.label ?? key;
  }

  protected async save(): Promise<void> {
    const preset = this.usePreset();
    const summary = preset
      ? `${this.user.name} goes back to the ${this.roleLabel} role's own permissions.`
      : [
          this.added().length ? `Adds: ${this.added().map((k) => this.label(k)).join(', ')}.` : '',
          this.removed().length ? `Removes: ${this.removed().map((k) => this.label(k)).join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' ');
    const ok = await firstValueFrom(
      confirmed(this.dialog, {
        title: `Change ${this.user.name}'s permissions?`,
        message: `${summary} It applies from their next action and is recorded in the audit log.`,
        confirmLabel: 'Save permissions',
      }),
      { defaultValue: false },
    );
    if (!ok) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const permissions = preset ? null : [...this.selected()].sort();
      this.ref.close(await firstValueFrom(this.api.update(this.user.id, { permissions })));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}

/** Opens the editor; emits the saved user. */
export const openPermissionEditor = (dialog: BbDialog, user: User) =>
  dialog.result<PermissionEditorDialog, User, User>(PermissionEditorDialog, { data: user, width: '720px' });
