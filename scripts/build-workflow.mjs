import {cp, mkdir, readFile, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
execFileSync('pnpm',['--filter','@code/workflow','build'],{stdio:'inherit'});
const html=await readFile('apps/workflow/dist/index.html','utf8');
if(!html.includes('Workflow Studio')||!html.includes('/workflow/assets/'))throw Error('Invalid Workflow Studio build');
const shellHtml=await readFile('dist/client/index.html','utf8');
if(!shellHtml.includes('<html'))throw Error('Shell client entrypoint missing');
await mkdir('dist/client/workflow',{recursive:true});
await rm('dist/client/workflow',{recursive:true,force:true});
await cp('apps/workflow/dist','dist/client/workflow',{recursive:true});

console.log('Workflow static entrypoint staged at dist/client/workflow/index.html');
