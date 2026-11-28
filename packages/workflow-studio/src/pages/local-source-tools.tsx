import { kitchenSinkWorkflow } from './workflow-example';
import { useEffect, useRef, useState } from 'react';
const max = 262144;
export function LocalSourceTools({
  source,
  filename,
  disabled,
  onOpen,
}: {
  source: string;
  filename: string;
  disabled: boolean;
  onOpen: (source: string, filename: string) => void;
}) {
  const downloads = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(
    () => () => {
      for (const [url, timer] of downloads.current) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      downloads.current.clear();
    },
    [],
  );
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [paste, setPaste] = useState(false),
    [text, setText] = useState(''),
    [error, setError] = useState('');
  function open(value: string, name: string) {
    if (new TextEncoder().encode(value).length > max) {
      setError('YAML exceeds 256 KiB');
      return;
    }
    setError('');
    onOpen(value, name);
    setPaste(false);
    setMenu(false);
    setText('');
  }
  async function read(file: File) {
    try {
      if (!/\.ya?ml$/i.test(file.name)) throw Error('Select a .yml or .yaml file');
      if (file.size > max) throw Error('YAML exceeds 256 KiB');
      open(await file.text(), file.name);
    } catch (e) {
      setError(String(e));
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([source], { type: 'application/yaml;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.split('/').at(-1) || 'workflow.yml';
    a.click();
    downloads.current.set(
      url,
      setTimeout(() => {
        URL.revokeObjectURL(url);
        downloads.current.delete(url);
      }, 1000),
    );
  }
  return (
    <section aria-label="Local YAML">
      <div className="orb-file-menu">
        <button type="button" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
          File ▾
        </button>
        <div className="orb-file-actions" hidden={!menu}>
          <button
            disabled={disabled}
            onClick={() =>
              open(
                'name: Workflow\non: workflow_dispatch\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo Ready\n',
                'workflow.yml',
              )
            }
          >
            New YAML
          </button>
          <button disabled={disabled} onClick={() => open(kitchenSinkWorkflow, 'kitchen-sink.yml')}>
            Load demo
          </button>
          <button disabled={disabled} onClick={() => setPaste((v) => !v)}>
            Paste YAML
          </button>
          <button disabled={disabled} onClick={() => input.current?.click()}>
            Import file
          </button>
          <input
            hidden
            ref={input}
            type="file"
            accept=".yaml,.yml,application/yaml,text/yaml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void read(file);
            }}
          />
          <button disabled={!source} onClick={download}>
            Download YAML
          </button>
        </div>
      </div>
      {paste && (
        <div>
          <textarea
            aria-label="Paste YAML source"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoCapitalize="none"
            spellCheck={false}
            rows={8}
          />
          <button disabled={disabled || !text.trim()} onClick={() => open(text, 'pasted.yml')}>
            Open YAML
          </button>
          <button onClick={() => setPaste(false)}>Cancel</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
