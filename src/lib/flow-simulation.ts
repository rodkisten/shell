/** Conservative three-valued interpretation of simple shell tests. Never executes code. */
export type SimulatedTruth = 'true' | 'false' | 'unknown';
export type SimulatedDecision = SimulatedTruth | `case:${number}` | 'case:none';
export type SimulatedValue = string | readonly string[];
export type SimulationVariables = Readonly<Record<string, SimulatedValue>>;

export function parseSimulatedValue(input: string): SimulatedValue {
  const trimmed = input.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string' || typeof item === 'number')) {
        return parsed.map(String);
      }
    } catch {
      /* Treat invalid JSON as a plain string. */
    }
  }
  return input;
}

function stripMatchingQuotes(raw: string): { text: string; singleQuoted: boolean } {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return { text: trimmed.slice(1, -1), singleQuoted: true };
    }
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return { text: trimmed.slice(1, -1), singleQuoted: false };
    }
  }
  return { text: trimmed, singleQuoted: false };
}

function invertTruth(value: SimulatedTruth): SimulatedTruth {
  if (value === 'true') return 'false';
  if (value === 'false') return 'true';
  return 'unknown';
}

function resolveParameter(expr: string, values: SimulationVariables): string | undefined {
  // ${#VAR} (comprimento de string ou tamanho de array)
  const lenMatch = expr.match(/^#([A-Za-z_]\w*)$/);
  if (lenMatch) {
    const val = values[lenMatch[1]];
    if (val === undefined) return undefined;
    return Array.isArray(val) ? String(val.length) : String([...val].length);
  }

  // ${VAR:-default}, ${VAR-default}, ${VAR:+alt}, ${VAR+alt}, ${VAR:=default}, ${VAR=default}
  const modMatch = expr.match(/^([A-Za-z_]\w*)(:-|-|:\+|\+|:=|=)(.*)$/);
  if (modMatch) {
    const [, name, op, rawFallback] = modMatch;
    const val = values[name];
    if (Array.isArray(val)) return undefined;

    const exists = val !== undefined;
    const nonEmpty = exists && val.length > 0;
    const fallback = operand(rawFallback, values);

    switch (op) {
      case ':-':
      case ':=':
        return nonEmpty ? val : fallback;
      case '-':
      case '=':
        return exists ? val : fallback;
      case ':+':
        return nonEmpty ? (fallback ?? '') : '';
      case '+':
        return exists ? (fallback ?? '') : '';
    }
  }

  // Nome simples de variável
  if (/^[A-Za-z_]\w*$/.test(expr)) {
    const val = values[expr];
    return typeof val === 'string' ? val : undefined;
  }

  return undefined;
}

function operand(raw: string, values: SimulationVariables): string | undefined {
  const { text, singleQuoted } = stripMatchingQuotes(raw);
  if (singleQuoted) return text;

  // ${...}
  if (text.startsWith('${') && text.endsWith('}')) {
    return resolveParameter(text.slice(2, -1), values);
  }

  // $VAR
  const simpleVar = text.match(/^\$([A-Za-z_]\w*)$/);
  if (simpleVar) {
    const value = values[simpleVar[1]];
    return typeof value === 'string' ? value : undefined;
  }

  // Interpolação simples dentro de string dupla (ex: "prefix-${ENV}")
  if (text.includes('$') || text.includes('`')) {
    let failed = false;
    const interpolated = text.replace(/\$\{([^}]+)\}|\$([A-Za-z_]\w*)/g, (_, braced: string | undefined, bare: string | undefined) => {
      const resolved = resolveParameter(braced ?? bare ?? '', values);
      if (resolved === undefined) {
        failed = true;
        return '';
      }
      return resolved;
    });
    return failed ? undefined : interpolated;
  }

  return text;
}

function globToRegExp(pattern: string): RegExp {
  let regex = '^';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      regex += '\\' + pattern[++i];
      continue;
    }
    if (inClass) {
      if (ch === ']') {
        inClass = false;
        regex += ']';
      } else if (ch === '!' && pattern[i - 1] === '[') {
        regex += '^';
      } else {
        regex += ch;
      }
      continue;
    }
    if (ch === '[') {
      inClass = true;
      regex += '[';
    } else if (ch === '*') {
      regex += '.*';
    } else if (ch === '?') {
      regex += '.';
    } else if (/[.+^${}()|\\]/.test(ch)) {
      regex += '\\' + ch;
    } else {
      regex += ch;
    }
  }
  return new RegExp(regex + '$');
}

