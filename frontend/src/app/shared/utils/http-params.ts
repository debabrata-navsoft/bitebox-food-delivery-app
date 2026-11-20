import { HttpParams } from '@angular/common/http';

export function toParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    // Several values (the Filters panel's checkboxes) go as one comma-separated parameter.
    if (Array.isArray(value) && !value.length) continue;
    params = params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params;
}
