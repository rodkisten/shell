# ShellConductor

A mobile-first shell workbench for learning and daily use. Designed for the iPhone Safari screen, with a clean Vercel-like interface.

**Stack:** React 19 + React Router (library / SPA) + Vite 7 + TypeScript + shadcn-style Radix primitives + Tailwind v4 + CodeMirror 6 + Cloudflare Workers.

## Roadmap de implementação (checklist consolidada)

Esta lista reúne todos os pedidos anteriores e atuais. Marcar uma tarefa somente após a implementação; commits não substituem validação de build ou teste no Safari.

### Explicação semântica local (PR #4)
- [x] Hover contextual de comandos, opções conhecidas e operadores no CodeMirror 6.
- [x] Botão **Explicar comando** usa validação Zsh do sh-syntax e catálogo local; não envia o script à API remota.
- [x] Identificar explicitamente a cobertura parcial, sem apresentar tokenização como AST semântica completa.
- [x] Exibir a AST estrutural real retornada por `sh-syntax`, com travessia limitada para desempenho no Safari.
- [x] Criar modelo de nós AST com descrição, hierarquia, limites de percurso e ranges quando expostos pelo parser.
- [x] Exibir lista de nós selecionáveis no painel, com navegação para o CodeMirror 6 quando há range válido.
- [ ] Validar os formatos concretos de posições/tipos do sh-syntax e completar interpretação semântica de `Stmt`, `CallExpr`, `IfClause`, `ForClause`, `CmdSubst`, `Redirect`.
- [x] Criar formato interno de especificações CLI e suporte inicial a subcomandos, flags com valores e argumentos posicionais (Git, Docker, curl, npm).
- [ ] Importar e normalizar specs de subcomandos e flags do Fig/Carapace, preservando procedência.
- [x] Evitar explicações enganosas em linhas com estruturas de controle, substituições e expansões dinâmicas (cobertura conservadora).
- [ ] Completar flags agrupadas, valores inline, comandos aninhados, comentários inline, redirecionamentos e variações por versão da CLI.
- [x] Painel inicial de explicação acionado por toque no CodeMirror, com descrição, exemplo e fonte.
- [ ] Navegação bidirecional por nós da AST e validação touch no Safari.
- [ ] Validar typecheck, lint, build e comportamento em Safari iPhone.

### Editor e diagnósticos
- [x] Editor CodeMirror 6 com syntax highlighting, autocomplete e atalhos.
- [x] Parser experimental Zsh com marcações sublinhadas no editor (debounce de 450 ms; **não** equivale a ShellCheck completo).
- [ ] ShellCheck WASM semântico em tempo real, quando compatível com a sintaxe analisada; não sinalizar construções Zsh válidas como erros Bash.
- [ ] Painel de problemas sincronizado com as marcações, severidade, localização, tooltip e navegação para a linha.
- [x] Corrigir extração de linha/coluna dos erros do parser Zsh e evitar aplicação de diagnósticos obsoletos.
- [ ] Aplicar quick fixes seguros; diferenciar parser Zsh de ShellCheck.
- [ ] Validar marcações, debounce e execução no Safari iPhone.

