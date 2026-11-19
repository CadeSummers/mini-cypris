import { shapeForCore } from './core-query-shape';

/**
 * Small repairs and tips for queries that are well formed but will not do
 * what the user meant. Everything here is plain text handling: no network.
 */

/** One suggestion shown under the search box, with the text that applies it. */
export interface QueryTip {
  message: string;
  /** Label of the button that applies the fix, e.g. "Use AND". */
  action: string;
  /** The whole query with the fix applied. */
  fixed: string;
}

/**
 * Field names people try, and the name CORE actually uses. CORE answers the
 * wrong names with a server error ("year is not a searchable field").
 */
const FIELD_ALIASES: Record<string, string> = {
  year: 'yearPublished',
};

/**
 * The field CORE searches author names in. Its documented `authors:` is
 * accepted but matches nothing inside a boolean query (checked against the
 * live API on 2026-11-19: `authors:"Alkouz, Balsam"` found 0 papers where
 * `authors/name:"Alkouz, Balsam"` found the 20 the chart counts).
 */
export const CORE_AUTHOR_FIELD = 'authors/name';

const OPERATOR = /^(?:AND|OR|NOT)$/i;

/** Applies `change` to the parts of a query outside double quotes. */
function outsideQuotes(text: string, change: (part: string) => string): string {
  return text
    .split(/("[^"]*")/)
    .map((part) => (part.startsWith('"') ? part : change(part)))
    .join('');
}

/**
 * Tidies a query on its way to CORE; the text the user typed is left alone.
 *
 * - Curly quotes (pasted from a document) become the straight quotes CORE's
 *   syntax uses.
 * - Quotes around a single word are removed. They add nothing, and CORE
 *   answers with a server error when every term in a query is written that
 *   way: "exoplanet" fails where exoplanet works. Phrases of two or more
 *   words, and quoted values after a field name, are not touched.
 * - `authors:` and `author:` are sent as `authors/name:`, the field CORE
 *   really searches (see CORE_AUTHOR_FIELD).
 * - Nested groups are flattened into a shape CORE counts correctly (see
 *   shapeForCore): `(drone AND (package OR delivery))` is sent as
 *   `drone AND (package OR delivery)`.
 */
export function normalizeForCore(query: string): string {
  const tidied = query
    .replace(/[“”]/g, '"')
    .replace(/(^|[\s(])"([^"\s():]+)"(?=[\s)]|$)/g, (whole, before: string, word: string) =>
      OPERATOR.test(word) ? whole : before + word,
    );
  return shapeForCore(
    outsideQuotes(tidied, (part) =>
      part.replace(/(^|[\s(])authors?(?=:)/gi, `$1${CORE_AUTHOR_FIELD}`),
    ),
  );
}

/**
 * The first thing in a query that probably is not what the user meant, with a
 * one-click fix. Null when there is nothing to say.
 */
export function findQueryTip(text: string): QueryTip | null {
  const unquoted = text.replace(/"[^"]*"/g, ' ');

  const alias = /(?:^|[\s(])(year)(?=[:<>=])/i.exec(unquoted)?.[1];
  if (alias) {
    const field = FIELD_ALIASES[alias.toLowerCase()];
    return {
      message: `CORE has no “${alias}” field; the field is called ${field}.`,
      action: `Use ${field}`,
      fixed: outsideQuotes(text, (part) =>
        part.replace(new RegExp(`(^|[\\s(])${alias}(?=[:<>=])`, 'gi'), `$1${field}`),
      ),
    };
  }

  return null;
}
