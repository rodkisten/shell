let formatter: Promise<typeof import('@wasm-fmt/shfmt/vite')> | undefined;
async function load() {
  if (!formatter) formatter = (async () => {
    const shfmt = await import('@wasm-fmt/shfmt/vite');
    await shfmt.default();
    return shfmt;
  })();
  return formatter;
}
export async function formatShell(code: string, singleLine = false): Promise<string> {
  if (!code.trim()) return '';
  const { format } = await load();
  return format(code, 'script.sh', {
    indent: 2,
    binaryNextLine: false,
    switchCaseIndent: true,
    spaceRedirects: true,
    simplify: false,
    singleLine,
  }).trimEnd();
}
