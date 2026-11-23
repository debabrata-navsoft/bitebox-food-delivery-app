export const environment = {
  production: true,
  baseUrl: '/api/v1',
  wsUrl: '',

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

  // Contact us / Help center. Placeholder details: replace with the company's real ones.
  support: {
    phone: '1800 123 2483',
    email: 'support@bitebox.example',
    hours: 'Every day, 8 AM to 11 PM',
    address: 'BiteBox Foods, 4th Floor, Maple Court, Sunview Road, Bengaluru 560001',
  },
};
