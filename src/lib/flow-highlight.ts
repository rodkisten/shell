import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';

hljs.registerLanguage('bash', bash);

/**
 * Highlight user-supplied shell text using Highlight.js' Bash grammar.
 * Highlight.js escapes input before emitting markup. Do not interpolate
 * unescaped source text into the returned HTML.
 */
export function highlightFlowSource(source: string): string {
  return hljs.highlight(source, { language: 'bash', ignoreIllegals: true }).value;
}
