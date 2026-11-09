export type ShellCommand = {
  name: string;
  title: string;
  description: string;
  example: string;
  flags?: Array<{ flag: string; description: string; example: string }>;
  group: 'Arquivos' | 'Texto' | 'Sistema' | 'Rede' | 'Shell' | 'Dev';
};

export const COMMANDS: ShellCommand[] = [
  { name: 'ls', title: 'Listar arquivos', description: 'Lista os itens de um diretório.', example: 'ls -lah', group: 'Arquivos', flags: [
    { flag: '-la', description: 'Lista longa, incluindo arquivos ocultos.', example: 'ls -la' },
    { flag: '-h', description: 'Tamanhos legíveis para pessoas.', example: 'ls -lh' }, { flag: '-R', description: 'Percorre subdiretórios.', example: 'ls -R' }] },
  { name: 'cd', title: 'Mudar de diretório', description: 'Altera o diretório atual do shell.', example: 'cd ~/projetos', group: 'Arquivos' },
  { name: 'pwd', title: 'Diretório atual', description: 'Imprime o caminho atual.', example: 'pwd', group: 'Arquivos' },
  { name: 'cat', title: 'Ler arquivos', description: 'Imprime arquivos e concatena conteúdo.', example: 'cat package.json', group: 'Arquivos' },
  { name: 'find', title: 'Localizar arquivos', description: 'Procura arquivos recursivamente.', example: "find . -type f -name '*.ts'", group: 'Arquivos', flags: [
    { flag: '-name', description: 'Filtra pelo nome (glob).', example: "find . -name '*.log'" },
    { flag: '-type', description: 'Filtra por tipo.', example: 'find . -type f' },
    { flag: '-maxdepth', description: 'Limita a profundidade.', example: 'find . -maxdepth 2' }] },
  { name: 'mkdir', title: 'Criar diretórios', description: 'Cria uma pasta, com pais usando -p.', example: 'mkdir -p src/components', group: 'Arquivos' },
  { name: 'touch', title: 'Criar arquivo vazio', description: 'Cria arquivo ou atualiza data de modificação.', example: 'touch arquivo.txt', group: 'Arquivos' },
  { name: 'cp', title: 'Copiar arquivos', description: 'Copia arquivos e diretórios.', example: 'cp -r origem destino', group: 'Arquivos' },
  { name: 'mv', title: 'Mover/renomear', description: 'Move ou renomeia caminhos.', example: 'mv antigo.txt novo.txt', group: 'Arquivos' },
  { name: 'rm', title: 'Apagar arquivos', description: 'Remove arquivos. -r remove diretórios e seu conteúdo.', example: 'rm -i arquivo.txt', group: 'Arquivos' },
  { name: 'chmod', title: 'Permissões', description: 'Altera permissões de um arquivo.', example: 'chmod +x deploy.sh', group: 'Arquivos' },
  { name: 'du', title: 'Espaço usado', description: 'Mostra o consumo de espaço de diretórios.', example: 'du -sh ./*', group: 'Sistema' },
  { name: 'df', title: 'Espaço em discos', description: 'Mostra espaço livre em sistemas de arquivos.', example: 'df -h', group: 'Sistema' },
  { name: 'ps', title: 'Processos', description: 'Mostra processos em execução.', example: 'ps aux', group: 'Sistema' },
  { name: 'kill', title: 'Enviar sinal', description: 'Envia sinais a processos, normalmente TERM.', example: 'kill -TERM 1234', group: 'Sistema' },
  { name: 'env', title: 'Ambiente', description: 'Lista ou modifica variáveis para um comando.', example: 'env | sort', group: 'Sistema' },
  { name: 'date', title: 'Data e hora', description: 'Mostra ou formata data e hora.', example: "date '+%Y-%m-%d'", group: 'Sistema' },
  { name: 'echo', title: 'Imprimir texto', description: 'Escreve argumentos na saída padrão.', example: 'echo "Olá, mundo"', group: 'Shell' },
  { name: 'printf', title: 'Saída formatada', description: 'Imprime texto com placeholders de formato.', example: "printf '%s\\n' 'Olá'", group: 'Shell' },
  { name: 'read', title: 'Ler entrada', description: 'Lê dados para uma variável do shell.', example: 'read -r nome', group: 'Shell' },
  { name: 'export', title: 'Exportar variável', description: 'Disponibiliza variável para processos filhos.', example: 'export NODE_ENV=production', group: 'Shell' },
  { name: 'set', title: 'Opções do shell', description: 'Liga ou desliga opções de execução.', example: 'set -euo pipefail', group: 'Shell' },
  { name: 'source', title: 'Carregar script', description: 'Executa outro script no shell atual.', example: 'source .env', group: 'Shell' },
  { name: 'test', title: 'Testar condição', description: 'Avalia expressões e retorna código de saída.', example: '[ -f arquivo.txt ]', group: 'Shell' },
  { name: 'xargs', title: 'Argumentos por stdin', description: 'Transforma entrada em argumentos para outro comando.', example: 'printf "%s\\n" a b | xargs -n1 echo', group: 'Texto' },
  { name: 'grep', title: 'Filtrar por padrão', description: 'Busca linhas de texto que correspondem a um padrão.', example: "grep -Rni 'TODO' src", group: 'Texto', flags: [
    { flag: '-R', description: 'Busca recursivamente.', example: "grep -R 'TODO' ." },
    { flag: '-n', description: 'Exibe o número da linha.', example: "grep -n 'erro' app.log" },
    { flag: '-i', description: 'Ignora diferenças entre maiúsculas e minúsculas.', example: "grep -i 'erro' app.log" },
    { flag: '-E', description: 'Expressões regulares estendidas.', example: "grep -E '(warn|error)' app.log" }] },
  { name: 'rg', title: 'Ripgrep', description: 'Busca rápida em arquivos, respeitando .gitignore.', example: "rg 'useEffect' src", group: 'Texto' },
  { name: 'sed', title: 'Editar fluxo', description: 'Transforma texto por regras, substituições e intervalos.', example: "sed -E 's/foo/bar/g' arquivo.txt", group: 'Texto', flags: [
    { flag: '-E', description: 'Ativa regex estendida.', example: "sed -E 's/[0-9]+/N/g'" },
    { flag: '-n', description: 'Não imprime automaticamente.', example: "sed -n '1,10p' arquivo.txt" },
    { flag: '-i', description: 'Edita o arquivo no lugar. Cuidado com backup e diferenças BSD/GNU.', example: "sed -i.bak 's/a/b/g' file" }] },
  { name: 'awk', title: 'Processamento por colunas', description: 'Programa orientado a linhas e campos.', example: "awk -F, '{print $1}' dados.csv", group: 'Texto', flags: [
    { flag: '-F', description: 'Define o separador de campos.', example: "awk -F: '{print $1}' /etc/passwd" },
    { flag: '-v', description: 'Passa variável externa.', example: "awk -v min=10 '$1>min' input.txt" }] },
  { name: 'jq', title: 'JSON via terminal', description: 'Seleciona, transforma e formata JSON.', example: "jq -r '.items[].name' dados.json", group: 'Texto', flags: [
    { flag: '-r', description: 'Imprime strings sem aspas JSON.', example: "jq -r '.name' data.json" },
    { flag: '-c', description: 'Saída JSON compacta.', example: "jq -c '.items[]' data.json" },
    { flag: '-s', description: 'Lê múltiplos JSONs em um array.', example: "jq -s '.' *.json" },
    { flag: '-n', description: 'Executa sem entrada.', example: "jq -n '{ok:true}'" }] },
  { name: 'cut', title: 'Selecionar campos', description: 'Extrai colunas ou caracteres.', example: "cut -d: -f1 /etc/passwd", group: 'Texto' },
  { name: 'sort', title: 'Ordenar linhas', description: 'Ordena linhas textual ou numericamente.', example: 'sort -u nomes.txt', group: 'Texto' },
  { name: 'uniq', title: 'Remover adjacentes', description: 'Conta ou elimina linhas adjacentes iguais.', example: 'sort nomes.txt | uniq -c', group: 'Texto' },
  { name: 'tr', title: 'Traduzir caracteres', description: 'Substitui ou elimina caracteres.', example: "tr '[:lower:]' '[:upper:]'", group: 'Texto' },
  { name: 'wc', title: 'Contar', description: 'Conta linhas, palavras ou bytes.', example: 'wc -l arquivo.txt', group: 'Texto' },
  { name: 'head', title: 'Primeiras linhas', description: 'Mostra o início da entrada.', example: 'head -n 20 arquivo.txt', group: 'Texto' },
  { name: 'tail', title: 'Últimas linhas', description: 'Mostra o fim da entrada; -f acompanha atualizações.', example: 'tail -f app.log', group: 'Texto' },
  { name: 'tee', title: 'Duplicar saída', description: 'Escreve em arquivo e também na saída.', example: 'echo ok | tee saida.txt', group: 'Texto' },
  { name: 'curl', title: 'Requisições HTTP', description: 'Transfere dados usando HTTP e outros protocolos.', example: 'curl -fsSL https://example.com', group: 'Rede', flags: [
    { flag: '-X', description: 'Especifica método HTTP.', example: 'curl -X POST https://example.com' },
    { flag: '-H', description: 'Acrescenta cabeçalho.', example: "curl -H 'Accept: application/json' https://example.com" },
    { flag: '-d', description: 'Envia corpo de requisição.', example: "curl -d '{\"ok\":true}' https://example.com" },
    { flag: '-s', description: 'Modo silencioso.', example: 'curl -s https://example.com' },
    { flag: '-f', description: 'Falha em resposta HTTP 4xx/5xx.', example: 'curl -f https://example.com' },
    { flag: '-L', description: 'Segue redirecionamentos.', example: 'curl -L https://example.com' }] },
  { name: 'wget', title: 'Baixar recursos', description: 'Baixa dados e arquivos por HTTP.', example: 'wget https://example.com/file', group: 'Rede' },
  { name: 'ssh', title: 'Conexão remota', description: 'Abre sessão SSH autenticada em outra máquina.', example: 'ssh usuario@servidor', group: 'Rede' },
  { name: 'scp', title: 'Copiar por SSH', description: 'Transfere arquivos via SSH.', example: 'scp arquivo.txt host:/tmp/', group: 'Rede' },
  { name: 'dig', title: 'Consultar DNS', description: 'Pesquisa registros DNS de um domínio.', example: 'dig example.com A', group: 'Rede' },
  { name: 'git', title: 'Controle de versão', description: 'Gerencia versões e branches de código.', example: 'git status --short', group: 'Dev', flags: [
    { flag: 'status', description: 'Mostra mudanças locais.', example: 'git status --short' },
    { flag: 'log', description: 'Exibe histórico.', example: 'git log --oneline -5' },
    { flag: 'diff', description: 'Mostra alterações.', example: 'git diff --stat' },
    { flag: 'switch', description: 'Troca branch.', example: 'git switch main' }] },
  { name: 'npm', title: 'Gerenciador Node', description: 'Instala dependências e executa scripts do projeto.', example: 'npm run build', group: 'Dev' },
  { name: 'npx', title: 'Executar pacote', description: 'Executa CLIs de pacotes npm.', example: 'npx wrangler deploy', group: 'Dev' },
  { name: 'docker', title: 'Containers', description: 'Cria e administra containers.', example: 'docker ps', group: 'Dev' },
  { name: 'tar', title: 'Arquivar e extrair', description: 'Agrupa arquivos em um arquivo tar, com compressão opcional.', example: 'tar -czf backup.tar.gz pasta/', group: 'Arquivos' },
  { name: 'gzip', title: 'Compactar', description: 'Compacta e descompacta arquivos com gzip.', example: 'gzip arquivo.log', group: 'Arquivos' },
];

