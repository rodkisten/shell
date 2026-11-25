import {parseDocument, stringify} from 'yaml';
export type Port={id:string;description:string;required:boolean;default?:string};
export type ActionContract={uses:string;name:string;inputs:Port[];outputs:Port[]};
export type Step={id:string;name:string;uses?:string;run?:string;with?:Record<string,string>;contract?:ActionContract};
export type Model={name:string;steps:Step[];source?:string;jobId?:string};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function manifest(uses:string,source:string):ActionContract{
 const doc=parseDocument(source); if(doc.errors.length)throw Error(doc.errors.map(e=>e.message).join('; '));
 const data=record(doc.toJS()); if(typeof data.name!=='string'||!data.runs)throw Error('Invalid action manifest');
 const ports=(value:unknown)=>Object.entries(record(value)).map(([id,v])=>{const p=record(v);return {id,description:String(p.description??''),required:p.required===true,...(p.default===undefined?{}:{default:String(p.default)})}});
 return {uses,name:data.name,inputs:ports(data.inputs),outputs:ports(data.outputs)};
}
export async function resolveAction(uses:string,signal?:AbortSignal):Promise<ActionContract>{
 const match=/^([\w.-]+)\/([\w.-]+)((?:\/[\w.-]+)*)@([\w./-]+)$/.exec(uses);
 if(!match||match.slice(1).some(x=>x.split('/').includes('..')))throw Error('Use owner/repo[/path]@ref');
 const [,owner,repo,path,ref]=match;
 for(const file of ['action.yml','action.yaml']){
  const response=await fetch('https://raw.githubusercontent.com/'+owner+'/'+repo+'/'+ref+path+'/'+file,{signal});
  if(response.ok)return manifest(uses,await response.text());
  if(response.status!==404)throw Error('GitHub HTTP '+response.status);
 }
 throw Error('Action manifest not found');
}
export function validate(model:Model):string[]{
 const errors:string[]=[];const seen=new Set<string>();
 if(!model.steps.length)errors.push('Add at least one step');
 for(const step of model.steps){
  if(!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(step.id)||seen.has(step.id))errors.push('Invalid or duplicate step ID: '+step.id);
  if(Boolean(step.uses)===Boolean(step.run))errors.push(step.id+': choose uses or run');
  for(const port of step.contract?.inputs??[])if(port.required&&port.default===undefined&&!step.with?.[port.id])errors.push(step.id+': missing '+port.id);
  for(const value of Object.values(step.with??{}))for(const m of value.matchAll(/steps\.([\w-]+)\.outputs\.([\w-]+)/g)){
   if(!seen.has(m[1]))errors.push(step.id+': output must come from an earlier step');
   const source=model.steps.find(s=>s.id===m[1]);if(source?.contract&&!source.contract.outputs.some(p=>p.id===m[2]))errors.push(step.id+': unknown output '+m[2]);
  }
  seen.add(step.id);
 }return errors;
}
export function importWorkflow(source:string,jobId?:string):Model{
 const doc=parseDocument(source);if(doc.errors.length)throw Error(doc.errors.map(e=>e.message).join('; '));
 const root=record(doc.toJS());const jobs=record(root.jobs);const id=jobId??Object.keys(jobs).find(key=>Array.isArray(record(jobs[key]).steps));
 if(!id||!Array.isArray(record(jobs[id]).steps))throw Error('Select a job with steps');
 const steps=(record(jobs[id]).steps as unknown[]).map((value,i)=>{
  const step=record(value);return {...step,id:String(step.id??'step_'+(i+1)),name:String(step.name??step.uses??'Script '+(i+1)),...(step.with?{with:Object.fromEntries(Object.entries(record(step.with)).map(([k,v])=>[k,String(v)]))}:{})} as Step;
 });return {name:String(root.name??'Workflow'),steps,source,jobId:id};
}
export function jobIds(source:string):string[]{const doc=parseDocument(source);if(doc.errors.length)throw Error(doc.errors[0].message);return Object.entries(record(record(doc.toJS()).jobs)).filter(([,v])=>Array.isArray(record(v).steps)).map(([id])=>id);}
export function compile(model:Model):string{
 const steps=model.steps.map(({contract,...step})=>step);
 if(model.source&&model.jobId){const doc=parseDocument(model.source);if(doc.errors.length)throw Error(doc.errors[0].message);doc.set('name',model.name);doc.setIn(['jobs',model.jobId,'steps'],steps);return doc.toString();}
 return stringify({name:model.name,on:{workflow_dispatch:{}},jobs:{build:{'runs-on':'ubuntu-latest',steps}}});
}
export function connect(model:Model,source:string,output:string,target:string,input:string):Model{
 const a=model.steps.findIndex(s=>s.id===source),b=model.steps.findIndex(s=>s.id===target);
 if(a<0||b<=a)throw Error('Outputs must flow to later steps');
 if(!model.steps[a].contract?.outputs.some(p=>p.id===output)||!model.steps[b].contract?.inputs.some(p=>p.id===input))throw Error('Unknown port');
 return {...model,steps:model.steps.map(s=>s.id===target?{...s,with:{...s.with,[input]:'${{ steps.'+source+'.outputs.'+output+' }}'}}:s)};
}

export {searchActions,type ActionResult} from './discovery';
