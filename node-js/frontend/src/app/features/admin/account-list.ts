import { SelectOption } from 'nexprime';

/** The id customers and support quote: the last 8 characters, as on the profile. */
export const shortId = (id: string) => '#' + id.slice(-8).toUpperCase();

/** A filter select: "any" first, then each label (in `keys` order when given). */
export const selectOptions = (
  all: string,
  labels: Record<string, string | { label: string }>,
  keys = Object.keys(labels),
): SelectOption[] => [
  { value: '', label: all },
  ...keys.map((value) => {
    const l = labels[value];
    return { value, label: typeof l === 'string' ? l : l.label };
  }),
];
