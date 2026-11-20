import type * as Leaflet from 'leaflet';

/** Wheel distance (pixels) per zoom level: a mouse notch is ~100, a trackpad pinch much less. */
const PIXELS_PER_LEVEL = 100;

/**
 * Desktop maps: Ctrl + wheel (⌘ + wheel on a Mac, or a trackpad pinch) zooms around the pointer;
 * a plain wheel scrolls the page as usual. Touch screens pinch to zoom and send no wheel events,
 * so phones and tablets are unchanged. Turn Leaflet's own `scrollWheelZoom` off with this. The
 * listener lives on the map's element, so it goes with it.
 */
export function ctrlScrollZoom(map: Leaflet.Map, element: HTMLElement): void {
  let pending = 0;
  element.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return; // the page scrolls
      event.preventDefault(); // not the browser's page zoom
      pending += event.deltaY;
      const step = Math.round(pending / PIXELS_PER_LEVEL);
      if (!step) return;
      pending = 0;
      map.setZoomAround(map.mouseEventToContainerPoint(event), map.getZoom() - step);
    },
    { passive: false },
  );
}
