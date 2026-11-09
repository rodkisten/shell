import { useCallback, useEffect, useRef, useState } from 'react';
import { isOneLine } from './touch-presets';

export const TOUCH_CHANNEL='shellconductor.touch';
export const TOUCH_VERSION=1;
export type SendMode='insert'|'run';
export type HostRecent={command:string;title?:string;createdAt:number};
type Wire={
  channel:string;version:number;type:string;handshakeId?:string;requestId?:string;
  command?:string;mode?:SendMode;ok?:boolean;error?:string;history?:HostRecent[];
};
type Pending={resolve:()=>void;reject:(error:Error)=>void;timeout:ReturnType<typeof setTimeout>};

export function useTouchBridge(){
  const [connected,setConnected]=useState(false);
  const [hostHistory,setHostHistory]=useState<HostRecent[]>([]);
  const handshake=useRef(crypto.randomUUID());
  const origin=useRef<string|null>(null);
  const pending=useRef(new Map<string,Pending>());

  useEffect(()=>{
    if(window.parent===window)return;
    const parent=window.parent;
    const hello=()=>{
      if(!origin.current)parent.postMessage({
        channel:TOUCH_CHANNEL,version:TOUCH_VERSION,type:'child.ready',handshakeId:handshake.current,
      },'*');
    };
    const receive=(event:MessageEvent)=>{
      if(event.source!==parent)return;
      const data:unknown=event.data;
      if(!data||typeof data!=='object')return;
      const message=data as Partial<Wire>;
      if(message.channel!==TOUCH_CHANNEL||message.version!==TOUCH_VERSION)return;
      if(message.type==='host.ready'){
        if(message.handshakeId!==handshake.current)return;
        if(origin.current&&event.origin!==origin.current)return;
        origin.current=event.origin;setConnected(true);return;
      }
      if(!origin.current||event.origin!==origin.current)return;
      if(message.type==='host.history'&&Array.isArray(message.history)){
        setHostHistory(message.history.slice(0,200).filter(item=>
          item&&typeof item.command==='string'&&isOneLine(item.command)&&
          typeof item.createdAt==='number'&&Number.isFinite(item.createdAt)
        ).map(item=>({
          command:item.command,createdAt:item.createdAt,
          title:typeof item.title==='string'?item.title.slice(0,120):'',
        })));
      }
      if(message.type==='host.ack'&&typeof message.requestId==='string'){
        const task=pending.current.get(message.requestId);
        if(!task)return;
        clearTimeout(task.timeout);pending.current.delete(message.requestId);
        if(message.ok===true)task.resolve();
        else task.reject(new Error(message.error||'A extensão não confirmou o comando.'));
      }
    };
    window.addEventListener('message',receive);
    window.addEventListener('focus',hello);
    hello();
    const active=pending.current;
    return ()=>{
      window.removeEventListener('message',receive);
      window.removeEventListener('focus',hello);
      for(const task of active.values()){
        clearTimeout(task.timeout);task.reject(new Error('Conexão encerrada.'));
      }
      active.clear();
    };
  },[]);

  const send=useCallback(async(command:string,mode:SendMode):Promise<'sent'|'copied'>=>{
    if(!isOneLine(command))throw new Error('Somente comandos de uma linha com até 4.000 caracteres.');
    if(window.parent===window||!origin.current){
      if(!navigator.clipboard?.writeText)throw new Error('Extensão desconectada e cópia indisponível.');
      await navigator.clipboard.writeText(command);
      return 'copied';
    }
    const requestId=crypto.randomUUID();
    await new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>{
        pending.current.delete(requestId);
        reject(new Error('A extensão não respondeu. O comando não foi confirmado.'));
      },5000);
      pending.current.set(requestId,{resolve,reject,timeout});
      const message:Wire={
        channel:TOUCH_CHANNEL,version:TOUCH_VERSION,type:'terminal.send',
        handshakeId:handshake.current,requestId,command,mode,
      };
      window.parent.postMessage(message,origin.current==='null'?'*':origin.current!);
    });
    return 'sent';
  },[]);
  return {connected,hostHistory,send};
}
