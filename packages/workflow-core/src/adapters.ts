export interface SemanticDiagnostic {
  message: string;
  severity: 'error' | 'warning';
  source: string;
}
export interface OfficialParser {
  parseWorkflow(
    file: { name: string; content: string },
    trace: {
      error(message: string): void;
      info(message: string): void;
      verbose(message: string): void;
    },
  ): { context: { errors: { getErrors(): { message: string }[] } } };
}
export function createActionsAdapter(engine: OfficialParser) {
  return (source: string, name = 'workflow.yml') => {
    const trace = { error() {}, info() {}, verbose() {} };
    const result = engine.parseWorkflow({ name, content: source }, trace);
    const diagnostics: SemanticDiagnostic[] = result.context.errors
      .getErrors()
      .slice(0, 200)
      .map((e) => ({
        message: e.message,
        severity: 'error',
        source: 'github-actions',
      }));
    return { valid: diagnostics.length === 0, diagnostics };
  };
}
export interface SyntaxTree {
  rootNode: unknown;
  delete(): void;
}
export interface SyntaxParser {
  parse(source: string, previous?: SyntaxTree): SyntaxTree | null;
  delete(): void;
}
export function createSyntaxSession(parser: SyntaxParser) {
  let tree: SyntaxTree | null = null;
  let disposed = false;
  return {
    parse(source: string) {
      if (disposed) throw Error('Syntax session disposed');
      // Full parsing until edit coordinates are provided by the editor.
      const next = parser.parse(source);
      if (!next) throw Error('Syntax parser returned no tree');
      tree?.delete();
      tree = next;
      return next.rootNode;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      tree?.delete();
      tree = null;
      parser.delete();
    },
  };
}