function evalArithmeticExpr(expr: string, values: SimulationVariables): bigint | undefined {
  const trimmed = expr.trim();
  if (!trimmed) return undefined;

  // Remover parênteses externos balanceados
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    let depth = 0;
    let balanced = true;
    for (let i = 0; i < trimmed.length - 1; i++) {
      if (trimmed[i] === '(') depth++;
      else if (trimmed[i] === ')') depth--;
      if (depth === 0) {
        balanced = false;
        break;
      }
    }
    if (balanced) return evalArithmeticExpr(trimmed.slice(1, -1), values);
  }

  // Operadores lógicos (menor precedência)
  const logical = trimmed.match(/^(.+?)\s*(\|\||&&)\s*(.+)$/);
  if (logical) {
    const l = evalArithmeticExpr(logical[1], values);
    const r = evalArithmeticExpr(logical[3], values);
    if (l === undefined || r === undefined) return undefined;
    if (logical[2] === '&&') return l !== 0n && r !== 0n ? 1n : 0n;
    return l !== 0n || r !== 0n ? 1n : 0n;
  }

  // Comparações
  const cmp = trimmed.match(/^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/);
  if (cmp) {
    const l = evalArithmeticExpr(cmp[1], values);
    const r = evalArithmeticExpr(cmp[3], values);
    if (l === undefined || r === undefined) return undefined;
    switch (cmp[2]) {
      case '==': return l === r ? 1n : 0n;
      case '!=': return l !== r ? 1n : 0n;
      case '<': return l < r ? 1n : 0n;
      case '<=': return l <= r ? 1n : 0n;
      case '>': return l > r ? 1n : 0n;
      case '>=': return l >= r ? 1n : 0n;
    }
  }

  // Soma e subtração binárias
  const addSub = trimmed.match(/^(.+?)\s*([+-])\s*([^+-]+)$/);
  if (addSub) {
    const l = evalArithmeticExpr(addSub[1], values);
    const r = evalArithmeticExpr(addSub[3], values);
    if (l === undefined || r === undefined) return undefined;
    return addSub[2] === '+' ? l + r : l - r;
  }

  // Multiplicação, divisão e módulo
  const mulDiv = trimmed.match(/^(.+?)\s*([*/%])\s*([^*/%]+)$/);
  if (mulDiv) {
    const l = evalArithmeticExpr(mulDiv[1], values);
    const r = evalArithmeticExpr(mulDiv[3], values);
    if (l === undefined || r === undefined) return undefined;
    if (mulDiv[2] === '*') return l * r;
    if (r === 0n) return undefined;
    return mulDiv[2] === '/' ? l / r : l % r;
  }

  // Negação lógica unária (!expr)
  if (trimmed.startsWith('!')) {
    const inner = evalArithmeticExpr(trimmed.slice(1), values);
    if (inner === undefined) return undefined;
    return inner === 0n ? 1n : 0n;
  }

  // Número literal
  if (/^-?\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }

  // Variável com ou sem $ (em (( x > 0 )), x é resolvido do ambiente)
  const varName = trimmed.replace(/^\$\{?([A-Za-z_]\w*)\}?$/, '$1');
  if (/^[A-Za-z_]\w*$/.test(varName)) {
    const raw = values[varName];
    if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) {
      return BigInt(raw.trim());
    }
  }

  return undefined;
}

