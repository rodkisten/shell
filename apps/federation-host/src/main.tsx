import React, {Suspense, lazy, Component} from 'react';
import {createRoot} from 'react-dom/client';
import {registerRemotes,loadRemote} from '@module-federation/runtime';
import {defineRemote,remoteModuleId} from '../../../packages/federation/index';
const entry = import.meta.env.VITE_WORKFLOW_REMOTE || new URL('/workflow/mf-manifest.json',location.origin).href;
const remote=defineRemote('code_workflow',entry,'./WorkflowStudio');
const shell=defineRemote('code_shell',import.meta.env.VITE_SHELL_REMOTE || new URL('/shell-remote/mf-manifest.json',location.origin).href,'./Shell');
registerRemotes([remote,shell].map(({name,entry})=>({name,entry})));
const Shell=lazy(async()=>{const mod=await loadRemote<{default:React.ComponentType}>(remoteModuleId(shell));if(!mod?.default)throw Error('Shell export missing');return mod;});
const Studio=lazy(async()=>{const mod=await loadRemote<{default:React.ComponentType}>(remoteModuleId(remote));if(!mod?.default)throw new Error('Remote export missing');return mod;});
class Boundary extends Component<React.PropsWithChildren,{error:string}>{state={error:''};static getDerivedStateFromError(error:Error){return {error:error.message}}render(){return this.state.error?<main role="alert"><h1>Workflow unavailable</h1><p>{this.state.error}</p><button onClick={()=>location.reload()}>Retry</button></main>:this.props.children}}
function Host(){const [active,setActive]=React.useState('workflow');return <><nav style={{display:'flex',gap:8,padding:8}}><button onClick={()=>setActive('workflow')}>Workflow Studio</button><button onClick={()=>setActive('shell')}>Shell</button></nav><Boundary key={active}><Suspense fallback={<p role="status">Loading remote…</p>}>{active==='shell'?<Shell/>:<Studio/>}</Suspense></Boundary></>;}
createRoot(document.getElementById('root')!).render(<Host/>);
