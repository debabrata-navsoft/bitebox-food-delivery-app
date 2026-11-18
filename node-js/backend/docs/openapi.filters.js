/** OpenAPI parameters shared by the admin lists' multi-value filters and facet counts. */

export const q = (name, schema) => ({ in: "query", name, schema });
export const described = (param, description) => ({ ...param, description });
/** `search` (at most 100 characters): what it matches. */
export const searchParam = (description) => described(q("search", { type: "string", maxLength: 100 }), description);

/**
 * A multi-value filter: one value or several, comma-separated (any of them match); every item is
 * checked (any invalid one is 422) and empty items are ignored. `values` null: free text, 1-60
 * each; "id": ids.
 */
export const multi = (name, values, description) => ({
  in: "query",
  name,
  style: "form",
  explode: false,
  schema: {
    type: "array",
    items:
      values === "id"
        ? { type: "string", pattern: "^[0-9a-fA-F]{24}$" }
        : values
          ? { type: "string", enum: values }
          : { type: "string", maxLength: 60 },
  },
  description: `${description ? `${description}. ` : ""}One value or several, comma-separated`,
});

/**
 * `facets`: the list's facet counts (`names`: its multi-value filters, in response order; `open`:
 * those listing the values that occur; `ids`: open facets of ids, which carry the name as `label`).
 */
export const facetsParam = (names, open = [], ids = []) => {
  const listed = [...open, ...ids];
  return described(
    q("facets", { type: "boolean" }),
    `true (or 1): data also has facets: { ${names.join(", ")} }, each [{ value, count }]${
      ids.length ? ` (${ids.join(" and ")}: [{ value: id, label: name, count }])` : ""
    }. A facet's counts apply the search, the date ranges and every other filter, but not its own selection. ${
      listed.length
        ? `${listed.join(" and ")}: the values that occur, most first then A to Z, at most 50; the others: every value in order, 0 when none.`
        : "Every value in order, 0 when none."
    } Without it the response has no facets (limit=1&facets=1 previews the total)`,
  );
};

/** `from` and `to`: inclusive YYYY-MM-DD days in the report time zone; `what`: e.g. "day created". */
export const dayParams = (from, to, what) => [
  described(q(from, { type: "string", format: "date" }), `First ${what} (inclusive), in the report time zone`),
  described(
    q(to, { type: "string", format: "date" }),
    `Last ${what} (inclusive), in the report time zone; before ${from} is 422`,
  ),
];
