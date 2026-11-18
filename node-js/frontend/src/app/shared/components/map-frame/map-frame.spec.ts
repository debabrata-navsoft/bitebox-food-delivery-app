import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MapFrame } from './map-frame';

@Component({
  imports: [MapFrame],
  template: `<div (keydown.escape)="outerEscapes = outerEscapes + 1">
    <bb-map-frame title="Route to the customer">
      <div class="map">map</div>
      <a mapActions href="#">Directions</a>
    </bb-map-frame>
  </div>`,
})
class Host {
  outerEscapes = 0;
}

describe('MapFrame', () => {
  const setup = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const frame = el.querySelector('bb-map-frame') as HTMLElement;
    return { fixture, el, frame };
  };

  it('opens full screen and closes with the button', async () => {
    const { fixture, frame } = await setup();
    expect(frame.querySelector('.head')).toBeNull();

    (frame.querySelector('button.expand') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(frame.classList).toContain('full');
    expect(document.body.classList).toContain('bb-map-full-open');
    expect(frame.querySelector('.head h2')?.textContent).toContain('Route to the customer');
    expect(frame.querySelector('.head [mapActions]')).not.toBeNull();

    (frame.querySelector('.head button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(frame.classList).not.toContain('full');
    expect(document.body.classList).not.toContain('bb-map-full-open');
  });

  it('Escape leaves full screen without reaching a surrounding dialog', async () => {
    const { fixture, frame } = await setup();
    (frame.querySelector('button.expand') as HTMLButtonElement).click();
    await fixture.whenStable();

    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(frame.classList).not.toContain('full');
    expect(fixture.componentInstance.outerEscapes).toBe(0);

    // Not in full screen: Escape passes through as usual.
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.componentInstance.outerEscapes).toBe(1);
  });
});