### Linux v86 + Alpine
- [x] Criar painel Linux opcional em /linux, com navegação desktop/mobile.
- [x] Integrar API de inicialização v86, RAM configurável e URLs de BIOS/WASM/ISO.
- [x] Adicionar exportação/importação de snapshots manuais.
- [x] Adicionar comando npm run linux:assets para baixar Alpine x86 e preparar arquivos v86 com verificação SHA-256; exige release compatível.
- [x] Exibir erros de assets ausentes antes de iniciar a VM.
- [x] Adicionar workflow manual para compilar libv86.js e v86.wasm da mesma revisão do código-fonte, baixar Alpine com SHA-256 e disponibilizar artifact.
- [x] Workflow de build dos assets validado em execução confirmada pelo usuário.
- [x] Bucket R2 `shell-linux-assets` criado na Cloudflare (2026-11-15).
- [x] Endpoint Worker `/v86/*` integrado ao binding R2 e workflow com publicação opt-in.
- [ ] Publicar cinco objetos em R2 e confirmar respostas HTTP 200/206/HEAD; bucket inicialmente vazio.
- [ ] Validar boot do Alpine no Safari iPhone e no desktop.
- [ ] Configurar networking de convidado e testar apk/curl no Linux.
- [ ] Implementar persistência automática de disco/snapshot no IndexedDB.
- [ ] Integrar teclado virtual, terminal serial e gestos mobile.

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
- [x] Integrar BusyBox WASM via wasi-sh como runtime POSIX opt-in (`# shellconductor:busybox` ou `busybox-sh`), com carregamento dinâmico.
- [ ] Validar BusyBox no build e no Safari; verificar empacotamento do WASM e arquivos de lock.
- [ ] Integrar jq WASM real para filtros JSON, com entrada/saída e códigos de erro corretos.
- [x] Disponibilizar no runtime BusyBox opt-in os applets declarados pelo wasi-sh, incluindo awk, sed, sort, grep, cut, uniq, head, tail, tr, wc, find, cat, ls, cp, mv, rm, mkdir, touch, basename e dirname (pendente validação no projeto).
- [ ] Adicionar `column`, `tee` e demais comandos não confirmados no conjunto de applets do wasi-sh; integrar ferramentas WASM adicionais.
- [x] Adapter experimental de curl via fetch para chamadas isoladas (GET, POST, HEAD, headers, corpo, timeout e mensagens de CORS); pipelines ainda não suportados.
- [ ] Validar o adapter curl em navegador real e integrar ao dispatcher de pipelines.
- [ ] Considerar wget via fetch usando o mesmo adapter.
- [ ] Conectar os comandos ao Zsh existente sem trocar silenciosamente sua semântica por ash/bash.
- [ ] Garantir pipelines e redirecionamentos reais: stdin/stdout/stderr, pipefail, exit codes, arquivos e comandos compostos.
- [ ] Compartilhar filesystem virtual entre runtimes ou implementar sincronização explícita e consistente.
- [x] Lazy import do módulo wasi-sh ao selecionar BusyBox.
- [ ] Cache local de WASM, medição de bundle e carregamento sob demanda de outros módulos.
- [ ] Validar limites de memória, timeout, cancelamento, segurança de rede e CORS.

### Qualidade e documentação
- [ ] Atualizar documentação de arquitetura e limitações reais; remover referências legadas a Bashkit/shfmt que não representem a implementação atual.
- [ ] Validar typecheck, lint e build, e corrigir regressões.
- [ ] Fazer smoke tests manuais de pipelines, jq, awk, sed, sort, curl, persistência e layout mobile.
- [ ] Registrar commits por bloco de trabalho, não um commit por arquivo; acompanhar conflitos com main.

## Features

