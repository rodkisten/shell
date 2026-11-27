export interface RemoteDescriptor { name: string; entry: string; exposedModule: string }
export function defineRemote(name: string, entry: string, exposedModule: string): RemoteDescriptor {
  if (!/^[a-zA-Z][\w-]*$/.test(name)) throw new Error('Invalid remote name');
  const url = new URL(entry);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid remote protocol');
  if (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('HTTPS required');
  if (!/^\.[/]\w[\w/-]*$/.test(exposedModule)) throw new Error('Invalid exposed module');
  return {name,entry:url.href,exposedModule};
}
export function remoteModuleId(remote: RemoteDescriptor): string {
  return remote.name + '/' + remote.exposedModule.slice(2);
}
