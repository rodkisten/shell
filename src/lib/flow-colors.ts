/**
 * Shared semantic palette for flow nodes and their control transfers.
 * Colors are chosen to remain legible against the editor's dark theme.
 */
export const FLOW_COLORS = {
  command: '#93c5fd',
  condition: '#fbbf24',
  loop: '#22d3ee',
  branch: '#c4b5fd',
  function: '#a78bfa',
  pipeline: '#2dd4bf',
  success: '#4ade80',
  failure: '#fb7185',
  unknown: '#fb923c',
  neutral: '#94a3b8',
} as const;

export function flowNodeColor(kind: string, source: string): string {
  if (kind === 'IfClause' || kind === 'BinaryCmd') return FLOW_COLORS.condition;
  if (kind === 'WhileClause' || kind === 'ForClause' || kind === 'UntilClause') return FLOW_COLORS.loop;
  if (kind === 'CaseClause' || kind === 'CaseItem') return FLOW_COLORS.branch;
  if (kind === 'FuncDecl') return FLOW_COLORS.function;
  if (kind === 'Stmt' || kind === 'CallExpr') {
    if (/^\s*(return|exit)\b/.test(source)) return FLOW_COLORS.failure;
    if (/^\s*(break|continue)\b/.test(source)) return FLOW_COLORS.loop;
    return FLOW_COLORS.command;
  }
  return FLOW_COLORS.unknown;
}

export function flowEdgeColor(kind: string): string {
  if (kind === 'true') return FLOW_COLORS.success;
  if (kind === 'false') return FLOW_COLORS.failure;
  if (kind === 'loop') return FLOW_COLORS.loop;
  if (kind === 'pipeline') return FLOW_COLORS.pipeline;
  if (kind === 'conditional') return FLOW_COLORS.branch;
  if (kind === 'unknown') return FLOW_COLORS.unknown;
  return FLOW_COLORS.neutral;
}

/** Lightweight, escaped-by-React token coloring for graph labels. */
export function tokenizeFlowLabel(value: string): Array<{ text: string; color: string }> {
  const tokens = value.match(/\$\{?[\w@?#]+\}?|\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|in|return|exit|break|continue|function)\b|&&|\|\||\|&|\||[\w./:-]+|\s+|./g) ?? [];
  return tokens.map(text => ({
    text,
    color: /^\$/.test(text) ? FLOW_COLORS.pipeline
      : /^(?:if|then|else|elif|fi|for|while|do|done|case|esac|in|return|exit|break|continue|function)$/.test(text) ? FLOW_COLORS.branch
      : /^(?:&&|\|\||\|&|\|)$/.test(text) ? FLOW_COLORS.condition
      : FLOW_COLORS.command,
  }));
}
