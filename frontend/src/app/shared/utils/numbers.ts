const count = new Intl.NumberFormat('en-IN');

/** A count with Indian digit grouping: 1250000 → "12,50,000". */
export const formatCount = (n: number): string => count.format(n);
