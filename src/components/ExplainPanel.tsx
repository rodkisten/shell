import { useEffect, useRef, useState } from 'react';
import { BookOpen, Copy, ExternalLink, FileCode2, X } from 'lucide-react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { shell } from '@codincod/codemirror-lang-shell';
import { embeddedShellHighlight } from '../lib/highlight';
import { byName } from '../lib/commands';

export type ExplainTarget = { code: string; scope: 'selection' | 'line' | 'script'; line: number };
type Props = { target: ExplainTarget; onClose(): void };

function getCommands(code: string) {
  const names = [...code.matchAll(/(?:^|[|;&\n]\s*)(?:sudo\s+)?([\w.+-]+)/g)]
    .map(match => match[1]);
  return [...new Set(names)].map(name => ({ name, info: byName.get(name) }));
}

export function ExplainPanel({ target, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const commands = getCommands(target.code);
  const mankier = 'https://www.mankier.com/explain?command=' + encodeURIComponent(target.code);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: target.code,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          oneDark,
          shell(),
          embeddedShellHighlight,
          lineNumbers(),
          EditorView.lineWrapping,
          EditorView.theme({
            '&': { background: '#0b101b', fontSize: '12px' },
            '.cm-scroller': { fontFamily: "'SFMono-Regular', Menlo, Consolas, monospace" },
            '.cm-gutters': { background: '#0b101b', border: 'none' },
            '.cm-content': { padding: '12px 4px' },
          }, { dark: true }),
        ],
      }),
    });
    return () => view.destroy();
  }, [target.code]);

  return <section className="explain-inspector" aria-label="Explicação do código">
    <header className="explain-inspector-head">
      <div><span className="explain-inspector-eyebrow"><BookOpen size={13}/> EXPLORADOR DE COMANDOS</span>
        <h3>Entenda este {target.scope === 'selection' ? 'trecho' : target.scope === 'line' ? 'comando' : 'script'}</h3>
        <p>{target.scope === 'line' ? 'Linha ' + target.line : target.scope === 'selection' ? 'Seleção a partir da linha ' + target.line : 'Código completo'} · Zsh</p>
      </div>
      <button type="button" className="explain-icon-button" onClick={onClose} aria-label="Fechar explicação"><X size={18}/></button>
    </header>
    <div className="explain-inspector-codehead"><span><FileCode2 size={14}/> script.zsh</span>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(target.code).then(() => { setCopied(true); }).catch(() => setCopied(false)); }}><Copy size={13}/> {copied ? 'Copiado' : 'Copiar'}</button>
    </div>
    <div ref={host} className="explain-inspector-code" />
    <div className="explain-inspector-content">
      <div className="explain-inspector-sectionhead"><h4>Comandos identificados</h4><span>{commands.length}</span></div>
      {commands.length ? <div className="explain-command-grid">{commands.map(({ name, info }) =>
        <article key={name} className="explain-command-card">
          <div className="explain-command-title"><code>{name}</code><span>{info?.group || 'Shell'}</span></div>
          <strong>{info?.title || 'Comando sem referência local'}</strong>
          <p>{info?.description || 'Abra o ManKier para consultar a documentação e os argumentos.'}</p>
          {info?.flags?.length ? <div className="explain-flags">{info.flags.map(flag => <div key={flag.flag}><code>{flag.flag}</code><span>{flag.description}</span></div>)}</div> : null}
          {info?.example && <div className="explain-example"><span>EXEMPLO</span><code>{info.example}</code></div>}
        </article>,
      )}</div> : <p className="explain-inspector-muted">Nenhum comando conhecido foi identificado neste trecho. Consulte a explicação completa no ManKier.</p>}
      <a className="explain-mankier-link" href={mankier} target="_blank" rel="noopener noreferrer"><BookOpen size={16}/><span><strong>Explicação completa no ManKier</strong><small>Detalhamento dos argumentos e opções na documentação externa</small></span><ExternalLink size={16}/></a>
      <p className="explain-inspector-muted">As descrições acima vêm da biblioteca local do ShellConductor. O ManKier abre em outra aba; revise o código antes de enviá-lo, especialmente se contiver segredos.</p>
    </div>
  </section>;
}
