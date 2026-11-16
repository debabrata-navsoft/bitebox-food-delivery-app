// Django API backend (http://localhost:8000/api/v1).
// From a phone on the same Wi-Fi, use your PC's LAN IP instead, e.g.
// baseUrl: 'http://192.168.0.12:8000/api/v1', wsUrl: 'ws://192.168.0.12:8000/ws/'
export const environment = {
  production: false,
  baseUrl: 'http://localhost:8000/api/v1',
  wsUrl: 'ws://localhost:8000/ws/',

  map: {
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },

  // Footer links; empty ones are hidden. No secrets in this file (it ships to the browser).
  links: {
    social: { facebook: '', instagram: '', youtube: '', linkedin: '', x: '' },
    apps: { googlePlay: '', appStore: '' },
  },
};
