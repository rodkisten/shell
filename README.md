# ShellConductor

A mobile-first shell workbench for learning and daily use. Designed for the iPhone Safari screen, with a clean Vercel-like interface.

**Stack:** React 19 + React Router (library / SPA) + Vite 7 + TypeScript + shadcn-style Radix primitives + Tailwind v4 + CodeMirror 6 + Cloudflare Workers.

## Roadmap de implementação (checklist consolidada)

Esta lista reúne todos os pedidos anteriores e atuais. Marcar uma tarefa somente após a implementação; commits não substituem validação de build ou teste no Safari.

### Editor e diagnósticos
- [x] Editor CodeMirror 6 com syntax highlighting, autocomplete e atalhos.
- [x] Parser experimental Zsh com marcações sublinhadas no editor (debounce de 450 ms; **não** equivale a ShellCheck completo).
- [ ] ShellCheck WASM semântico em tempo real, quando compatível com a sintaxe analisada; não sinalizar construções Zsh válidas como erros Bash.
- [ ] Painel de problemas sincronizado com as marcações, severidade, localização, tooltip e navegação para a linha.
- [ ] Corrigir diagnóstico e aplicar quick fixes seguros; diferenciar parser Zsh de ShellCheck.
- [ ] Validar marcações, debounce e execução no Safari iPhone.

### Layout e terminal
- [x] Editor acima do terminal, com alturas ajustáveis.
- [x] Alternância para layout lado a lado, divisor arrastável e preferência persistida.
- [ ] Validar layout horizontal/vertical, drag e proporções em telas pequenas e Safari iPhone.
- [ ] Corrigir proporção/colunas em todos os breakpoints e tornar os controles acessíveis por teclado.
- [x] Histórico de execuções e separação visual entre registros (CSS existente).
- [ ] Separador visível e consistente entre **cada comando executado**, incluindo comandos de scripts compostos, com texto original, duração, exit code, stdout e stderr.
- [ ] Syntax highlighting no output (incluindo JSON, erros e sequências ANSI) sem executar HTML recebido.
- [ ] Manter opção de autoexecução com atraso e checkbox, sem bloquear edição durante execução.

### Runtime Zsh, Unix e WASM
- [x] Zsh WebAssembly isolado em worker com filesystem IDBFS persistente.
- [ ] Criar interface CommandRuntime para binários WASM e adapters de rede, com cancelamento, timeout e streaming.
- [ ] Avaliar e integrar BusyBox WASI / GNU tools WASM **reais**; não confundir autocomplete com suporte de execução.
- [ ] Integrar jq WASM real para filtros JSON, com entrada/saída e códigos de erro corretos.
- [ ] Disponibilizar awk, sed, sort, column, grep, cut, uniq, head, tail, tr, wc, find, xargs, tee, cat, ls, cp, mv, rm, mkdir, touch, basename, dirname e outros comandos comuns conforme suporte verificável.
- [ ] Integrar curl via fetch (GET, POST, headers, corpo, códigos HTTP, stderr e flags suportadas), com limites e mensagens explícitas de CORS.
- [ ] Considerar wget via fetch usando o mesmo adapter.
- [ ] Conectar os comandos ao Zsh existente sem trocar silenciosamente sua semântica por ash/bash.
- [ ] Garantir pipelines e redirecionamentos reais: stdin/stdout/stderr, pipefail, exit codes, arquivos e comandos compostos.
- [ ] Compartilhar filesystem virtual entre runtimes ou implementar sincronização explícita e consistente.
- [ ] Lazy-load dos módulos WASM, cache local e controle de tamanho do bundle.
- [ ] Validar limites de memória, timeout, cancelamento, segurança de rede e CORS.

### Qualidade e documentação
- [ ] Atualizar documentação de arquitetura e limitações reais; remover referências legadas a Bashkit/shfmt que não representem a implementação atual.
- [ ] Validar typecheck, lint e build, e corrigir regressões.
- [ ] Fazer smoke tests manuais de pipelines, jq, awk, sed, sort, curl, persistência e layout mobile.
- [ ] Registrar commits por bloco de trabalho, não um commit por arquivo; acompanhar conflitos com main.

