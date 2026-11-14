import { useCallback, useEffect, useState } from 'react';
import { Folder, FileText, RefreshCw, Save, Trash2, Plus, ArrowLeft, Download } from 'lucide-react';
import {
  createWorkspaceDirectory, deleteWorkspaceEntry, listWorkspace,
  readWorkspaceFile, saveWorkspaceFile, type WorkspaceEntry,
} from '../lib/workspace';

export function WorkspacePanel() {
  const [cwd, setCwd] = useState('');
  const [items, setItems] = useState<WorkspaceEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [contents, setContents] = useState('');
  const [newName, setNewName] = useState('');
  const [directory, setDirectory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try { setItems(await listWorkspace(cwd)); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [cwd]);

  useEffect(() => { void refresh(); }, [refresh]);

  const task = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const open = (item: WorkspaceEntry) => {
    if (item.directory) { setCwd(previous => [previous, item.name].filter(Boolean).join('/')); setSelected(null); return; }
    void task(async () => {
      setContents(await readWorkspaceFile(item.name, cwd));
      setSelected(item.name);
    });
  };

  return <section className="workspace-files" aria-label="Arquivos persistentes">
    <div className="workspace-files-header">
      <strong>Arquivos locais</strong>
      <button type="button" onClick={() => void refresh()} title="Atualizar arquivos"><RefreshCw size={16}/></button>
    </div>
    <div className="workspace-files-path"><button type="button" disabled={!cwd} onClick={() => { setCwd(value => value.split('/').slice(0, -1).join('/')); setSelected(null); }} aria-label="Voltar à pasta anterior"><ArrowLeft size={15}/></button><span>/home/user{cwd ? '/' + cwd : ''} · IndexedDB</span></div>
    <div className="workspace-files-create">
      <input aria-label="Nome do arquivo ou pasta" value={newName} onChange={e => setNewName(e.target.value)} placeholder="novo-arquivo.txt" />
      <label><input type="checkbox" checked={directory} onChange={e => setDirectory(e.target.checked)}/> Pasta</label>
      <button type="button" disabled={busy || !newName.trim()} onClick={() => void task(async () => {
        if (directory) await createWorkspaceDirectory(newName.trim(), cwd);
        else await saveWorkspaceFile(newName.trim(), '', cwd);
        setNewName('');
      })}><Plus size={15}/> Criar</button>
    </div>
    <div className="workspace-files-list">
      {items.map(item => <div className="workspace-files-entry" key={item.name}>
        <button type="button" onClick={() => open(item)}>{item.directory ? <Folder size={16}/> : <FileText size={16}/>}<span>{item.name}</span></button>
        <button type="button" title={'Excluir ' + item.name} disabled={busy} onClick={() => {
          if (window.confirm('Excluir ' + item.name + '?')) void task(async () => {
            await deleteWorkspaceEntry(item.name, item.directory, cwd);
            if (selected === item.name) setSelected(null);
          });
        }}><Trash2 size={15}/></button>
      </div>)}
      {!items.length && <p className="workspace-files-caption">Nenhum arquivo. Crie um acima ou use o terminal.</p>}
    </div>
    {selected && <div className="workspace-files-editor">
      <strong>{selected}</strong>
      <textarea aria-label={'Conteúdo de ' + selected} value={contents} onChange={e => setContents(e.target.value)} rows={7} spellCheck={false}/>
      <button type="button" disabled={busy} onClick={() => void task(async () => {
        await saveWorkspaceFile(selected, contents, cwd); setNotice('Arquivo salvo no workspace.');
      })}><Save size={15}/> Salvar</button>
    </div>}
    {error && <p role="alert" className="workspace-files-error">{error}</p>}
    {notice && <p role="status" className="workspace-files-caption">{notice}</p>}
  </section>;
}
