import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Public, content-only pages are prerendered for fast first paint and SEO.
 * Everything that depends on the signed-in user renders in the browser,
 * because the server never sees the in-memory access token.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'login', renderMode: RenderMode.Prerender },
  { path: 'register', renderMode: RenderMode.Prerender },
  { path: 'forgot-password', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