## Features

- Bash editor with syntax highlighting, contextual completion, clickable commands, examples and manual popovers.
- Real man page details, synopsis, flags and command explanation from the [ManKier API v2](https://www.mankier.com/api), fetched through the Cloudflare Worker.
- [shfmt](https://github.com/mvdan/sh) as WebAssembly for code formatting and the one-line / multi-line conversion.
- [ShellCheck](https://www.shellcheck.net/) as WebAssembly, showing warnings and available automatic fixes with source links.
- Isolated [Bashkit WebAssembly](https://github.com/everruns/bashkit) with pipes, variables, loops, functions, `jq`, `awk`, `sed`, virtual filesystem and limits on execution.
- Saved commands, runs and current draft persisted in IndexedDB, capped at 150 history records. No sign-in.
- Safari touch-first UI, compact command toolbar, safe-area navigation, keyboard-friendly text size and PWA manifest.
- React Router navigation: editor, reference library and saved history.

## Touch Commands / VS Code sidebar

A dedicated narrow-screen route is available at `/touch` (also `/extension`).
It includes one-line presets organized by category, custom commands, favorites,
local recent history, import of recent commands supplied by an extension, and
a safe postMessage bridge. **Insert** sends without Enter; **Run** sends with Enter.
Before an extension connects, tapping a command copies it to the clipboard.

Integration contract and wrapper example: [docs/vscode-touch-bridge.md](docs/vscode-touch-bridge.md).

## Running locally

Node.js 22+ is recommended.

```sh
npm install
npm run dev
```

Quality checks (intentionally no test suite):

```sh
npm run typecheck
npm run lint
npm run format
npm run build
```

## Cloudflare continuous deployment (native Workers Builds)

The repo includes `wrangler.jsonc`, the Cloudflare Vite plugin, the Worker backend, and the build/deploy scripts.

1. Go to **Cloudflare Dashboard → Workers & Pages → Create application → GitHub** (or open an existing Worker → **Settings → Builds → Connect**).
2. Select **rodkisten/shell**, root `/`, production branch **main**.
3. Ensure the Worker name is **shell**, matching `wrangler.jsonc`.
4. Set install command `npm install --no-audit --no-fund`, build command `npm run build`, deploy command `npx wrangler deploy` (or set deploy command to `npm run deploy` if build runs there).
5. Enable preview builds for PRs if you want them. Save and deploy.

After the connection is made, Cloudflare automatically builds/deploys on commits to `main`. **This repository does not by itself connect to your Cloudflare account.** Cloudflare's own GitHub integration needs to be authorized in the dashboard. The GitHub Actions workflow only checks build and lint; it does not deploy, to avoid duplicate releases.

### Worker headers

Static asset headers are defined in `public/_headers`, including `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. This is necessary for the ShellCheck browser engine (`SharedArrayBuffer`, modern Safari required). ShellCheck is loaded only when validation is requested. Other tools do not require cross-origin isolation.

### Security and limitations

- **Executing** means running inside an isolated Bash-like virtual environment, **not** your real iPhone terminal or Cloud Shell. It does not run SSH, your system binaries, or arbitrary installed programs. HTTP via curl/wget is not enabled in the browser WASM sandbox. Never treat the result as authoritative execution on Linux.
- Bashkit's shell is highly capable but not identical to Bash on every platform, and the tool can be resource-limited or interrupted.
- shfmt and ShellCheck are not AI code repair. The “apply fixes” action only performs fixes explicitly emitted by ShellCheck. Some diagnostics require manual edits.
- One-line conversion uses shfmt's grammar, not a destructive newline replacement. When complex constructs cannot become a single line, they remain multiline.
- Mankier API requests are sent for command names or complete code only when users open a manual/explanation. Avoid sharing secrets. The server caches responses for a short time.
- Scripts and history remain in local IndexedDB. Safari private browsing or clearing site data may remove them.
- The UI is optimized for desktop and iPhone Safari but requires a modern browser to run WASM.

## License notes

ShellCheck and its WASM artifact are GPL-3.0-or-later. Verify distribution obligations when shipping compiled code. Other package licenses are in each upstream package.

No tests are configured, by request.
