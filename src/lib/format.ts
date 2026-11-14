import { parse, print, LangVariant } from 'sh-syntax';

/**
 * sh-syntax parses Bash-compatible shell grammar, not Zsh-specific extensions.
 * Keep the original script untouched when parsing or formatting fails.
 */
export async function formatShell(code: string, singleLine = false): Promise<string> {
  if (!code.trim()) return '';
  try {
    await parse(code, { variant: LangVariant.LangBash, keepComments: true, filepath: 'script.zsh' });
    const formatted = await print(code, {
      variant: LangVariant.LangBash,
      keepComments: true,
      indent: 2,
      singleLine,
    });
    return formatted.trimEnd();
  } catch (error) {
    throw new Error(
      'O parser Bash do sh-syntax não reconheceu este script. A sintaxe específica do Zsh não será reformatada automaticamente. ' +
      (error instanceof Error ? error.message : String(error)),
    );
  }
}
