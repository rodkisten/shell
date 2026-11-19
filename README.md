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

### Protótipo Go → WebAssembly (experimental)

O diretório `tools/shell-flow/` contém um módulo Go separado que usa `mvdan.cc/sh/v3/syntax` e exporta `shellFlowAnalyze(source)` via `syscall/js`. A função retorna JSON com instruções de nível superior, intervalos em bytes UTF-8 e arestas de sequência textual. **Ainda não implementa CFG semântico**, `if/else`, loops, `&&`, `||`, nem trace de execução.

Para compilar, instale Go compatível, execute `cd tools/shell-flow && go mod tidy` e depois `bash scripts/build-shell-flow-wasm.sh`. O build grava `public/wasm/shell-flow.wasm` e `public/wasm/wasm_exec.js`, ignorados pelo Git. O cliente `src/lib/shell-flow-wasm.ts` carrega os artefatos sob demanda via `analyzeShellWasm(source)`. O protótipo **não é carregado pelo editor por padrão**, para não aumentar o custo inicial no iPhone.

A versão inicial usa **modo Bash**, não Zsh. Não use seus resultados como confirmação de compatibilidade Zsh. Os offsets retornados pelo Go são bytes UTF-8 e devem ser convertidos antes de selecionar intervalos no CodeMirror 6.

- [x] Criar módulo Go/WASM e contrato JSON
- [x] Criar script de compilação e loader sob demanda
- [ ] Confirmar compilação Go, validação TypeScript e testes no CI (workflow WASM criado, execução ainda não verificada)
- [ ] Construir CFG completo a partir da AST Go (arestas conservadoras de `&&`, `||` e pipelines já implementadas)
- [ ] Adicionar worker, limites de tamanho e cancelamento
- [ ] Integrar visualização React Flow/ELK após validar a semântica

O workflow `.github/workflows/shell-flow-wasm.yml` compila o módulo em PRs que alterem o analisador e publica o artefato temporário. A lógica inicial reconhece `&&`, `||` e pipelines no nível de `BinaryCmd`, mas ainda não modela todas as saídas de comandos compostos, condições e loops. Não confundir esse grafo conservador com um CFG completo.

**Atualização do protótipo:** o visitante Go agora percorre listas de instruções e reconhece ramos `if/else` básicos, além de `&&`, `||` e pipelines. `elif`, comandos compostos e semântica completa de saída ainda precisam de testes e refinamento. A verificação dos quatro bytes mágicos do WASM no CI foi corrigida. A compilação local não pôde ser concluída porque o proxy de módulos Go estava inacessível neste ambiente.

**Validação WASM:** `scripts/test-shell-flow-wasm.mjs` instancia o módulo compilado no Node 22 e verifica caminhos sequenciais, `&&`, `||`, pipelines, `if/else`, `elif` e erros de sintaxe. O workflow roda esses smoke tests após a compilação. O visitante condicional recursivo foi corrigido para evitar referência a uma função inexistente. Os testes foram adicionados, mas o resultado do CI ainda não foi confirmado.

### Continuação: PR #11, robustez do Shell Flow WASM

- [x] Testar integridade referencial de arestas (nenhuma conexão para nós inexistentes).
- [x] Testar limites e ordenação dos offsets UTF-8 retornados pelo Go.
- [x] Aguardar registro assíncrono de `shellFlowAnalyze` no smoke test e no loader web.
- [x] Tratar rejeição da execução Go/WASM no loader sem bloquear a inicialização.
- [ ] Confirmar build Go e smoke tests aprovados no GitHub Actions.
- [ ] Migrar execução WASM para Web Worker, evitando bloqueio da thread principal no Safari.

A validação do PR #11 foi **implementada, não confirmada como aprovada**. O runtime ainda é carregado na thread principal e não oferece cancelamento.

### Execution Explorer: integração com Web Worker (PR #11)

- [x] Mover a instanciação e a análise Go WASM para `public/wasm/flow-worker.js` (worker clássico compatível com `wasm_exec.js`).
- [x] RPC assíncrono com IDs por requisição, estados `idle/loading/ready/error`, propagação de erros e recuperação em novas tentativas.
- [x] Mostrar status persistente `CFG WASM` no cabeçalho e status detalhado no Execution Explorer.
- [x] Conectar o resultado de análise ao Explorer, com lista navegável de nós e arestas condicionais e conversão de offsets UTF-8 para UTF-16 do CodeMirror 6.
- [x] Ignorar resultados atrasados quando o conteúdo do editor muda.
- [ ] Garantir que o artefato `public/wasm/shell-flow.wasm` e `wasm_exec.js` sejam compilados/publicados na pipeline de deploy. Atualmente estão no `.gitignore`; sem eles o indicador mostra falha e o AST existente continua funcionando.
- [ ] Executar e aprovar testes Go/WASM, build TypeScript e teste real no Safari iPhone.
- [ ] Implementar visualização React Flow + ELK, cancelamento/restart de worker e limites de memória.

O CFG ainda é uma aproximação estática Bash. O novo painel exibe nós e arestas textualmente, **não** é ainda um diagrama React Flow. Os WASMs existentes de Zsh/ShellCheck têm carregamento próprio e não são representados por esse indicador.

### Pipeline de validação e publicação do CFG WASM

O workflow `.github/workflows/shell-flow-wasm.yml` compila o Go/WASM, executa os smoke tests, instala dependências com `npm ci`, executa `npm run build` e verifica a presença de `dist/wasm/shell-flow.wasm`, `dist/wasm/wasm_exec.js` e `dist/wasm/flow-worker.js`. Publica os artefatos `shell-flow-wasm` e `shell-flow-preview-dist` para inspeção.

