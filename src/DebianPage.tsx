import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Copy, Download, Github, Package, RefreshCw, ShieldCheck, Terminal, Clock3 } from 'lucide-react';
import './DebianPage.css';

type Asset = { name: string; size: number; browser_download_url: string; digest?: string };
type Release = { id: number; tag_name: string; name: string; body: string | null; published_at: string; html_url: string; prerelease: boolean; draft: boolean; assets: Asset[] };
const API = 'https://api.github.com/repos/rodkisten/codespaces/releases?per_page=30';
// Keep CDN module specifiers dynamic: TypeScript cannot resolve HTTP imports at build time.
const CDN = {
  highlight: 'https://esm.sh/highlight.js@11.11.1/lib/core?bundle',
  bash: 'https://esm.sh/highlight.js@11.11.1/lib/languages/bash?bundle',
  marked: 'https://esm.sh/marked@15.0.12?bundle',
  purify: 'https://esm.sh/dompurify@3.2.6?bundle',
} as const;
const commands = [
  { name: 'Install', subtitle: 'Latest stable release', value: 'curl -fsSL https://shell.migos.club/debian/installer -o /tmp/rod-install.sh\nsudo bash /tmp/rod-install.sh' },
  { name: 'Check updates', subtitle: 'Read-only version check', value: 'rod-self-update --check' },
  { name: 'Self-update', subtitle: 'Update to latest stable', value: 'sudo rod-self-update --self-update' },
  { name: 'Dry run', subtitle: 'Preview changes before applying', value: 'curl -fsSL https://shell.migos.club/debian/installer -o /tmp/rod-install.sh\nsudo bash /tmp/rod-install.sh --dry-run' },
];
function Code({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState('');
  useEffect(() => {
    let active = true;
    import(/* @vite-ignore */ CDN.highlight).then(async (module) => {
      const bash = await import(/* @vite-ignore */ CDN.bash);
      const hljs = module.default as { registerLanguage: (name: string, fn: unknown) => void; highlight: (text: string, options: { language: string }) => { value: string } };
      hljs.registerLanguage('bash', bash.default);
      if (active) setHtml(hljs.highlight(value, { language: 'bash' }).value);
    }).catch(() => {});
    return () => { active = false; };
  }, [value]);
  const copy = async () => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
  return <div className="deb-code"><div className="deb-code-head"><span><span className="deb-dot" /> bash</span><button onClick={copy} aria-label="Copy command">{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? 'Copied' : 'Copy'}</button></div><pre><code>{html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : value}</code></pre></div>;
}
function ReleaseNotes({ text }: { text: string }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([
      import(/* @vite-ignore */ CDN.marked),
      import(/* @vite-ignore */ CDN.purify),
    ]).then(([marked, purify]) => {
      const raw = marked.marked.parse(text, { async: false }) as string;
      if (active) setHtml(purify.default.sanitize(raw));
    }).catch(() => {});
    return () => { active = false; };
  }, [text]);
  return html ? <div className="deb-markdown" dangerouslySetInnerHTML={{ __html: html }} /> : <p className="deb-plain">{text}</p>;
}
export default function DebianPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('latest');
  const [expanded, setExpanded] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(API, { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } })
      .then(async response => { if (!response.ok) throw new Error('GitHub API returned ' + response.status); return response.json() as Promise<Release[]>; })
      .then(data => { setReleases(data.filter(r => !r.draft && !r.prerelease)); setError(''); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load releases'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  const current = releases[0];
  const selectedVersion = useMemo(() => selected === 'latest' ? current?.tag_name : selected, [selected, current]);
  const versionCommand = selected === 'latest' ? commands[0].value : 'curl -fsSL https://shell.migos.club/debian/installer/' + selected.replace(/^v/, '') + ' -o /tmp/rod-install.sh\nsudo bash /tmp/rod-install.sh';
  return <main className="deb-page">
    <div className="deb-glow" aria-hidden="true" />
    <header className="deb-top"><a href="/" className="deb-brand"><span className="deb-brand-icon"><Terminal size={18}/></span> shell<span className="deb-brand-muted">/ debian</span></a><a href="https://github.com/rodkisten/codespaces" target="_blank" rel="noreferrer" className="deb-top-link"><Github size={16}/> GitHub <ArrowUpRight size={13}/></a></header>
    <div className="deb-container">
      <div className="deb-eyebrow"><span className="deb-spark">✳</span> THE ROD ENVIRONMENT <span className="deb-eyebrow-line" /> DEBIAN EDITION</div>
      <section className="deb-hero"><div className="deb-hero-copy"><div className="deb-kicker"><span className="deb-live"/> RELEASE CHANNEL <span className="deb-kicker-divider">/</span> STABLE</div><h1>Your machine.<br/><em>Beautifully configured.</em></h1><p>One reproducible setup for your Debian workspace. Versioned releases, verified artifacts, and a shell that feels like yours.</p><div className="deb-meta"><span><ShieldCheck size={15}/> SHA-256 verified</span><span><Package size={15}/> GitHub Releases</span><span><RefreshCw size={15}/> Self-updating</span></div></div><div className="deb-hero-art" aria-hidden="true"><div className="deb-orbit deb-orbit-one"/><div className="deb-orbit deb-orbit-two"/><div className="deb-cube">⌘</div><div className="deb-art-label">DEBIAN / SYSTEM</div></div></section>
      <section className="deb-install"><div className="deb-section-heading"><div><div className="deb-section-kicker">01 / GET STARTED</div><h2>Install in seconds.</h2></div><div className="deb-select-wrap"><label htmlFor="deb-version">VERSION</label><select id="deb-version" value={selected} onChange={e => setSelected(e.target.value)}><option value="latest">Latest stable{current ? ' · ' + current.tag_name : ''}</option>{releases.map(r => <option key={r.id} value={r.tag_name}>{r.tag_name}</option>)}</select><ChevronDown size={14}/></div></div><Code value={versionCommand}/><div className="deb-install-note"><ShieldCheck size={15}/><span>Downloads the official release ZIP and verifies its SHA-256 digest before installation. Review the script before running it with sudo.</span></div></section>
      <section className="deb-operations"><div className="deb-section-kicker">02 / OPERATIONS</div><h2>Everything, under control.</h2><div className="deb-ops-grid">{commands.slice(1).map((cmd, index) => <div className="deb-op" key={cmd.name}><div className="deb-op-head"><span className="deb-op-icon">{index === 0 ? <ShieldCheck size={18}/> : index === 1 ? <RefreshCw size={18}/> : <Terminal size={18}/>}</span><div><strong>{cmd.name}</strong><small>{cmd.subtitle}</small></div></div><Code value={cmd.value}/></div>)}</div></section>
      <section className="deb-releases"><div className="deb-section-heading"><div><div className="deb-section-kicker">03 / CHANGELOG</div><h2>Built to evolve.</h2><p>Every release. Every improvement. Nothing hidden.</p></div><a href="https://github.com/rodkisten/codespaces/releases" target="_blank" rel="noreferrer" className="deb-outline-link">All releases <ArrowUpRight size={15}/></a></div>
      {loading ? <div className="deb-empty">Fetching releases from GitHub…</div> : error ? <div className="deb-empty">Could not load releases: {error}. <a href="https://github.com/rodkisten/codespaces/releases">View on GitHub</a></div> : releases.length === 0 ? <div className="deb-empty">No stable releases published yet. The installation endpoint requires a release with <code>rod-debian.zip</code>.</div> : <div className="deb-release-list">{releases.map((r, i) => <article className="deb-release" key={r.id}><button className="deb-release-toggle" onClick={() => setExpanded(expanded === r.id ? null : r.id)} aria-expanded={expanded === r.id}><span className="deb-release-version">{r.tag_name} {i === 0 && <span className="deb-latest">LATEST</span>}</span><span className="deb-release-date"><Clock3 size={13}/>{new Date(r.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span><ChevronDown size={17} className={expanded === r.id ? 'deb-chevron-open' : ''}/></button>{expanded === r.id && <div className="deb-release-detail"><ReleaseNotes text={r.body || 'No release notes provided.'}/><div className="deb-release-assets">{r.assets.filter(a => a.name.endsWith('.zip')).map(a => <a key={a.name} href={a.browser_download_url}><Download size={15}/>{a.name}<span>{(a.size / 1024 / 1024).toFixed(2)} MB</span></a>)}</div><Code value={'curl -fsSL https://shell.migos.club/debian/installer/' + r.tag_name.replace(/^v/, '') + ' -o /tmp/rod-install.sh\nsudo bash /tmp/rod-install.sh'}/><a href={r.html_url} target="_blank" rel="noreferrer" className="deb-release-source">Release on GitHub <ArrowUpRight size={13}/></a></div>}</article>)}</div>}
      </section><footer className="deb-footer"><span>✳ ROD / DEBIAN</span><span>Built for the terminal. Designed for humans.</span><a href="https://github.com/rodkisten/codespaces">Source <ArrowUpRight size={12}/></a></footer>
    </div>
  </main>;
}
