// ESM imports intentionally load in the browser from esm.sh.
// Keep these declarations aligned with the exact pinned URLs in DebianPage.tsx.
// No runtime imports are bundled by TypeScript.
declare module 'https://esm.sh/highlight.js@11.11.1/lib/core?bundle' {
  type LanguageDefinition = unknown;
  const highlightjs: {
    registerLanguage(name: string, definition: LanguageDefinition): void;
    highlight(source: string, options: { language: string }): { value: string };
  };
  export default highlightjs;
}

declare module 'https://esm.sh/highlight.js@11.11.1/lib/languages/bash?bundle' {
  const bash: unknown;
  export default bash;
}

declare module 'https://esm.sh/marked@15.0.12?bundle' {
  export const marked: {
    parse(source: string, options?: { async?: boolean }): string | Promise<string>;
  };
}

declare module 'https://esm.sh/dompurify@3.2.6?bundle' {
  const dompurify: { sanitize(source: string): string };
  export default dompurify;
}
