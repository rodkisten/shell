import { useEffect, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, CircleAlert, CornerDownRight, Info } from 'lucide-react';
import type { CommandHelpModel } from '../lib/command-help';

function effectLabel(effect: string | undefined) {
  if (effect === 'delete') return 'pode remover dados';
  if (effect === 'write') return 'altera estado';
  if (effect === 'network') return 'usa rede';
  if (effect === 'execute') return 'executa';
  return '';
}

export function CommandHelp({ help, onManual }: {
  help: CommandHelpModel | null;
  onManual(command: string): void;
}) {
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('shellconductor:quick-help-collapsed') === 'true'
  );

  useEffect(() => {
    localStorage.setItem('shellconductor:quick-help-collapsed', String(collapsed));
  }, [collapsed]);

  if (!help) {
    return <section className="command-help command-help-empty" aria-live="polite">
      <Info size={14}/><span>Posicione o cursor em um comando para ver assinatura, argumentos e opções.</span>
    </section>;
  }

  const risk = effectLabel(help.current?.effect);

  return <section className="command-help" aria-label="Ajuda do comando atual" aria-live="polite">
    <div className="command-help-head">
      <button className="command-help-collapse" type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed}>
        <span className="command-help-icon"><CornerDownRight size={14}/></span>
        <span className="command-help-heading">
          <span className="command-help-eyebrow">AJUDA DO COMANDO</span>
          <strong>{help.title}</strong>
        </span>
        {collapsed ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}
      </button>
      <button className="command-help-manual" type="button" onClick={() => onManual(help.executable)}>
        <BookOpen size={14}/> Manual
      </button>
    </div>

    {!collapsed && <div className="command-help-body">
      <p className="command-help-description">{help.description}</p>

      <div className="command-help-signature">
        <span>assinatura</span>
        <code>{help.signature}</code>
      </div>

      {help.current && <div className="command-help-current">
        <div>
          <span>AGORA</span>
          <code>{help.current.label}</code>
        </div>
        <p>{help.current.description}</p>
        {risk && <small className="command-help-risk"><CircleAlert size={12}/>{risk}</small>}
      </div>}

      {!!help.subcommands.length && <div className="command-help-group">
        <span>SUBCOMMANDS</span>
        <div className="command-help-chips">
          {help.subcommands.map(item => <span className="command-help-chip is-command" key={item.label} title={item.description}><code>{item.label}</code><small>{item.description}</small></span>)}
        </div>
      </div>}

      {!!help.options.length && <div className="command-help-group">
        <span>OPÇÕES</span>
        <div className="command-help-chips">
          {help.options.map(item => <span className="command-help-chip" key={item.label} title={item.description}><code>{item.label}</code><small>{item.description}</small></span>)}
        </div>
      </div>}

      <div className="command-help-source">
        Fonte: {help.source === 'cli-spec' ? 'especificação CLI local + contexto AST' : 'catálogo local'}.
      </div>
    </div>}
  </section>;
}
