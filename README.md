# ShellConductor

A mobile-first shell workbench for learning and daily use. Designed for the iPhone Safari screen, with a clean Vercel-like interface.

**Stack:** React 19 + React Router (library / SPA) + Vite 7 + TypeScript + shadcn-style Radix primitives + Tailwind v4 + CodeMirror 6 + Cloudflare Workers.

## Features

- Bash editor with syntax highlighting, contextual completion, clickable commands, examples and manual popovers.
- Real man page details, synopsis, flags and command explanation from the [ManKier API v2](https://www.mankier.com/api), fetched through the Cloudflare Worker.
- [shfmt](https://github.com/mvdan/sh) as WebAssembly for code formatting and the one-line / multi-line conversion.
- [ShellCheck](https://www.shellcheck.net/) as WebAssembly, showing warnings and available automatic fixes with source links.
- Isolated [Bashkit WebAssembly](https://github.com/everruns/bashkit) with pipes, variables, loops, functions, `jq`, `awk`, `sed`, virtual filesystem and limits on execution.
- Saved commands, runs and current draft persisted in IndexedDB, capped at 150 history records. No sign-in.
- Safari touch-first UI, compact command toolbar, safe-area navigation, keyboard-friendly text size and PWA manifest.
- React Router navigation: editor, reference library and saved history.

## Running locally

Node.js 22+ is recommended.

```sh
npm install
npm run dev
```

Quality checks (intentionally no test suite):

```sh
npm run typecheck
npm run lint
npm run format
npm run build
```

## Cloudflare continuous deployment (native Workers Builds)

The repo includes `wrangler.jsonc`, the Cloudflare Vite plugin, the Worker backend, and the build/deploy scripts.

1. Go to **Cloudflare Dashboard → Workers & Pages → Create application → GitHub** (or open an existing Worker → **Settings → Builds → Connect**).
2. Select **rodkisten/shell**, root `/`, production branch **main**.
3. Ensure the Worker name is **shellconductor**, matching `wrangler.jsonc`.
4. Set install command `npm ci`, build command `npm run build`, deploy command `npx wrangler deploy` (or set deploy command to `npm run deploy` if build runs there).
5. Enable preview builds for PRs if you want them. Save and deploy.

After the connection is made, Cloudflare automatically builds/deploys on commits to `main`. **This repository does not by itself connect to your Cloudflare account.** Cloudflare's own GitHub integration needs to be authorized in the dashboard. The GitHub Actions workflow only checks build and lint; it does not deploy, to avoid duplicate releases.

### Worker headers

The Worker returns `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` for static assets. This is necessary for the ShellCheck browser engine (`SharedArrayBuffer`, modern Safari required). ShellCheck is loaded only when validation is requested. Other tools do not require cross-origin isolation.

### Security and limitations

- **Executing** means running inside an isolated Bash-like virtual environment, **not** your real iPhone terminal or Cloud Shell. It does not run SSH, your system binaries, or arbitrary installed programs. HTTP via curl/wget is not enabled in the browser WASM sandbox. Never treat the result as authoritative execution on Linux.
- Bashkit's shell is highly capable but not identical to Bash on every platform, and the tool can be resource-limited or interrupted.
- shfmt and ShellCheck are not AI code repair. The “apply fixes” action only performs fixes explicitly emitted by ShellCheck. Some diagnostics require manual edits.
- One-line conversion uses shfmt's grammar, not a destructive newline replacement. When complex constructs cannot become a single line, they remain multiline.
- Mankier API requests are sent for command names or complete code only when users open a manual/explanation. Avoid sharing secrets. The server caches responses for a short time.
- Scripts and history remain in local IndexedDB. Safari private browsing or clearing site data may remove them.
- The UI is optimized for desktop and iPhone Safari but requires a modern browser to run WASM.

## License notes

ShellCheck and its WASM artifact are GPL-3.0-or-later. Verify distribution obligations when shipping compiled code. Other package licenses are in each upstream package.

No tests are configured, by request.
