import { useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import type { CommandHelpModel } from '../lib/command-help';
import { highlightFlowSource } from '../lib/flow-highlight';

export function CommandHelp({ help, onManual, follow, onFollowChange }: {
  help: CommandHelpModel | null;
  onManual(command: string): void;
  follow: boolean;
  onFollowChange(value: boolean): void;
}) {
  const [expanded, setExpanded] = useState(false);
  return <section className="command-help" aria-label="Explicação contextual">
    <div className="command-help-head">
      <strong>{help ? [help.executable, ...help.path].join(' ') : 'Explain'}</strong>
      <label style={{display:'flex',alignItems:'center',gap:6,fontSize:11}}>
        <input type="checkbox" checked={follow} onChange={e => onFollowChange(e.target.checked)} /> Sincronizar
      </label>
      {help && <button className="command-help-manual" type="button" onClick={() => onManual(help.executable)}><BookOpen size={14}/> Man</button>}
    </div>
    {help && <div className="command-help-body">
      <strong>{help.title}</strong>
      <p className="command-help-description">{help.description}</p>
      <pre className="command-help-signature" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',background:'#212121',color:'#eeffff'}}><code dangerouslySetInnerHTML={{__html:highlightFlowSource(help.snippet)}} /></pre>
      {(expanded ? help.options : help.usedOptions).map(item => <div key={item.label}><code>{item.label}</code> · {item.description}</div>)}
      {expanded && <><code>{help.signature}</code>{help.subcommands.map(item => <div key={item.label}><code>{item.label}</code> · {item.description}</div>)}</>}
      <button type="button" className="command-help-manual" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}><ChevronDown size={14}/>{expanded ? 'Mostrar apenas usos atuais' : 'Ver todos os usos'}</button>
    </div>}
  </section>;
}
