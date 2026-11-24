import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** How many recent lists are kept (a details page looks for its id in the newest first). */
const KEEP = 10;
const STORAGE_KEY = 'bb-detail-order';

/**
 * The order of the rows in the lists the admin saw last (every `bb-data-table` reports its rows),
 * so a details page can offer "previous" and "next" in the order of the list it was opened from.
 * Kept in the tab's session storage, so the buttons still work after reloading a details page.
 */
@Injectable({ providedIn: 'root' })
export class DetailOrder {
  private readonly storage = isPlatformBrowser(inject(PLATFORM_ID)) ? sessionStorage : null;
  private lists: string[][] = this.load();

  remember(ids: string[]): void {
    if (!ids.length) return;
    const key = ids.join();
    this.lists = [ids, ...this.lists.filter((l) => l.join() !== key)].slice(0, KEEP);
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.lists));
    } catch {
      // Storage full or blocked: the order still works until the next reload.
    }
  }

  /** The ids before and after `id` in the newest list that has it (null at either end or if none). */
  around(id: string): { prev: string | null; next: string | null } | null {
    const list = this.lists.find((l) => l.includes(id));
    if (!list) return null;
    const i = list.indexOf(id);
    return { prev: list[i - 1] ?? null, next: list[i + 1] ?? null };
  }

  private load(): string[][] {
    try {
      const saved: unknown = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(saved) ? saved.filter((l): l is string[] => Array.isArray(l)) : [];
    } catch {
      return [];
    }
  }
}