- Zsh editor with syntax highlighting, contextual completion, clickable commands, examples and manual popovers.
- Real man page details, synopsis, flags and command explanation from the [ManKier API v2](https://www.mankier.com/api), fetched through the Cloudflare Worker.
- Code formatting and one-line / multi-line conversion through the current sh-syntax integration.
- Experimental Zsh syntax diagnostics in CodeMirror. Full semantic ShellCheck WASM integration is planned, not yet active.
- Isolated [Zsh WebAssembly](https://github.com/brandonzylstra/zsh-wasm) with persistent virtual filesystem. A separate opt-in BusyBox WASM POSIX runtime is available; cross-runtime pipelines are still planned.
- Saved commands, runs and current draft persisted in IndexedDB, capped at 150 history records. No sign-in.
- Safari touch-first UI, compact command toolbar, safe-area navigation, keyboard-friendly text size and PWA manifest.
- React Router navigation: editor, reference library and saved history.

## BusyBox WASM (POSIX opt-in)

O Zsh continua sendo o interpretador padrão. Para executar **applets BusyBox reais**
e pipelines POSIX no runtime independente wasi-sh, comece o script com:

```sh
# shellconductor:busybox
printf 'banana\\nmaçã\\nbanana\\n' | sort | uniq -c
printf 'a,b\\n1,2\\n' | awk -F, '{ print $2 }'
printf 'abc\\n' | sed 's/b/X/'
```

Alternativamente, use `busybox-sh` como primeira palavra, seguida pelo script
POSIX. **Isso executa ash/BusyBox, não Zsh**. Variáveis, arquivos e diretórios
do Zsh IDBFS não são compartilhados com o filesystem efêmero do BusyBox.
O pacote é carregado dinamicamente apenas quando selecionado.

O BusyBox não inclui automaticamente `jq`, `column` nem todos os utilitários
GNU. A integração de `curl | jq` e a sincronização entre runtimes continuam pendentes.

## Alpine Linux (v86)

### Publicação Cloudflare R2

O bucket `shell-linux-assets` existe na conta Cloudflare. O workflow **Linux VM assets** aceita `publish_r2=true` e envia os cinco arquivos para `v86/` no bucket. Para publicar, configure os secrets de repositório `CLOUDFLARE_API_TOKEN` (R2 Object Read & Write) e `CLOUDFLARE_ACCOUNT_ID`. Não coloque tokens no código. Execute o workflow com a opção de publicação, então verifique o deploy do Worker que contém o binding `LINUX_ASSETS`.

Smoke test após publicação e deploy:

```bash
BASE_URL="https://SEU-DOMINIO"
curl -fsSI "$BASE_URL/v86/v86.wasm"
curl -fsSI -H 'Range: bytes=0-1023' "$BASE_URL/v86/alpine.iso"
curl -fsS -D - -o /dev/null -H 'Range: bytes=0-1023' "$BASE_URL/v86/alpine.iso"
```

A última requisição deve retornar `206 Partial Content` e `Content-Range: bytes 0-1023/<tamanho>`. Ainda não foi comprovado o boot da VM.

### Compilação reprodutível (GitHub Actions)

Abra [Linux VM assets](https://github.com/rodkisten/shell/actions/workflows/linux-v86-assets.yml) e execute manualmente. O workflow compila `libv86.js` e `v86.wasm` da **mesma revisão** do repositório v86, copia as BIOS, baixa a ISO Alpine x86, valida SHA-256 e publica um artifact temporário `shellconductor-v86-alpine-x86`. **Ele não faz deploy automaticamente**: ainda é necessário publicar o conteúdo de `public/v86` junto com os assets do site. O workflow ainda precisa de execução real e pode exigir ajustes de toolchain.



Acesse **/linux** para abrir a interface de uma VM Linux opcional. A VM usa a
API do [v86](https://github.com/copy/v86), que emula x86 32-bit, e não altera
o Zsh ou o BusyBox. O painel inclui boot, desligamento, RAM configurável,
exportação e restauração **manual** de snapshots.

**Pré-requisito de deploy:** execute `npm run linux:assets` antes do build. O script valida a ISO Alpine por SHA-256 e procura os binários na release mais recente do v86; caso não existam, interrompe com instruções para compilar o v86. Os binários e a imagem não estão incluídos neste
repositório. Antes de iniciar a VM, disponibilize estes arquivos no domínio
da aplicação (por exemplo, via Cloudflare R2 ou assets estáticos):

- `/v86/libv86.js`: bundle browser do v86, com API global `V86`
- `/v86/v86.wasm`: engine WASM compatível com o bundle
- `/v86/seabios.bin` e `/v86/vgabios.bin`: firmwares do v86
- `/v86/alpine.iso`: imagem bootável Alpine Linux **x86 32-bit**, não x86_64

A tela **Configurar imagens** permite substituir cada URL e salva a configuração
localmente. A ISO é carregada por requisições HTTP Range (`206 Partial Content`);
se hospedada em outro domínio, também precisa de CORS adequado. Não confunda
a ISO x86 com Alpine aarch64 ou x86_64. O v86 original não emula kernel x86_64.

O painel verifica a disponibilidade dos arquivos antes de inicializar a VM, exibindo o caminho ausente. Essa verificação não substitui um teste de boot nem garante que a versão da BIOS corresponda ao build do v86.

**Limitações atuais:** esta etapa implementa a interface e a integração com a
API do v86, mas **não inclui os arquivos binários**, nem comprova boot bem-sucedido.
A rede do convidado, instalação com `apk`, persistência automática e compatibilidade
com Safari iPhone ainda precisam de validação. O snapshot é um arquivo local
exportado manualmente; ele não substitui um disco persistente.

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

Static asset headers are defined in `public/_headers`, including `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Cross-origin isolation may be needed for future WASM tools; the current parser is sh-syntax. Other tools do not require cross-origin isolation.

### Security and limitations

- **Executing** means running inside isolated Zsh WebAssembly, **not** your real iPhone terminal or Cloud Shell. It does not run SSH, your system binaries, or arbitrary installed programs. A standalone curl adapter uses browser fetch and is subject to CORS; curl within Zsh pipelines and wget are not implemented. Never treat the result as authoritative execution on Linux.
- The Zsh WASM runtime does not include a complete Linux distribution; individual Unix utilities must be verified before claiming support.
- The current experimental Zsh parser only reports syntax errors. It does not emit semantic ShellCheck findings or automatic fixes.
- One-line conversion uses sh-syntax grammar, not a destructive newline replacement. When complex constructs cannot become a single line, they remain multiline.
- Mankier API requests are sent for command names or complete code only when users open a manual/explanation. Avoid sharing secrets. The server caches responses for a short time.
- Scripts and history remain in local IndexedDB. Safari private browsing or clearing site data may remove them.
- The UI is optimized for desktop and iPhone Safari but requires a modern browser to run WASM.

## License notes

ShellCheck and its WASM artifact are GPL-3.0-or-later. Verify distribution obligations when shipping compiled code. Other package licenses are in each upstream package.

No tests are configured, by request.

## Execution Explorer (em desenvolvimento)

O painel **Explicar comando** agora inclui uma árvore AST interativa baseada no parser `sh-syntax` / `mvdan/sh`. É possível expandir e recolher nós, inspecionar suas descrições e navegar até o intervalo correspondente no editor CodeMirror 6. A interface é responsiva e prioriza o Safari no iPhone.

**Estado atual:** a árvore é uma representação sintática estática, não um trace de execução. O módulo `src/lib/shell-analysis.ts` define os contratos `ShellAnalysis`, `FlowNode`, `FlowEdge` e `ExecutionEvent`; as arestas atuais representam apenas proximidade textual entre irmãos, com semântica `unknown`. Não são executados comandos para construir a árvore.

### Roadmap do Execution Explorer

- [x] Modelo TypeScript para nós, arestas e eventos
- [x] Árvore AST expansível e inspector com navegação no CodeMirror
- [x] Integração com painel de explicações e remoção do navegador duplicado
- [x] Sincronização com a arquitetura compartilhada de parser da main
- [x] Associar tokens semânticos do snapshot aos nós no painel
- [ ] CFG com arestas verificadas para `if/elif/else`, `&&`, `||`, pipelines e loops
- [ ] Timeline de simulação estática com ramificações explícitas
- [ ] Trace real do sandbox WASM, com eventos observados separados de inferências
- [ ] Testes automatizados de AST, navegação, fluxo e mobile
- [ ] Abas Flow / AST / Explain / Output e inspector móvel em drawer

A interface ignora resultados de análise antigos quando o texto muda durante o parsing. As explicações de comandos e operadores são obtidas do mesmo snapshot semântico do editor.

**Segurança:** a análise estática não executa scripts. A execução do terminal permanece isolada no sandbox WebAssembly.
