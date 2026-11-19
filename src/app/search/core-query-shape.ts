import { QueryNode, parseQuery } from './boolean-query';

/**
 * Rewrites a boolean query into a shape CORE counts correctly, without
 * changing what it means.
 *
 * CORE evaluates some well-formed queries wrongly. Measured against the live
 * API:
 *
 *   (drone AND (package OR delivery))   71,213   the same as plain "drone"
 *   drone AND (package OR delivery)      4,729   correct
 *   drone AND package OR delivery       71,213   "AND before OR" is not applied
 *   drone delivery                   1,621,487   adjacent words are OR-ed
 *
 * The two shapes below were checked by arithmetic on simpler queries and are
 * the only ones sent:
 *
 *   term AND (a OR b) AND NOT c        an AND of terms and OR-groups
 *   (a AND b) OR (c AND d) OR e        an OR of terms and AND-groups
 *
 * Both are one level deep, with every operator written out. A query already
 * in one of them keeps its structure; anything else (nested groups, NOT in
 * front of a group) is expanded with the usual distribution and De Morgan
 * rules. A query that would expand past MAX_CLAUSES, or that does not parse,
 * is returned as it was.
 */
export function shapeForCore(query: string): string {
  const parsed = parseQuery(query);
  if (!parsed.ok) return query;

  const tree = simplify(parsed.ast, false);
  const direct = printIfFlat(tree);
  if (direct) return direct;

  const clauses = expand(tree, 'and') ?? null;
  if (clauses) return print(clauses, 'and');
  const groups = expand(tree, 'or');
  return groups ? print(groups, 'or') : query;
}

/** Above this many groups the rewritten query would be longer than it is worth. */
const MAX_CLAUSES = 32;

type Operator = 'and' | 'or';

/** A term as it is sent, with NOT in front when it is negated. */
type Literal = string;

type Shaped = Literal | { type: Operator; children: Shaped[] };

const other = (type: Operator): Operator => (type === 'and' ? 'or' : 'and');

/**
 * Pushes every NOT down to the terms (NOT (a OR b) is NOT a AND NOT b) and
 * merges a group into a parent that uses the same operator.
 */
function simplify(node: QueryNode, negated: boolean): Shaped {
  if (node.type === 'term') return negated ? `NOT ${node.text}` : node.text;
  if (node.type === 'not') return simplify(node.child, !negated);

  const type = negated ? other(node.type) : node.type;
  const children = node.children
    .map((child) => simplify(child, negated))
    .flatMap((child) =>
      typeof child !== 'string' && child.type === type ? child.children : [child],
    );
  return { type, children };
}

const isLiteral = (node: Shaped): node is Literal => typeof node === 'string';

function isGroupOf(node: Shaped, type: Operator): boolean {
  return isLiteral(node) || (node.type === type && node.children.every(isLiteral));
}

/** Prints a tree that is already one level deep; null when it is deeper. */
function printIfFlat(tree: Shaped): string | null {
  if (isLiteral(tree)) return tree;
  const inner = other(tree.type);
  if (!tree.children.every((child) => isGroupOf(child, inner))) return null;
  return print(
    tree.children.map((child) => (isLiteral(child) ? [child] : (child.children as Literal[]))),
    tree.type,
  );
}

/**
 * The tree as a list of groups joined by `outer`, each group a list of terms
 * joined by the other operator. Null when it would pass MAX_CLAUSES.
 */
function expand(node: Shaped, outer: Operator): Literal[][] | null {
  if (isLiteral(node)) return [[node]];

  const parts: Literal[][][] = [];
  for (const child of node.children) {
    const part = expand(child, outer);
    if (!part) return null;
    parts.push(part);
  }

  if (node.type === outer) {
    const all = parts.flat();
    return all.length > MAX_CLAUSES ? null : all;
  }

  // The other operator: every combination of one group from each child.
  let combined: Literal[][] = [[]];
  for (const part of parts) {
    combined = combined.flatMap((left) => part.map((right) => [...new Set([...left, ...right])]));
    if (combined.length > MAX_CLAUSES) return null;
  }
  return combined;
}

function print(groups: Literal[][], outer: Operator): string {
  const inner = ` ${other(outer).toUpperCase()} `;
  const alone = groups.length === 1;
  return groups
    .map((group) => (group.length === 1 || alone ? group.join(inner) : `(${group.join(inner)})`))
    .join(` ${outer.toUpperCase()} `);
}
