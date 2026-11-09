# ShellConductor Touch: integração futura com VS Code

A aplicação React já oferece a página vertical **https://shell.migos.club/touch**
(alias: **/extension**) para ser embutida na sidebar de uma extensão.

Esta mudança não publica nem registra uma extensão VS Code. A aplicação de hospedagem
recebe e envia mensagens, e a extensão será responsável por criar/usar um terminal real.

## Comportamento

- Clique em um comando: envia para a extensão se a bridge estiver conectada; caso contrário, copia.
- **Inserir** (padrão): `terminal.sendText(command, false)`, sem Enter.
- **Executar**: `terminal.sendText(command, true)`, com Enter. Há confirmação extra para certos padrões arriscados.
- Comandos criados, favoritos e histórico de toques são armazenados em IndexedDB sob a origem do site.
- A extensão pode mandar até 200 entradas recentes via `host.history` (independentemente do armazenamento local).
- A interface não executa código por `eval`, nem executa comandos diretamente no navegador nesta página.
- O histórico fornecido pela extensão corresponde ao que **a extensão registrar**; ele não acessa automaticamente
  todo o histórico da shell integrada do VS Code.

## Protocolo `window.postMessage` v1

Canal: `shellconductor.touch`, versão numérica: `1`.

1. iframe -> wrapper: `{channel,version:1,type:'child.ready',handshakeId}`
2. wrapper -> iframe: `{channel,version:1,type:'host.ready',handshakeId}`
3. clique -> wrapper: `{channel,version:1,type:'terminal.send',handshakeId,requestId,command,mode:'insert'|'run'}`
4. wrapper -> VS Code extension host -> wrapper -> iframe: `{channel,version:1,type:'host.ack',requestId,ok:true}`
5. opcional: wrapper -> iframe: `{channel,version:1,type:'host.history',history:[{command,title,createdAt}]}`

- Verifique **exatamente** `event.origin === 'https://shell.migos.club'` e
  `event.source === iframe.contentWindow` antes de receber comandos do iframe.
- Responda ao `handshakeId` exato; ignore mensagens de sessões antigas.
- Nunca confie em payloads arbitrários. Limite o comprimento e rejeite controles,
  múltiplas linhas e modos desconhecidos do lado da extensão.
- `host.ack` só deve ser enviado após confirmar que `sendText` foi chamado.
  Não equivale a sucesso de execução do processo.
- A bridge tem timeout de 5s. Se não houver resposta, exibe erro sem alegar envio.

## Exemplo de um wrapper de Webview (para implementar na extensão)

```html
<div id="root" style="height:100vh">
  <iframe id="touch" src="https://shell.migos.club/touch"
    title="ShellConductor Touch" sandbox="allow-scripts allow-forms allow-same-origin"
    style="border:0;width:100%;height:100%"></iframe>
</div>
<script nonce="YOUR_CSP_NONCE">
  const vscode = acquireVsCodeApi();
  const iframe = document.getElementById('touch');
  const origin = 'https://shell.migos.club';
  const channel = 'shellconductor.touch';
  let session = null;

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.channel !== channel || msg.version !== 1) return;

    // Remote iframe -> trusted wrapper.
    if (event.source === iframe.contentWindow) {
      if (event.origin !== origin) return;
      if (msg.type === 'child.ready' && typeof msg.handshakeId === 'string') {
        session = msg.handshakeId;
        iframe.contentWindow.postMessage({
          channel, version: 1, type: 'host.ready', handshakeId: session,
        }, origin);
        vscode.postMessage({channel, version: 1, type: 'host.request-history'});
      } else if (msg.type === 'terminal.send' && msg.handshakeId === session) {
        vscode.postMessage(msg);
      }
      return;
    }

    // Extension host -> wrapper -> remote iframe.
    if (event.source === null || event.source === window) {
      if (msg.type === 'host.ack' || msg.type === 'host.history') {
        iframe.contentWindow.postMessage(msg, origin);
      }
    }
  });
</script>
```

No `webview.html`, defina uma Content Security Policy apropriada, permitindo
`frame-src https://shell.migos.club` e apenas o script local acima com nonce.
Não use `unsafe-eval` ou aceite mensagens de qualquer origem.

## Lado da extensão VS Code

O método do provider deve escutar `webview.onDidReceiveMessage`.
Valide payload e execute aproximadamente assim:

```ts
if (msg.channel === 'shellconductor.touch' && msg.version === 1
    && msg.type === 'terminal.send' && typeof msg.requestId === 'string') {
  const command = msg.command;
  const valid = typeof command === 'string'
    && command.length > 0 && command.length <= 4000
    && !/[\r\n\x00-\x1f]/.test(command)
    && (msg.mode === 'insert' || msg.mode === 'run');
  try {
    if (!valid) throw new Error('Comando inválido');
    const terminal = vscode.window.activeTerminal
      ?? vscode.window.createTerminal('ShellConductor');
    terminal.show(true);
    terminal.sendText(command, msg.mode === 'run');
    await webview.postMessage({
      channel: 'shellconductor.touch', version: 1, type: 'host.ack',
      requestId: msg.requestId, ok: true,
    });
    // Opcional: persistir em context.globalState e enviar host.history.
  } catch (error) {
    await webview.postMessage({
      channel: 'shellconductor.touch', version: 1, type: 'host.ack',
      requestId: msg.requestId, ok: false, error: String(error),
    });
  }
}
```

Esse trecho é um **exemplo de integração**, não código já presente numa extensão.
A extensão decide como escolher o terminal, registrar histórico, restringir comandos
e apresentar confirmações adicionais. Em Codespaces, confirme que a extensão
tem acesso ao terminal remoto apropriado.

## Testar manualmente

1. Abra `/touch` no Safari: o indicador mostrará *Copiar*.
2. Crie um comando personalizado e confira salvos, favoritos e histórico.
3. Envie via clique sem bridge: deve copiar, sem executar.
4. Configure a extensão para fazer handshake.
5. Com a bridge conectada, teste **Inserir**, confirme texto no terminal sem Enter,
   depois **Executar** e confirme o retorno `host.ack`.

As sessões e o IndexedDB do Safari e de uma iframe hospedada no Webview podem ser
separados pelo navegador. Sem sincronização explícita não há garantia de compartilhar
os mesmos comandos salvos entre os dois ambientes.
