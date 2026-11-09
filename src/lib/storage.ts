import { openDB, type DBSchema } from 'idb';

export type Entry = { id: string; script: string; date: number; kind: 'run' | 'save'; output?: string };
interface ShellDB extends DBSchema {
  entries: { key: string; value: Entry; indexes: { 'by-date': number } };
  drafts: { key: string; value: { key: string; script: string } };
}
const open = () => openDB<ShellDB>('shellconductor-v1', 1, {
  upgrade(db) {
    const entries = db.createObjectStore('entries', { keyPath: 'id' });
    entries.createIndex('by-date', 'date');
    db.createObjectStore('drafts', { keyPath: 'key' });
  },
});
export async function saveEntry(script: string, kind: Entry['kind'], output?: string) {
  const db = await open();
  const item = { id: crypto.randomUUID(), script, date: Date.now(), kind, output };
  await db.put('entries', item);
  const all = await db.getAllKeysFromIndex('entries', 'by-date');
  if (all.length > 150) {
    const tx = db.transaction('entries', 'readwrite');
    for (const key of all.slice(0, all.length - 150)) tx.store.delete(key);
    await tx.done;
  }
  db.close();
  return item;
}
export async function getEntries(): Promise<Entry[]> {
  const db = await open();
  const data = await db.getAllFromIndex('entries', 'by-date');
  db.close();
  return data.reverse();
}
export async function deleteEntry(id: string) { const db = await open(); await db.delete('entries', id); db.close(); }
export async function clearEntries() { const db = await open(); await db.clear('entries'); db.close(); }
export async function getDraft() {
  const db = await open();
  const data = await db.get('drafts', 'editor');
  db.close();
  return data?.script;
}
export async function saveDraft(script: string) {
  const db = await open();
  await db.put('drafts', { key: 'editor', script });
  db.close();
}
