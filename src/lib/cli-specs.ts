/** Curated CLI metadata until Fig/Carapace specifications are imported. */
export type CliValueSource = 'npm-script' | 'npm-workspace' | 'git-branch';
export type CliValueSpec = {
  name: string;
  values?: string[];
  valueSource?: CliValueSource;
};
export type CliOption = {
  names: string[];
  description: string;
  takesValue?: boolean;
  values?: string[];
  valueSource?: CliValueSource;
  effect?: 'delete' | 'write' | 'network' | 'execute';
};
export type CliSpec = {
  name: string;
  description: string;
  options?: CliOption[];
  subcommands?: Record<string, CliSpec>;
  positionals?: Array<string | CliValueSpec>;
};

export const cliSpecs: Record<string, CliSpec> = {
  docker: {
    name: 'docker', description: 'Gerencia imagens e contêineres.',
    subcommands: {
      run: {
        name: 'run', description: 'Cria e inicia um contêiner a partir de uma imagem.',
        positionals: ['Imagem', 'Comando e argumentos opcionais'],
        options: [
          { names: ['--rm'], description: 'Remove o contêiner após sua saída.' },
          { names: ['-p', '--publish'], description: 'Publica uma porta do contêiner no host.', takesValue: true, effect: 'network' },
          { names: ['-v', '--volume'], description: 'Monta volume ou diretório do host.', takesValue: true, effect: 'write' },
          { names: ['-e', '--env'], description: 'Define variável de ambiente.', takesValue: true },
          { names: ['-d', '--detach'], description: 'Executa em segundo plano.' },
          { names: ['--name'], description: 'Define nome do contêiner.', takesValue: true },
        ],
      },
      build: { name: 'build', description: 'Constrói uma imagem a partir de um Dockerfile.', positionals: ['Contexto'], options: [
        { names: ['-t', '--tag'], description: 'Nome e tag da imagem.', takesValue: true },
        { names: ['-f', '--file'], description: 'Caminho do Dockerfile.', takesValue: true },
        { names: ['--no-cache'], description: 'Ignora cache de camadas.' },
        { names: ['--pull'], description: 'Sempre tenta baixar imagens-base mais novas.', effect: 'network' },
      ] },
      exec: { name: 'exec', description: 'Executa um comando em um contêiner em execução.', positionals: ['Contêiner', 'Comando'], options: [
        { names: ['-i', '--interactive'], description: 'Mantém STDIN aberto.' },
        { names: ['-t', '--tty'], description: 'Aloca um pseudo-TTY.' },
        { names: ['-e', '--env'], description: 'Define variável de ambiente.', takesValue: true },
        { names: ['-w', '--workdir'], description: 'Diretório de trabalho.', takesValue: true },
      ] },
      logs: { name: 'logs', description: 'Exibe logs de um contêiner.', positionals: ['Contêiner'], options: [
        { names: ['-f', '--follow'], description: 'Segue novas linhas de log.' },
        { names: ['--tail'], description: 'Número de linhas finais.', takesValue: true },
        { names: ['-t', '--timestamps'], description: 'Exibe timestamps.' },
      ] },
      ps: { name: 'ps', description: 'Lista contêineres.', options: [{ names: ['-a', '--all'], description: 'Inclui contêineres parados.' }] },
      rm: { name: 'rm', description: 'Remove contêineres.', positionals: ['Contêiner'], options: [{ names: ['-f', '--force'], description: 'Força a remoção.', effect: 'delete' }] },
      compose: {
        name: 'compose', description: 'Gerencia aplicações Docker Compose.',
        subcommands: {
          up: { name: 'up', description: 'Cria e inicia os serviços.', options: [
            { names: ['-d', '--detach'], description: 'Executa em segundo plano.' },
            { names: ['--build'], description: 'Constrói imagens antes de iniciar.' },
            { names: ['--force-recreate'], description: 'Recria os contêineres mesmo sem mudanças.', effect: 'write' },
          ] },
          down: { name: 'down', description: 'Para e remove recursos do Compose.', options: [
            { names: ['-v', '--volumes'], description: 'Remove volumes nomeados.', effect: 'delete' },
            { names: ['--remove-orphans'], description: 'Remove contêineres órfãos.', effect: 'delete' },
          ] },
          logs: { name: 'logs', description: 'Exibe logs dos serviços.', options: [{ names: ['-f', '--follow'], description: 'Segue os logs.' }] },
          ps: { name: 'ps', description: 'Lista serviços e contêineres do projeto.' },
        },
      },
    },
  },
  git: {
    name: 'git', description: 'Gerencia versões de um repositório.',
    subcommands: {
      status: { name: 'status', description: 'Exibe o estado da árvore de trabalho.', options: [{ names: ['-s', '--short'], description: 'Formato resumido.' }] },
      add: { name: 'add', description: 'Adiciona mudanças ao índice.', positionals: ['Caminho'], options: [
        { names: ['-A', '--all'], description: 'Adiciona todas as mudanças.' },
        { names: ['-p', '--patch'], description: 'Seleciona mudanças interativamente.' },
      ] },
      commit: { name: 'commit', description: 'Cria um commit com o conteúdo do índice.', options: [
        { names: ['-m', '--message'], description: 'Mensagem do commit.', takesValue: true },
        { names: ['-a', '--all'], description: 'Inclui automaticamente arquivos rastreados modificados.' },
        { names: ['--amend'], description: 'Substitui o commit anterior.', effect: 'write' },
      ] },
      branch: { name: 'branch', description: 'Lista, cria ou remove branches.', positionals: ['Branch'], options: [
        { names: ['-d', '--delete'], description: 'Remove uma branch já integrada.', takesValue: true, effect: 'delete' },
        { names: ['-D'], description: 'Força a remoção de uma branch.', takesValue: true, effect: 'delete' },
        { names: ['-a', '--all'], description: 'Lista branches locais e remotas.' },
      ] },
      checkout: { name: 'checkout', description: 'Alterna referências ou restaura arquivos.', positionals: [{ name: 'Referência ou caminho', valueSource: 'git-branch' }], options: [{ names: ['-b'], description: 'Cria uma branch e muda para ela.', takesValue: true }] },
      switch: { name: 'switch', description: 'Muda a branch ativa.', positionals: [{ name: 'Branch', valueSource: 'git-branch' }], options: [{ names: ['-c', '--create'], description: 'Cria uma nova branch.', takesValue: true }] },
      restore: { name: 'restore', description: 'Restaura arquivos da árvore de trabalho.', positionals: ['Caminho'], options: [
        { names: ['--staged'], description: 'Restaura o índice.' },
        { names: ['-s', '--source'], description: 'Usa uma árvore como origem.', takesValue: true },
      ] },
      log: { name: 'log', description: 'Exibe o histórico de commits.', options: [
        { names: ['--oneline'], description: 'Uma linha por commit.' },
        { names: ['-n'], description: 'Limita o número de commits.', takesValue: true },
        { names: ['--graph'], description: 'Desenha o grafo textual de branches.' },
      ] },
      diff: { name: 'diff', description: 'Exibe diferenças entre estados do repositório.', options: [
        { names: ['--stat'], description: 'Resumo estatístico das mudanças.' },
        { names: ['--staged', '--cached'], description: 'Compara o índice com HEAD.' },
      ] },
      pull: { name: 'pull', description: 'Busca e integra mudanças do remoto.', positionals: ['Remoto', 'Branch'], options: [
        { names: ['--rebase'], description: 'Reaplica commits locais sobre o remoto.' },
        { names: ['--ff-only'], description: 'Aceita apenas fast-forward.' },
      ] },
      fetch: { name: 'fetch', description: 'Busca referências de um remoto.', positionals: ['Remoto'], options: [
        { names: ['--all'], description: 'Busca todos os remotos.' },
        { names: ['--prune'], description: 'Remove referências remotas obsoletas.' },
      ] },
      merge: { name: 'merge', description: 'Integra outra linha de desenvolvimento.', positionals: [{ name: 'Commit ou branch', valueSource: 'git-branch' }], options: [
        { names: ['--no-ff'], description: 'Cria commit de merge mesmo quando fast-forward seria possível.' },
        { names: ['--abort'], description: 'Aborta um merge em andamento.' },
      ] },
      rebase: { name: 'rebase', description: 'Reaplica commits sobre uma nova base.', positionals: [{ name: 'Base', valueSource: 'git-branch' }], options: [
        { names: ['-i', '--interactive'], description: 'Rebase interativo.' },
        { names: ['--continue'], description: 'Continua após resolver conflitos.' },
        { names: ['--abort'], description: 'Aborta o rebase.' },
      ] },
      push: { name: 'push', description: 'Envia commits para um repositório remoto.', positionals: ['Remoto', { name: 'Refspec', valueSource: 'git-branch' }], options: [
        { names: ['-f', '--force'], description: 'Sobrescreve histórico remoto. Operação potencialmente destrutiva.', effect: 'write' },
        { names: ['--force-with-lease'], description: 'Força com proteção contra alterações remotas inesperadas.', effect: 'write' },
        { names: ['-u', '--set-upstream'], description: 'Define upstream para a branch.', takesValue: true },
      ] },
    },
  },
  curl: {
    name: 'curl', description: 'Transfere dados entre cliente e servidor.',
    positionals: ['URL'],
    options: [
      { names: ['-X', '--request'], description: 'Define o método HTTP.', takesValue: true, values: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], effect: 'network' },
      { names: ['-H', '--header'], description: 'Adiciona um cabeçalho HTTP.', takesValue: true },
      { names: ['-d', '--data'], description: 'Envia dados no corpo da requisição.', takesValue: true, effect: 'network' },
      { names: ['-o', '--output'], description: 'Salva a resposta em um arquivo.', takesValue: true, effect: 'write' },
      { names: ['-L', '--location'], description: 'Segue redirecionamentos.' },
      { names: ['-s', '--silent'], description: 'Oculta progresso e mensagens normais.' },
    ],
  },
  npm: {
    name: 'npm', description: 'Gerencia pacotes e scripts Node.js.',
    options: [
      { names: ['-w', '--workspace'], description: 'Executa no workspace informado.', takesValue: true, valueSource: 'npm-workspace' },
      { names: ['--workspaces'], description: 'Executa em todos os workspaces.' },
    ],
    subcommands: {
      install: { name: 'install', description: 'Instala dependências.', positionals: ['Pacote'], options: [
        { names: ['-D', '--save-dev'], description: 'Adiciona dependência de desenvolvimento.' },
        { names: ['-E', '--save-exact'], description: 'Salva versão exata.' },
        { names: ['--no-save'], description: 'Não altera package.json.' },
      ] },
      ci: { name: 'ci', description: 'Instala exatamente a partir do lockfile.', options: [
        { names: ['--ignore-scripts'], description: 'Não executa scripts de lifecycle.' },
        { names: ['--omit'], description: 'Omite tipos de dependência.', takesValue: true, values: ['dev', 'optional', 'peer'] },
      ] },
      run: { name: 'run', description: 'Executa um script definido em package.json.', positionals: [{ name: 'Nome do script', valueSource: 'npm-script' }], options: [
        { names: ['--workspace'], description: 'Executa em um workspace.', takesValue: true, valueSource: 'npm-workspace' },
        { names: ['--workspaces'], description: 'Executa em todos os workspaces.' },
      ] },
      exec: { name: 'exec', description: 'Executa um comando de um pacote.', positionals: ['Comando'], options: [
        { names: ['--package'], description: 'Pacote a disponibilizar.', takesValue: true },
        { names: ['-c', '--call'], description: 'Comando a executar.', takesValue: true },
      ] },
      test: { name: 'test', description: 'Executa o script test do projeto.' },
      start: { name: 'start', description: 'Executa o script start do projeto.' },
      uninstall: { name: 'uninstall', description: 'Remove dependências.', positionals: ['Pacote'], options: [
        { names: ['-D', '--save-dev'], description: 'Remove de devDependencies.' },
      ] },
      update: { name: 'update', description: 'Atualiza dependências respeitando os intervalos permitidos.', positionals: ['Pacote'] },
    },
  },
};
