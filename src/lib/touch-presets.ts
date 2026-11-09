import { COMMANDS } from './commands';

export type TouchCommand = {
  id: string; title: string; command: string; description: string;
  category: string; custom?: boolean; createdAt?: number; updatedAt?: number;
};

type Preset = [string, string, string, string, string];
const curated: Preset[] = [
  ['status','Status Git','git status --short --branch','Mudanças locais e branch atual.','Git'],
  ['log','Últimos commits','git log --oneline --decorate -10','Histórico resumido do Git.','Git'],
  ['diff','Alterações','git diff --stat','Arquivos alterados desde o último commit.','Git'],
  ['pull','Atualizar branch','git pull --ff-only','Atualiza sem criar merge commit.','Git'],
  ['fetch','Sincronizar remotas','git fetch --all --prune','Atualiza referências remotas.','Git'],
  ['branches','Listar branches','git branch -a','Branches locais e remotas.','Git'],
  ['stash','Guardar alterações','git stash push -m "backup temporário"','Guarda alterações não commitadas.','Git'],
  ['stash-list','Ver stashes','git stash list','Lista as alterações guardadas.','Git'],
  ['ls','Listar arquivos','ls -lah','Arquivos ocultos, permissões e tamanhos.','Arquivos'],
  ['pwd','Diretório atual','pwd','Exibe o diretório de trabalho.','Arquivos'],
  ['find-ts','Buscar arquivos TS',"find . -type f -name '*.ts' | head -50",'Encontra os primeiros arquivos TypeScript.','Arquivos'],
  ['du','Tamanho das pastas','du -sh ./*','Lista o uso de espaço.','Arquivos'],
  ['df','Espaço livre','df -h','Mostra o espaço em disco.','Sistema'],
  ['ps','Processos ativos','ps aux | head -25','Mostra processos em execução.','Sistema'],
  ['date','Data ISO',"date '+%Y-%m-%dT%H:%M:%S%z'",'Data e hora formatadas.','Sistema'],
  ['todo','Localizar TODOs',"rg -n 'TODO|FIXME' .",'Localiza tarefas pendentes.','Texto'],
  ['grep','Filtrar erros',"grep -iE 'error|warn|failed' app.log | tail -30",'Encontra mensagens relevantes no log.','Texto'],
  ['jq','Formatar JSON',"jq '.' package.json",'Exibe JSON formatado.','Texto'],
  ['jq-name','Extrair campo JSON',"jq -r '.name' package.json",'Extrai uma propriedade com jq.','Texto'],
  ['awk','Primeira coluna',"printf 'a,b\\nc,d\\n' | awk -F, '{ print $1 }'",'Exemplo de processamento de colunas.','Texto'],
  ['sed','Substituir texto',"printf '%s\\n' 'foo bar' | sed 's/foo/novo/g'",'Exemplo de substituição com sed.','Texto'],
  ['http','Cabeçalhos HTTP','curl -sSI https://example.com','Consulta apenas os cabeçalhos.','Rede'],
  ['dns','DNS','dig +short example.com','Resolve o domínio informado.','Rede'],
  ['ports','Portas TCP','ss -ltn','Lista portas em escuta (Linux).','Rede'],
  ['npm-install','Instalar dependências','npm install','Instala as dependências do projeto.','Node'],
  ['npm-ci','Instalação de CI','npm ci','Instala conforme o lockfile.','Node'],
  ['npm-build','Build','npm run build','Executa o build do projeto.','Node'],
  ['npm-lint','Lint','npm run lint','Executa o linter configurado.','Node'],
  ['npm-scripts','Scripts npm','npm run','Lista scripts de package.json.','Node'],
  ['node','Versões Node/npm','node -v && npm -v','Consulta as versões instaladas.','Node'],
  ['docker-ps','Containers','docker ps','Lista containers ativos.','Docker'],
  ['docker-images','Imagens','docker images','Lista as imagens Docker.','Docker'],
  ['docker-size','Espaço Docker','docker system df','Relatório de espaço do Docker.','Docker'],
  ['docker-compose','Serviços Compose','docker compose ps','Lista os serviços em execução.','Docker'],
  ['cf-whoami','Conta Cloudflare','npx wrangler whoami','Mostra qual conta está autenticada.','Cloudflare'],
  ['cf-dev','Worker local','npx wrangler dev','Inicia o desenvolvimento local.','Cloudflare'],
  ['cf-tail','Logs Cloudflare','npx wrangler tail','Acompanha logs de um Worker.','Cloudflare'],
  ['cf-deploy','Publicar Worker','npx wrangler deploy','Publica um Worker na Cloudflare.','Cloudflare'],
  ['if','If em uma linha','if [[ -f package.json ]]; then echo "Node"; else echo "Outro projeto"; fi','Exemplo de condição Bash.','Shell'],
  ['for','For em uma linha','for f in ./*.sh; do [[ -f "$f" ]] && echo "$f"; done','Exemplo de loop Bash.','Shell'],
  ['while','While em uma linha','n=0; while (( n < 3 )); do echo "$n"; (( n+=1 )); done','Exemplo de repetição Bash.','Shell'],
];
export const TOUCH_PRESETS: TouchCommand[] = [
  ...curated.map(([id,title,command,description,category])=>({id:'preset:'+id,title,command,description,category})),
  ...COMMANDS.filter(item=>!curated.some(p=>p[2]===item.example)).map(item=>({
    id:'reference:'+item.name,title:item.title,command:item.example,
    description:item.description,category:item.group,
  })),
];
export const DEFAULT_PINNED = ['preset:status','preset:ls','preset:log','preset:npm-build','preset:jq','preset:cf-tail'];
export const TOUCH_CATEGORIES = ['Git','Arquivos','Texto','Node','Docker','Cloudflare','Rede','Sistema','Shell','Dev'];
export const isOneLine = (command:string) =>
  command.length > 0 && command.length <= 4000 &&
  !Array.from(command).some(char => { const code = char.charCodeAt(0); return code < 32 && code !== 9; });
export const needsConfirmation = (command:string) =>
  /\b(?:sudo|mkfs|shutdown|reboot|poweroff|wrangler\s+deploy|git\s+(?:reset\s+--hard|push\s+--force|clean\s+-[a-z]*f)|rm\s+-[a-z]*[rf])\b/i.test(command)
  || /(?:curl|wget)[^\n]*\|\s*(?:ba)?sh\b/i.test(command);
