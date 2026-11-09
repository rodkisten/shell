import { openDB, type DBSchema } from 'idb';
import { DEFAULT_PINNED, type TouchCommand } from './touch-presets';

export type TouchRecent = {
  id: string; command: string; title: string; createdAt: number;
  disposition: 'sent'|'copied';
};
interface TouchDB extends DBSchema {
  custom: { key:string; value:TouchCommand; indexes:{ 'by-updated':number } };
  recent: { key:string; value:TouchRecent; indexes:{ 'by-created':number } };
  favorites: { key:string; value:{ id:string; addedAt:number } };
}
const db = () => openDB<TouchDB>('shellconductor-touch-v1',1,{
  upgrade(database){
    const custom=database.createObjectStore('custom',{keyPath:'id'});
    custom.createIndex('by-updated','updatedAt');
    const recent=database.createObjectStore('recent',{keyPath:'id'});
    recent.createIndex('by-created','createdAt');
    const favorites=database.createObjectStore('favorites',{keyPath:'id'});
    DEFAULT_PINNED.forEach((id,index)=>favorites.put({id,addedAt:Date.now()+index}));
  },
});
export async function loadTouchData(){
  const store=await db();
  try{
    const [custom,recent,favorites]=await Promise.all([
      store.getAllFromIndex('custom','by-updated'),
      store.getAllFromIndex('recent','by-created'),store.getAll('favorites'),
    ]);
    return {custom:custom.reverse(),recent:recent.reverse(),favorites:favorites.map(x=>x.id)};
  } finally {store.close();}
}
export async function putTouchCommand(item:TouchCommand){
  const store=await db();try{await store.put('custom',item);}finally{store.close();}
}
export async function deleteTouchCommand(id:string){
  const store=await db();
  try{await store.delete('custom',id);await store.delete('favorites',id);}finally{store.close();}
}
export async function setTouchFavorite(id:string,value:boolean){
  const store=await db();
  try{
    if(value)await store.put('favorites',{id,addedAt:Date.now()});
    else await store.delete('favorites',id);
  }finally{store.close();}
}
export async function recordTouchCommand(command:string,title:string,disposition:TouchRecent['disposition']){
  const store=await db();
  try{
    await store.put('recent',{id:crypto.randomUUID(),command,title,disposition,createdAt:Date.now()});
    const keys=await store.getAllKeysFromIndex('recent','by-created');
    if(keys.length>200){
      const tx=store.transaction('recent','readwrite');
      for(const key of keys.slice(0,keys.length-200))await tx.store.delete(key);
      await tx.done;
    }
  }finally{store.close();}
}
export async function clearTouchRecent(){
  const store=await db();try{await store.clear('recent');}finally{store.close();}
}
export async function deleteTouchRecent(id:string){
  const store=await db();try{await store.delete('recent',id);}finally{store.close();}
}
