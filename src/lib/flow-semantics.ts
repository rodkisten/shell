/**
 * Human-readable descriptions for shell AST nodes.
 * This is a structural explanation, not an assertion about runtime results.
 */
export function describeFlowNode(kind: string, code: string): { title: string; detail: string } {
  const trimmed = code.trim();
  const command = trimmed.match(/^(?:\s*(?:command|builtin)\s+)?([\w./:-]+)/)?.[1] ?? '';
  if (kind === 'DeclClause' || /^(?:typeset|declare|local|readonly|export)\b/.test(trimmed))
    return { title: 'Declarar variável', detail: 'Define atributos ou valores de variáveis no shell.' };
  if (kind === 'Assign' || /^[A-Za-z_][\w]*=/.test(trimmed))
    return { title: 'Atribuir valor', detail: 'Atualiza o valor de uma variável.' };
  if (kind === 'FuncDecl') return { title: 'Declarar função', detail: 'Define uma função que poderá ser chamada posteriormente.' };
  if (kind === 'ForClause') return { title: 'Percorrer itens', detail: 'Executa o corpo para cada item da lista.' };
  if (kind === 'WhileClause') return { title: 'Repetir enquanto verdadeiro', detail: 'Repete o corpo enquanto a condição for satisfeita.' };
  if (kind === 'UntilClause') return { title: 'Repetir até verdadeiro', detail: 'Repete o corpo até a condição ser satisfeita.' };
  if (kind === 'IfClause') return { title: 'Avaliar condição', detail: 'Escolhe um ramo conforme o resultado da condição.' };
  if (kind === 'CaseClause') return { title: 'Selecionar por padrão', detail: 'Escolhe um ramo de acordo com padrões de comparação.' };
  if (kind === 'BinaryCmd') return { title: trimmed.includes('&&') ? 'Executar se houver sucesso' : trimmed.includes('||') ? 'Executar se houver falha' : 'Conectar comandos', detail: 'Combina comandos segundo o operador utilizado.' };
  if (kind === 'Subshell') return { title: 'Executar em subshell', detail: 'Agrupa comandos em um ambiente de shell separado.' };
  if (/^\s*return\b/.test(trimmed)) return { title: 'Retornar da função', detail: 'Interrompe a função e devolve um status.' };
  if (/^\s*exit\b/.test(trimmed)) return { title: 'Encerrar o shell', detail: 'Termina a execução do processo de shell.' };
  if (/^\s*(break|continue)\b/.test(trimmed)) return { title: trimmed.trimStart().startsWith('break') ? 'Sair do laço' : 'Próxima iteração', detail: 'Altera o controle do laço atual.' };
  if (kind === 'CallExpr' || kind === 'Stmt') return { title: command ? `Executar ${command}` : 'Executar comando', detail: 'Invoca um comando; seu resultado não é conhecido pela análise estática.' };
  return { title: 'Estrutura do shell', detail: 'Estrutura reconhecida pelo parser, ainda sem descrição específica.' };
}

/** Substitute only explicit variable references for display, never evaluate shell. */
export function previewShellVariables(source: string, variables: Readonly<Record<string, string>>): string {
  return source.replace(/\$\{([A-Za-z_][\w]*)\}|\$([A-Za-z_][\w]*)/g, (match, braced: string | undefined, bare: string | undefined) => {
    const name = braced ?? bare;
    return name && Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : match;
  });
}
