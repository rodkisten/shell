export interface RemoteDescriptor { name: string; entry: string; exposedModule: string; version?: string }
export interface HostContext { theme: 'light' | 'dark'; navigate: (path: string) => void }
