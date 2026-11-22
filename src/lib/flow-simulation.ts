/** Conservative three-valued interpretation of simple shell tests. Never executes code. */
export type SimulatedTruth = 'true' | 'false' | 'unknown';
export type SimulatedValue = string | readonly string[];
export type SimulationVariables = Readonly<Record<string, SimulatedValue>>;

export function parseSimulatedValue(input: string): SimulatedValue {
  const trimmed = input.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string' || typeof item === 'number'))
        return parsed.map(String);
    } catch { /* Treat invalid JSON as a plain string. */ }
  }
  return input;
}

function operand(raw: string, values: SimulationVariables): string | undefined {
  const text = raw.trim().replace(/^["']|["']$/g, '');
  const name = text.match(/^\$\{?([A-Za-z_]\w*)\}?$/)?.[1];
  if (!name) return text.includes('$') || text.includes('`') ? undefined : text;
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}

export function evaluateShellCondition(code: string, values: SimulationVariables): SimulatedTruth {
  const text = code.trim().replace(/;?\s*then\s*;?$/, '').trim();
  if (text === 'true' || text === ':') return 'true';
  if (text === 'false') return 'false';
  const body = text.match(/^(?:\[\[|\[|test)\s+([\s\S]*?)\s*(?:\]\]|\])?$/)?.[1];
  if (!body) return 'unknown';
  const unary = body.match(/^(-[zn])\s+(.+?)$/);
  if (unary) {
    const value = operand(unary[2], values);
    if (value === undefined) return 'unknown';
    return (unary[1] === '-z' ? value.length === 0 : value.length > 0) ? 'true' : 'false';
  }
  const binary = body.match(/^(.+?)\s+(==|!=|=|-eq|-ne|-gt|-ge|-lt|-le)\s+(.+)$/);
  if (!binary) return 'unknown';
  const left = operand(binary[1], values);
  const right = operand(binary[3], values);
  if (left === undefined || right === undefined) return 'unknown';
  const op = binary[2];
  if (op === '=' || op === '==') return left === right ? 'true' : 'false';
  if (op === '!=') return left !== right ? 'true' : 'false';
  if (!/^-?\d+$/.test(left) || !/^-?\d+$/.test(right)) return 'unknown';
  const a = BigInt(left), b = BigInt(right);
  const result = op === '-eq' ? a === b : op === '-ne' ? a !== b : op === '-gt' ? a > b : op === '-ge' ? a >= b : op === '-lt' ? a < b : a <= b;
  return result ? 'true' : 'false';
}

/** Return only decisions supported by a recognized, fully specified expression. */
export function evaluateFlowBranch(kind: string, code: string, values: SimulationVariables): SimulatedTruth {
  if (kind !== 'IfClause' && kind !== 'WhileClause' && kind !== 'UntilClause') return 'unknown';
  const condition = code.trim().replace(/^(if|while|until)\s+/, '').split(/\s*;\s*then\b|\s*;\s*do\b|\s+then\b|\s+do\b/)[0];
  const result = evaluateShellCondition(condition, values);
  if (kind !== 'UntilClause' || result === 'unknown') return result;
  return result === 'true' ? 'false' : 'true';
}