function evalBracketBody(body: string, values: SimulationVariables, extended: boolean): SimulatedTruth {
  const trimmed = body.trim();
  if (!trimmed) return 'false';

  // Negação interna: [ ! ... ] ou [[ ! ... ]]
  if (trimmed.startsWith('! ')) {
    return invertTruth(evalBracketBody(trimmed.slice(2), values, extended));
  }

  // Operadores compostos
  const compoundSep = extended ? /\s+(&&|\|\|)\s+/ : /\s+(-a|-o)\s+/;
  const compoundMatch = trimmed.match(new RegExp(`^(.+?)${compoundSep.source}(.+)$`));
  if (compoundMatch) {
    const left = evalBracketBody(compoundMatch[1], values, extended);
    const op = compoundMatch[2];
    const right = evalBracketBody(compoundMatch[3], values, extended);
    const isAnd = op === '&&' || op === '-a';
    if (isAnd) {
      if (left === 'false' || right === 'false') return 'false';
      if (left === 'true' && right === 'true') return 'true';
      return 'unknown';
    } else {
      if (left === 'true' || right === 'true') return 'true';
      if (left === 'false' && right === 'false') return 'false';
      return 'unknown';
    }
  }

  // Operadores unários (-z, -n, -v)
  const unary = trimmed.match(/^(-[znv])\s+(.+?)$/);
  if (unary) {
    const op = unary[1];
    if (op === '-v') {
      const varName = stripMatchingQuotes(unary[2]).text.replace(/^\$\{?|\}?$/g, '');
      if (!/^[A-Za-z_]\w*$/.test(varName)) return 'unknown';
      return values[varName] !== undefined ? 'true' : 'false';
    }
    const value = operand(unary[2], values);
    if (value === undefined) return 'unknown';
    return (op === '-z' ? value.length === 0 : value.length > 0) ? 'true' : 'false';
  }

  // Operadores binários
  const binary = trimmed.match(/^(.+?)\s+(==|!=|=~|=|-eq|-ne|-gt|-ge|-lt|-le)\s+(.+)$/);
  if (!binary) {
    // Argumento único implícito: [ "$VAR" ] equivale a [ -n "$VAR" ]
    if (!/\s/.test(trimmed)) {
      const single = operand(trimmed, values);
      if (single === undefined) return 'unknown';
      return single.length > 0 ? 'true' : 'false';
    }
    return 'unknown';
  }

  const left = operand(binary[1], values);
  const op = binary[2];
  const right = operand(binary[3], values);
  if (left === undefined || right === undefined) return 'unknown';

  if (extended && op === '=~') {
    try {
      return new RegExp(right).test(left) ? 'true' : 'false';
    } catch {
      return 'unknown';
    }
  }

  if (op === '=' || op === '==') {
    if (extended && /[*?[]/.test(right)) {
      return globToRegExp(right).test(left) ? 'true' : 'false';
    }
    return left === right ? 'true' : 'false';
  }

  if (op === '!=') {
    if (extended && /[*?[]/.test(right)) {
      return !globToRegExp(right).test(left) ? 'true' : 'false';
    }
    return left !== right ? 'true' : 'false';
  }

  if (!/^-?\d+$/.test(left.trim()) || !/^-?\d+$/.test(right.trim())) return 'unknown';
  const a = BigInt(left.trim());
  const b = BigInt(right.trim());
  const result =
    op === '-eq' ? a === b :
    op === '-ne' ? a !== b :
    op === '-gt' ? a > b :
    op === '-ge' ? a >= b :
    op === '-lt' ? a < b :
    a <= b;
  return result ? 'true' : 'false';
}

export function evaluateShellCondition(code: string, values: SimulationVariables): SimulatedTruth {
  let text = code.trim().replace(/;?\s*(?:then|do)\s*;?$/, '').trim();

  // Negação externa: ! [ ... ] ou ! (( ... ))
  let negated = false;
  while (/^!\s+/.test(text)) {
    negated = !negated;
    text = text.replace(/^!\s+/, '').trim();
  }

  const finalize = (res: SimulatedTruth): SimulatedTruth => (negated ? invertTruth(res) : res);

  if (text === 'true' || text === ':') return finalize('true');
  if (text === 'false') return finalize('false');

  // Expressão aritmética: (( ... ))
  if (text.startsWith('((') && text.endsWith('))')) {
    const arithmVal = evalArithmeticExpr(text.slice(2, -2), values);
    if (arithmVal === undefined) return 'unknown';
    return finalize(arithmVal !== 0n ? 'true' : 'false');
  }

  // Teste estendido: [[ ... ]]
  if (text.startsWith('[[') && text.endsWith(']]')) {
    return finalize(evalBracketBody(text.slice(2, -2), values, true));
  }

  // Teste POSIX: [ ... ]
  if (text.startsWith('[') && text.endsWith(']')) {
    return finalize(evalBracketBody(text.slice(1, -1), values, false));
  }

  // Comando test ...
  if (text === 'test') return finalize('false');
  if (text.startsWith('test ')) {
    return finalize(evalBracketBody(text.slice(5), values, false));
  }

  return 'unknown';
}

export function evaluateCaseBranch(code: string, values: SimulationVariables): SimulatedDecision {
  const headerMatch = code.trim().match(/^case\s+(.+?)\s+in\b/s);
  if (!headerMatch) return 'unknown';

  const subject = operand(headerMatch[1], values);
  if (subject === undefined) return 'unknown';

  const body = code
    .trim()
    .slice(headerMatch[0].length)
    .replace(/\besac\s*$/, '')
    .trim();

  if (!body) return 'case:none';

  // Divide os braços pelos terminadores ;;, ;& ou ;;& fora de aspas
  const items = body.split(/;;&|;;|;&/).map((s) => s.trim()).filter(Boolean);

  for (let i = 0; i < items.length; i++) {
    const closeParen = items[i].indexOf(')');
    if (closeParen < 0) return 'unknown';

    const rawPatterns = items[i].slice(0, closeParen).replace(/^\(/, '').split('|');
    for (const rawPat of rawPatterns) {
      const pat = operand(rawPat, values);
      if (pat === undefined) return 'unknown';
      if (pat === '*' || globToRegExp(pat).test(subject)) {
        return `case:${i}`;
      }
    }
  }

  return 'case:none';
}

/** Return only decisions supported by a recognized, fully specified expression. */
export function evaluateFlowBranch(kind: string, code: string, values: SimulationVariables): SimulatedDecision {
  if (kind === 'CaseClause') {
    return evaluateCaseBranch(code, values);
  }
  if (kind !== 'IfClause' && kind !== 'WhileClause' && kind !== 'UntilClause') {
    return 'unknown';
  }
  const condition = code
    .trim()
    .replace(/^(if|while|until)\s+/, '')
    .split(/\s*;\s*then\b|\s*;\s*do\b|\s+then\b|\s+do\b/)[0];

  const result = evaluateShellCondition(condition, values);
  if (kind !== 'UntilClause' || result === 'unknown') return result;
  return invertTruth(result);
}
