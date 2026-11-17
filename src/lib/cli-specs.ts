/** Curated CLI metadata until Fig/Carapace specifications are imported. */
export type CliOption = { names: string[]; description: string; takesValue?: boolean; effect?: 'delete' | 'write' | 'network' | 'execute' };
export type CliSpec = {
  name: string;
  description: string;
  options?: CliOption[];
  subcommands?: Record<string, CliSpec>;
  positionals?: string[];
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
      ps: { name: 'ps', description: 'Lista contêineres.', options: [{ names: ['-a', '--all'], description: 'Inclui contêineres parados.' }] },
      rm: { name: 'rm', description: 'Remove contêineres.', positionals: ['Contêiner'], options: [{ names: ['-f', '--force'], description: 'Força a remoção.', effect: 'delete' }] },
    },
  },
  git: {
    name: 'git', description: 'Gerencia versões de um repositório.',
    subcommands: {
      status: { name: 'status', description: 'Exibe o estado da árvore de trabalho.', options: [{ names: ['-s', '--short'], description: 'Formato resumido.' }] },
      checkout: { name: 'checkout', description: 'Alterna referências ou restaura arquivos.', positionals: ['Referência ou caminho'], options: [{ names: ['-b'], description: 'Cria uma branch e muda para ela.', takesValue: true }] },
      switch: { name: 'switch', description: 'Muda a branch ativa.', positionals: ['Branch'], options: [{ names: ['-c', '--create'], description: 'Cria uma nova branch.', takesValue: true }] },
      push: { name: 'push', description: 'Envia commits para um repositório remoto.', positionals: ['Remoto', 'Refspec'], options: [{ names: ['-f', '--force'], description: 'Sobrescreve histórico remoto. Operação potencialmente destrutiva.', effect: 'write' }] },
    },
  },
  curl: {
    name: 'curl', description: 'Transfere dados entre cliente e servidor.',
    positionals: ['URL'],
    options: [
      { names: ['-X', '--request'], description: 'Define o método HTTP.', takesValue: true, effect: 'network' },
      { names: ['-H', '--header'], description: 'Adiciona um cabeçalho HTTP.', takesValue: true },
      { names: ['-d', '--data'], description: 'Envia dados no corpo da requisição.', takesValue: true, effect: 'network' },
      { names: ['-o', '--output'], description: 'Salva a resposta em um arquivo.', takesValue: true, effect: 'write' },
      { names: ['-L', '--location'], description: 'Segue redirecionamentos.' },
      { names: ['-s', '--silent'], description: 'Oculta progresso e mensagens normais.' },
    ],
  },
  npm: {
    name: 'npm', description: 'Gerencia pacotes e scripts Node.js.',
    subcommands: {
      install: { name: 'install', description: 'Instala dependências.', positionals: ['Pacote'], options: [{ names: ['-D', '--save-dev'], description: 'Adiciona dependência de desenvolvimento.' }] },
      run: { name: 'run', description: 'Executa um script definido em package.json.', positionals: ['Nome do script'] },
    },
  },
};
