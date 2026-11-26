import { Address } from '../../core/models/catalog.models';

/** "12 Lake Road, Block B, Maple Town, Riverside, West Bengal 700016" (empty parts skipped). */
export const addressLine = (a: Address): string =>
  [a.line1, a.line2, a.area, a.city, `${a.state} ${a.postalCode}`.trim()]
    .filter(Boolean)
    .join(', ');
