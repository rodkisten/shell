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
  const [events, setEvents] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [serial, setSerial] = useState('');
  const [bootWarning, setBootWarning] = useState('');
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const log = (message: string) => setEvents(previous => [...previous.slice(-39), new Date().toLocaleTimeString('pt-BR') + ' · ' + message]);
  const clearWatchdog = () => { if (watchdog.current) clearTimeout(watchdog.current); watchdog.current = null; };
  useEffect(() => () => { clearWatchdog(); emulator.current?.destroy(); emulator.current = null; }, []);
  const boot = async () => {
    if (working || emulator.current || !container.current) return;
    setWorking(true);
    setStatus('Carregando emulador…');
    setProgress(0); setEvents([]); setSerial(''); setBootWarning('');
    log('Iniciando pré-verificação dos arquivos');
    try {
      setAssetError(null);
      // Detect missing static assets before creating a VM that appears stuck.
      for (const [index, [name, url]] of Object.entries(assets).entries()) {
        setStatus('Verificando ' + name + '…');
        try {
          const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          log(name + ': HTTP ' + response.status + ', ' + (response.headers.get('content-length') || 'tamanho desconhecido') + ' bytes');
          setProgress((index + 1) * 10);
        } catch (error) {
          const message = 'Arquivo ' + name + ' indisponível (' + url + '): ' + String(error);
          setAssetError(message);
          throw new Error(message);
        }
      }
      setStatus('Carregando JavaScript do v86…');
      const V86 = await loadV86(assets.script);
      log('API V86 carregada'); setProgress(60);
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
      log('Máquina virtual criada; aguardando firmware e kernel');
      setProgress(70);
      vm.add_listener('emulator-ready', () => { log('Emulador pronto'); setStatus('Firmware pronto; aguardando Alpine…'); setProgress(80); });
      vm.add_listener('emulator-started', () => { log('CPU iniciada (não confirma boot do Linux)'); setStatus('CPU iniciada; aguardando saída do Alpine…'); setProgress(85); });
      vm.add_listener('emulator-stopped', () => { log('CPU parada'); setStatus('Emulador pausado'); });
      vm.add_listener('emulator-error', (...args) => { const message = 'Erro interno v86: ' + args.map(String).join(' '); log(message); setAssetError(message); setStatus('Falha no emulador'); clearWatchdog(); });
      vm.add_listener('download-error', (...args) => { const message = 'Falha no download: ' + args.map(String).join(' '); log(message); setAssetError(message); setStatus('Falha ao baixar firmware ou ISO'); clearWatchdog(); });
      vm.add_listener('serial0-output-byte', (...args) => {
        const byte = Number(args[0]);
        if (!Number.isFinite(byte)) return;
        setSerial(previous => (previous + String.fromCharCode(byte)).slice(-6000));
        if (byte === 10) { setProgress(100); clearWatchdog(); setStatus('Saída serial detectada; Alpine em inicialização'); }
      });
      clearWatchdog();
      watchdog.current = setTimeout(() => {
        setBootWarning('A CPU iniciou, mas nenhuma saída serial foi detectada em 45 segundos. O vídeo pode estar travado ou a ISO pode não ter iniciado. Verifique o diagnóstico e tente reiniciar.');
        log('Timeout: boot não confirmado após 45 segundos');
      }, 45000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message); log('ERRO: ' + message);
    } finally { setWorking(false); }
  };
  const shutdown = () => { clearWatchdog(); emulator.current?.destroy(); emulator.current = null; setStatus('Desligado'); setProgress(0); log('Máquina virtual desligada'); };
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
    <div className="linux-progress" role="status"><div><span>Inicialização</span><strong>{progress}%</strong></div><progress max={100} value={progress} /><small>{progress === 100 ? 'Saída serial recebida' : 'Progresso do carregamento, não do boot completo'}</small></div>
    {bootWarning && <p className="linux-note" role="alert">⚠ {bootWarning}</p>}
    {assetError && <p role="alert" className="linux-note">{assetError}. Execute npm run linux:assets antes do build ou configure URLs válidas.</p>}
    <div className="linux-screen" ref={container} aria-label="Tela da máquina virtual Alpine Linux">
      {!emulator.current && <div className="linux-boot-placeholder"><strong>Alpine Linux · v86</strong><span>Pressione “Iniciar Linux” para carregar a máquina virtual.</span></div>}
      <div className="linux-text-screen" />
      <canvas style={{ display: 'none' }} />
    </div>
    <details className="linux-diagnostics" open><summary>Diagnóstico de inicialização · {events.length} eventos</summary><pre>{events.join('\n') || 'Aguardando inicialização…'}</pre>{serial && <><strong>Console serial</strong><pre>{serial}</pre></>}</details>
    <div className="linux-snapshot">
      <label>Restaurar snapshot <input type="file" accept=".state,.bin" onChange={event => setSnapshot(event.target.files?.[0] || null)}/></label>
      <button disabled={!snapshot || !emulator.current || working} onClick={() => void restore()}>Restaurar</button>
    </div>
    <p className="linux-note">Linux real emulado no navegador. A ISO é um ambiente live; mudanças no disco não são persistidas automaticamente. Snapshots podem ser grandes. Rede e apk dependem de configuração de networking adicional.</p>
  </section>;
}
