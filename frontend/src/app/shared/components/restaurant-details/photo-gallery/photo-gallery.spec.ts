import { TestBed } from '@angular/core/testing';
import { BbDialog } from '../../../dialog/bb-dialog';
import { AllPhotosData } from './all-photos-dialog';
import { PhotoGallery } from './photo-gallery';

const urls = (n: number) => Array.from({ length: n }, (_, i) => `/uploads/images/p${i}.webp`);

describe('PhotoGallery', () => {
  async function render(photos: string[]) {
    const dialog = { open: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: BbDialog, useValue: dialog }] });
    const fixture = TestBed.createComponent(PhotoGallery);
    fixture.componentRef.setInput('photos', photos);
    const changes: string[][] = [];
    fixture.componentInstance.photos.subscribe((p) => changes.push(p));
    await fixture.whenStable();
    return { fixture, dialog, changes, el: fixture.nativeElement as HTMLElement };
  }

  it('shows 5 photos, then "+N" that opens all of them (still editable)', async () => {
    const { fixture, dialog, changes, el } = await render(urls(8));
    expect(el.querySelectorAll('bb-image-upload[label="Replace photo"]').length).toBe(5);
    const more = el.querySelector<HTMLButtonElement>('.more')!;
    expect(more.textContent).toContain('+3');
    more.click();
    await vi.waitFor(() => expect(dialog.open).toHaveBeenCalled());
    const data = dialog.open.mock.calls[0][1].data as AllPhotosData;
    expect(data()).toHaveLength(8);
    data.set(urls(7)); // removed one in the popup
    await fixture.whenStable();
    expect(changes.at(-1)).toHaveLength(7);
  });

  it('has no "+N" tile with 5 photos or fewer', async () => {
    const { el } = await render(urls(5));
    expect(el.querySelector('.more')).toBeNull();
    expect(el.textContent).toContain('5 photos');
  });
});