export const SNIPPETS = [
  { id: 'if', name: 'if / elif / else', subtitle: 'Condições', code: 'if [[ -f "./arquivo.txt" ]]; then\n  echo "Existe"\nelif [[ -d "./pasta" ]]; then\n  echo "É pasta"\nelse\n  echo "Não encontrado"\nfi' },
  { id: 'for', name: 'for ... do', subtitle: 'Loop de itens', code: 'for arquivo in ./*.txt; do\n  [[ -f "$arquivo" ]] || continue\n  printf "%s\\n" "$arquivo"\ndone' },
  { id: 'while', name: 'while ... do', subtitle: 'Loop condicional', code: 'contador=0\nwhile ((contador < 3)); do\n  echo "$contador"\n  ((contador += 1))\ndone' },
  { id: 'case', name: 'case ... esac', subtitle: 'Escolhas múltiplas', code: 'case "$1" in\n  start) echo "Iniciando" ;;\n  stop) echo "Parando" ;;\n  *) echo "Uso: $0 {start|stop}" ;;\nesac' },
  { id: 'function', name: 'function', subtitle: 'Reutilizar comandos', code: 'saudar() {\n  local nome="${1:-mundo}"\n  printf "Olá, %s!\\n" "$nome"\n}\nsaudar "ShellConductor"' },
  { id: 'pipe', name: 'Pipeline', subtitle: 'Compor filtros', code: 'printf "%s\\n" "a" "b" "a" | sort | uniq -c' },
  { id: 'heredoc', name: 'Here document', subtitle: 'Entrada multilinha', code: "cat <<'EOF'\nUma linha\nOutra linha\nEOF" },
  { id: 'jq', name: 'jq JSON', subtitle: 'Processar JSON', code: "printf '%s\\n' '{\"items\":[{\"name\":\"Ana\"},{\"name\":\"Bia\"}]}' | jq -r '.items[].name'" },
  { id: 'awk', name: 'awk', subtitle: 'Processar colunas', code: "printf 'nome,idade\\nAna,25\\nBia,29\\n' | awk -F, 'NR > 1 {print $1}'" },
  { id: 'sed', name: 'sed', subtitle: 'Substituir texto', code: "printf 'foo bar\\n' | sed 's/foo/hello/g'" },
  { id: 'curl', name: 'curl JSON', subtitle: 'API HTTP', code: "curl -fsSL -H 'Accept: application/json' 'https://api.example.com/data' | jq '.'" },
];

export const byName = new Map(COMMANDS.map((command) => [command.name, command]));

export function commandAt(line: string, offset: number): string | null {
  // Split simple pipelines/separators; not a full parser. Syntax-aware editor handles full scripts.
  const prefix = line.slice(0, offset);
  const segment = prefix.split(/(?:\|\||&&|[|;&])/).pop() || '';
  const match = segment.trimStart().match(/^(?:(?:sudo|command|env|time|nohup)\s+)*([\w.+-]+)/);
  return match?.[1] || null;
}
