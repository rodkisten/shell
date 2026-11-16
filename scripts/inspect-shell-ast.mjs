import { parse, LangVariant } from 'sh-syntax';

const samples = {
  pipeline: 'printf "%s\\n" café | grep café',
  condition: 'if test -f ./file; then echo yes; else echo no; fi',
  loop: 'for item in a b; do printf "%s\\n" "$item"; done',
  expansion: 'value=$(printf hello); echo "${value}"',
  redirect: 'printf hello >> output.txt',
};
function summarize(value, depth = 0, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 2).map(x => summarize(x, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).slice(0, 14).map(([key, child]) => {
    if (child && typeof child === 'object') return [key, summarize(child, depth + 1, seen)];
    return [key, typeof child === 'string' ? child.slice(0, 60) : child];
  }));
}
for (const [name, source] of Object.entries(samples)) {
  try {
    const ast = await parse(source, { variant: LangVariant.LangZsh, keepComments: true });
    if (!ast || typeof ast !== 'object') throw new Error('Parser did not return an AST object');
    console.log('AST_FIXTURE', JSON.stringify({ name, source, shape: summarize(ast) }));
  } catch (error) {
    console.error('AST_FIXTURE_FAILED', name, error);
    process.exitCode = 1;
  }
}
