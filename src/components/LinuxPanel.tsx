import { useEffect, useRef, useState } from 'react';

type Emulator = {
  stop(): void; run(): void; destroy(): void;
  save_state(): Promise<ArrayBuffer>;
  restore_state(state: ArrayBuffer): Promise<void>;
  add_listener(event: string, callback: (...args: unknown[]) => void): void;
};
type Constructor = new (options: Record<string, unknown>) => Emulator;
declare global { interface Window { V86?: Constructor } }

const base = '/v86';
const defaultAssets = {
  script: base + '/libv86.js',
  wasm: base + '/v86.wasm',
  bios: base + '/seabios.bin',
  vga: base + '/vgabios.bin',
  image: base + '/alpine.iso',
};
const key = 'shellconductor:linux:v86:assets';
function getAssets() {
  try { return { ...defaultAssets, ...JSON.parse(localStorage.getItem(key) || '{}') as typeof defaultAssets }; }
  catch { return defaultAssets; }
}
function loadV86(url: string): Promise<Constructor> {
  if (window.V86) return Promise.resolve(window.V86);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => window.V86 ? resolve(window.V86) : reject(new Error('O arquivo não expôs a API V86.'));
    script.onerror = () => reject(new Error('Falha ao carregar libv86.js. Confira o caminho configurado.'));
    document.head.appendChild(script);
  });
}
export function LinuxPanel() {
  const container = useRef<HTMLDivElement>(null);
  const emulator = useRef<Emulator | null>(null);
  const [assets, setAssets] = useState(getAssets);
  const [status, setStatus] = useState('Desligado');
  const [working, setWorking] = useState(false);
  const [settings, setSettings] = useState(false);
  const [memory, setMemory] = useState(128);
  const [snapshot, setSnapshot] = useState<File | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  useEffect(() => () => { emulator.current?.destroy(); emulator.current = null; }, []);
  const boot = async () => {
    if (working || emulator.current || !container.current) return;
    setWorking(true);
    setStatus('Carregando emulador…');
    try {
      setAssetError(null);
      // Detect missing static assets before creating a VM that appears stuck.
      for (const [name, url] of Object.entries(assets)) {
        try {
          const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
          if (!response.ok) throw new Error('HTTP ' + response.status);
        } catch (error) {
          const message = 'Arquivo ' + name + ' indisponível (' + url + '): ' + String(error);
          setAssetError(message);
          throw new Error(message);
        }
      }
      const V86 = await loadV86(assets.script);
      setStatus('Inicializando Alpine Linux…');
      const vm = new V86({
        wasm_path: assets.wasm,
        memory_size: memory * 1024 * 1024,
        vga_memory_size: 4 * 1024 * 1024,
        screen_container: container.current,
        bios: { url: assets.bios },
        vga_bios: { url: assets.vga },
        cdrom: { url: assets.image, async: true },
        autostart: true,
      });
      emulator.current = vm;
      vm.add_listener('emulator-ready', () => setStatus('Emulador pronto; aguardando boot do Alpine'));
      vm.add_listener('emulator-started', () => setStatus('CPU da VM iniciada; boot do Alpine ainda não confirmado'));
      vm.add_listener('emulator-stopped', () => setStatus('Emulador pausado'));
      vm.add_listener('emulator-error', () => setStatus('Erro interno do emulador; consulte o console'));
      vm.add_listener('download-error', () => setStatus('Erro ao carregar imagem ou firmware; verifique rede e CORS'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally { setWorking(false); }
  };
  const shutdown = () => { emulator.current?.destroy(); emulator.current = null; setStatus('Desligado'); };
  const save = async () => {
    if (!emulator.current) return;
    setWorking(true);
    try {
      const data = await emulator.current.save_state();
      const blob = new Blob([data], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'shellconductor-alpine-v86.state'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('Snapshot exportado');
    } catch (error) { setStatus('Falha no snapshot: ' + String(error)); }
    finally { setWorking(false); }
  };
  const restore = async () => {
    if (!snapshot || !emulator.current) return;
    setWorking(true);
    try {
      emulator.current.stop();
      await emulator.current.restore_state(await snapshot.arrayBuffer());
      emulator.current.run();
      setStatus('Snapshot restaurado');
    } catch (error) { setStatus('Falha ao restaurar: ' + String(error)); }
    finally { setWorking(false); }
  };
  return <section className="linux-panel">
    <div className="linux-toolbar">
      <div><h2>Alpine Linux <small>v86 · x86 32-bit</small></h2><p>{status}</p></div>
      <div className="linux-actions">
        <button disabled={working || !!emulator.current} onClick={() => void boot()}>Iniciar Linux</button>
        <button disabled={!emulator.current} onClick={shutdown}>Desligar</button>
        <button disabled={working || !emulator.current} onClick={() => void save()}>Exportar snapshot</button>
        <button onClick={() => setSettings(v => !v)} aria-expanded={settings}>Configurar imagens</button>
      </div>
    </div>
    {settings && <div className="linux-settings">
      <p>Hospede os arquivos v86 e uma ISO Alpine x86 (32-bit) em /public/v86. Os caminhos abaixo também aceitam URLs CORS compatíveis.</p>
      {(['script','wasm','bios','vga','image'] as const).map(field => <label key={field}>{field}
        <input value={assets[field]} onChange={event => setAssets(prev => ({ ...prev, [field]: event.target.value }))} />
      </label>)}
      <label>RAM (MiB)<select value={memory} onChange={event => setMemory(Number(event.target.value))}>
        <option value={64}>64</option><option value={128}>128</option><option value={256}>256</option><option value={512}>512</option>
      </select></label>
      <button onClick={() => { localStorage.setItem(key, JSON.stringify(assets)); setStatus('Configuração salva neste navegador'); }}>Salvar configuração</button>
    </div>}
    {assetError && <p role="alert" className="linux-note">{assetError}. Execute npm run linux:assets antes do build ou configure URLs válidas.</p>}
    <div className="linux-screen" ref={container}>
      <div className="linux-text-screen" />
      <canvas style={{ display: 'none' }} />
    </div>
    <div className="linux-snapshot">
      <label>Restaurar snapshot <input type="file" accept=".state,.bin" onChange={event => setSnapshot(event.target.files?.[0] || null)}/></label>
      <button disabled={!snapshot || !emulator.current || working} onClick={() => void restore()}>Restaurar</button>
    </div>
    <p className="linux-note">Linux real emulado no navegador. A ISO é um ambiente live; mudanças no disco não são persistidas automaticamente. Snapshots podem ser grandes. Rede e apk dependem de configuração de networking adicional.</p>
  </section>;
}
