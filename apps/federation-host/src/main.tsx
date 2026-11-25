import React, {Suspense, lazy, Component} from 'react';
import {createRoot} from 'react-dom/client';
import {registerRemotes,loadRemote} from '@module-federation/runtime';
const entry = import.meta.env.VITE_WORKFLOW_REMOTE || new URL('/workflow/mf-manifest.json',location.origin).href;
registerRemotes([{name:'code_workflow',entry}]);
const Studio=lazy(async()=>{const mod=await loadRemote<{default:React.ComponentType}>('code_workflow/WorkflowStudio');if(!mod?.default)throw new Error('Remote export missing');return mod;});
class Boundary extends Component<React.PropsWithChildren,{error:string}>{state={error:''};static getDerivedStateFromError(error:Error){return {error:error.message}}render(){return this.state.error?<main role="alert"><h1>Workflow unavailable</h1><p>{this.state.error}</p><button onClick={()=>location.reload()}>Retry</button></main>:this.props.children}}
createRoot(document.getElementById('root')!).render(<Boundary><Suspense fallback={<p role="status">Loading Workflow Studio…</p>}><Studio/></Suspense></Boundary>);
