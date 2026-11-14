declare module 'zsh-wasm' {
  export function runZshScript(
    script: string,
    options?: { stdin?: string | null; fs?: 'idbfs' | 'memfs' },
  ): Promise<{ stdout: string; stderr: string; exitCode?: number }>;
}
