/**
 * A small parser for boolean keyword queries such as
 * (drone AND (package OR delivery)).
 *
 * It is deliberately permissive about what a "term" is: anything that is not
 * whitespace, a parenthesis or an operator is passed through untouched, so
 * CORE-specific syntax like title:"machine learning" or yearPublished>=2020
 * stays valid. The parser only judges structure: parentheses, quotes and
 * operator placement.
 *
 * Operators are read in any case (AND, and, And), because CORE reads them that
 * way: `drone and delivery` finds the same papers as `drone AND delivery`.
 *
 * Grammar:
 *   or      := and ( OR and )*
 *   and     := not ( AND? not )*        adjacent terms are an implicit AND
 *   not     := NOT not | primary
 *   primary := '(' or ')' | term
 */

export type QueryNode =
  | {
      type: 'term';
      field: string | null;
      /** The words to look for, without the field name or quotes. */
      value: string;
      /** The term exactly as written, e.g. title:"machine learning". */
      text: string;
    }
  | { type: 'not'; child: QueryNode }
  | { type: 'and' | 'or'; children: QueryNode[] };

export interface QueryIssue {
  message: string;
  /** Character offset in the query text where the problem was noticed. */
  position: number;
}

export type ParseResult = { ok: true; ast: QueryNode } | { ok: false; issue: QueryIssue };

type TokenKind = 'lparen' | 'rparen' | 'and' | 'or' | 'not' | 'term';

interface Token {
  kind: TokenKind;
  text: string;
  position: number;
}

class QuerySyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

const OPERATORS: Record<string, TokenKind> = { AND: 'and', OR: 'or', NOT: 'not' };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (/\s/.test(char)) {
      i++;
    } else if (char === '(' || char === ')') {
      tokens.push({ kind: char === '(' ? 'lparen' : 'rparen', text: char, position: i });
      i++;
    } else {
      // A term runs until whitespace or a parenthesis; quoted sections may
      // contain both, e.g. title:"machine learning (ML)".
      const start = i;
      while (i < text.length && !/[\s()]/.test(text[i])) {
        if (text[i] === '"') {
          const close = text.indexOf('"', i + 1);
          if (close === -1) {
            throw new QuerySyntaxError('This quote is never closed.', i);
          }
          i = close + 1;
        } else {
          i++;
        }
      }
      const word = text.slice(start, i);
      tokens.push({
        kind: OPERATORS[word.toUpperCase()] ?? 'term',
        text: word,
        position: start,
      });
    }
  }

  return tokens;
}

function toTerm(token: Token): QueryNode {
  // field:value, where the value may be quoted. A leading quote means the
  // whole token is a phrase, even if it contains a colon.
  const match = /^([A-Za-z_][\w.]*):(.+)$/.exec(token.text);
  const field = match && !token.text.startsWith('"') ? match[1] : null;
  const raw = field && match ? match[2] : token.text;
  const value = raw.replace(/"/g, '');
  if (!value.trim()) {
    // "" would match every paper here and is an error at CORE.
    throw new QuerySyntaxError('Put a word between the quotes.', token.position);
  }
  return { type: 'term', field, value, text: token.text };
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly length: number,
  ) {}

  parse(): QueryNode {
    if (!this.tokens.length) {
      throw new QuerySyntaxError('Enter a search term.', 0);
    }
    const node = this.parseOr();
    const extra = this.peek();
    if (extra) {
      // parseOr only stops early on a ')' that has no matching '('.
      throw new QuerySyntaxError('This closing parenthesis has no matching "(".', extra.position);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private parseOr(): QueryNode {
    const children = [this.parseAnd()];
    while (this.peek()?.kind === 'or') {
      this.index++;
      children.push(this.parseAnd());
    }
    return children.length === 1 ? children[0] : { type: 'or', children };
  }

  private parseAnd(): QueryNode {
    const children = [this.parseNot()];
    for (;;) {
      const next = this.peek();
      if (!next || next.kind === 'or' || next.kind === 'rparen') break;
      if (next.kind === 'and') this.index++;
      children.push(this.parseNot());
    }
    return children.length === 1 ? children[0] : { type: 'and', children };
  }

  private parseNot(): QueryNode {
    if (this.peek()?.kind === 'not') {
      this.index++;
      return { type: 'not', child: this.parseNot() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): QueryNode {
    const token = this.peek();
    const previous = this.tokens[this.index - 1];

    if (!token) {
      throw new QuerySyntaxError(
        previous && previous.kind !== 'lparen'
          ? `Add a term after ${previous.text}.`
          : 'Add a term inside the parentheses.',
        this.length,
      );
    }

    switch (token.kind) {
      case 'term':
        this.index++;
        return toTerm(token);

      case 'lparen': {
        this.index++;
        if (this.peek()?.kind === 'rparen') {
          throw new QuerySyntaxError('These parentheses are empty.', token.position);
        }
        const node = this.parseOr();
        if (this.peek()?.kind !== 'rparen') {
          throw new QuerySyntaxError('This opening parenthesis is never closed.', token.position);
        }
        this.index++;
        return node;
      }

      case 'rparen':
        throw new QuerySyntaxError(
          previous && previous.kind !== 'lparen' && previous.kind !== 'rparen'
            ? `Add a term after ${previous.text}.`
            : 'This closing parenthesis has no matching "(".',
          token.position,
        );

      default:
        throw new QuerySyntaxError(
          previous && previous.kind !== 'term' && previous.kind !== 'rparen'
            ? `${token.text} cannot directly follow ${previous.text === '(' ? '"("' : previous.text}.`
            : `Add a term before ${token.text}.`,
          token.position,
        );
    }
  }
}

export function parseQuery(text: string): ParseResult {
  try {
    return { ok: true, ast: new Parser(tokenize(text), text.length).parse() };
  } catch (error) {
    if (error instanceof QuerySyntaxError) {
      return { ok: false, issue: { message: error.message, position: error.position } };
    }
    throw error;
  }
}

/** Returns the first structural problem in a query, or null if it is well formed. */
export function findQueryIssue(text: string): QueryIssue | null {
  const result = parseQuery(text);
  return result.ok ? null : result.issue;
}