**Importante:** o workflow agora prepara um `dist/` verificável, mas não implanta automaticamente em produção. Qualquer pipeline externa de Cloudflare que rode `npm run build` sem executar antes `bash scripts/build-shell-flow-wasm.sh` ainda produzirá um site sem os binários. O próximo passo é integrar essa etapa ao deploy existente, evitando compilações duplicadas. Testes e checks continuam aguardando confirmação no GitHub Actions.

### Build e deploy automáticos do Shell Flow WASM (PR #11)

- [x] Adicionar `prebuild` ao `package.json`: `npm run build` agora executa `bash scripts/build-shell-flow-wasm.sh` automaticamente antes de TypeScript/Vite.
- [x] Como `npm run deploy` chama `npm run build`, o deploy Wrangler também compila os binários Go e os inclui no `dist/wasm/`.
- [x] Evitar compilação duplicada no CI de validação: o workflow compila uma vez para smoke tests e depois executa `npm run ast:inspect && npm run typecheck && npx vite build`.
- [ ] Garantir Go disponível no ambiente de build Cloudflare (ou publicar artefato previamente compilado): sem Go e acesso ao módulo `mvdan.cc/sh/v3`, o `prebuild` falha de forma explícita.
- [ ] Validar o build do preview, o workflow e a disponibilidade real de `/wasm/shell-flow.wasm`, `/wasm/wasm_exec.js` e `/wasm/flow-worker.js` no domínio.

**Atenção:** `prebuild` requer Go instalado no ambiente de build. Não há fallback silencioso para artefatos antigos. O indicador da UI só mostra pronto após o runtime efetivamente inicializar no Web Worker.

### CI real: diagnóstico do PR #11

- [x] GitHub Actions run `44544714725`: Go dependencies, `go mod verify`, build WASM, magic header e smoke tests passaram.
- [x] Identificar falha de `npm ci`: o repositório não possui `package-lock.json` versionado; erro `EUSAGE` confirmado nos logs.
- [x] Corrigir a instalação no workflow: usar `npm ci` quando existir lockfile; caso contrário, `npm install --no-package-lock --no-audit --no-fund`.
- [ ] Validar o workflow atualizado e a compilação Vite/TypeScript na nova execução.
- [ ] Planejar lockfile reproduzível e revisão das dependências em PR separado.

### Sincronização automática de package-lock.json

O workflow `.github/workflows/sync-lockfile.yml` é acionado quando `package.json` muda em **qualquer branch** (`push`), em PRs internos (`pull_request`) e manualmente (`workflow_dispatch`). Usa Node 24 e `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`, verifica as dependências do manifesto e escreve `package-lock.json` na **branch de origem** por GitHub API, autenticado pela action compartilhada `rodkisten/github/actions/app-token@main` e secrets `BOT_APP_ID`/`BOT_PRIVATE_KEY`.

- [x] Cobrir `main`, branches e PRs internos; PRs de forks não recebem segredos.
- [x] Evitar commits vazios e loops (gatilho apenas em `package.json`, commit com `[skip ci]`).
- [x] Utilizar a action compartilhada de autenticação do bot.
- [ ] Confirmar os secrets no repositório chamador e validar a primeira execução.
- [ ] Depois que o lockfile for versionado, tornar `npm ci` obrigatório nos builds e eliminar fallback sem lockfile.

A action compartilhada está referenciada em `@main` para usar a versão atual; piná-la em uma tag/SHA estável quando a release estiver disponível.

### Bootstrap do lockfile (follow-up)

- [x] Manter o CI de Go/WASM funcional enquanto o repositório ainda não possui `package-lock.json` versionado, com aviso explícito e fallback temporário.
- [x] Remover o path duplicado do workflow Go/WASM.
- [ ] Executar manualmente **🔒 Sync npm lockfile** na branch `main` para gerar o primeiro lockfile usando a Rod GitHub App.
- [ ] Confirmar que os secrets `BOT_APP_ID` e `BOT_PRIVATE_KEY` estão disponíveis no repositório `rodkisten/shell` (ou como secrets de organização).
- [ ] Após a geração, trocar o fallback por `npm ci` obrigatório em todas as pipelines.

Não confundir `npm install --no-package-lock` (fallback temporário do CI) com a geração oficial `npm install --package-lock-only` do workflow de sincronização.

### Correção do deploy WASM: run 44555230627

O build de produção falhou em `main.go:11:2` com `missing go.sum entry for module providing package mvdan.cc/sh/v3/syntax`. A causa imediata é a ausência de `tools/shell-flow/go.sum` no repositório. O script `scripts/build-shell-flow-wasm.sh` agora executa `go mod tidy && go mod verify` antes de `go build`, inclusive quando chamado pelo `npm run build` no deploy.

- [x] Diagnosticar a falha pelo log real do GitHub Actions.
- [x] Adicionar resolução de módulos no script compartilhado de build.
- [ ] Gerar e versionar `tools/shell-flow/go.sum` para build totalmente reproduzível, então validar com `go mod verify`.
- [ ] Confirmar a execução da pipeline de deploy após o merge deste PR.

### Ajuste aplicado diretamente na main

- [x] Confirmar que a `main` já continha o trabalho do PR #13 antes de editar.
- [x] Substituir `go mod download` por `go mod tidy && go mod verify` no build Go/WASM, porque `download` isolado pode não gerar o checksum completo do pacote importado.
- [ ] Versionar `tools/shell-flow/go.sum` a partir de um ambiente com acesso ao proxy Go e executar CI/deploy novamente.
