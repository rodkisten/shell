import { print, LangVariant } from 'sh-syntax';
import { parseShellAst } from './shell-parser';

/**
 * sh-syntax exposes experimental Zsh grammar support (LangZsh).\n * It is incomplete; do not rewrite source if parsing fails.
 * Keep the original script untouched when parsing or formatting fails.
 */
export async function formatShell(code: string, singleLine = false): Promise<string> {
  if (!code.trim()) return '';
  try {
    await parseShellAst(code);
    const formatted = await print(code, {
      variant: LangVariant.LangZsh,
      keepComments: true,
      indent: 2,
      singleLine,
    });
    return formatted.trimEnd();
  } catch (error) {
    throw new Error(
      'O parser experimental de Zsh do sh-syntax não reconheceu este script. O código original foi preservado. ' +
      (error instanceof Error ? error.message : String(error)),
    );
  }
}
