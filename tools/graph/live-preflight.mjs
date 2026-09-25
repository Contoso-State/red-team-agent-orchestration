/** Scoped host preflight. Native models never receive credentials or executable tools. */
import {readFileSync,writeFileSync,mkdirSync,realpathSync,existsSync,unlinkSync,appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runAz} from '../az/run-az.mjs';
import {parseScope,validateScope} from '../powershell/read-scope.mjs';
import {decide} from '../../guardrails/guard.mjs';
import {runProcess} from './native-model.mjs';
import {shellWord} from './live-broker.mjs';
import {isWithinDirectory} from './live-paths.mjs';
const self=fileURLToPath(import.meta.url);
const read=p=>JSON.parse(readFileSync(p,'utf8'));
function guardArgs(args,scope){
 const flag=args.includes('--subscriptions')?'--subscriptions':'--subscription';
 if(args.filter(x=>x===flag).length!==1||args[args.indexOf(flag)+1]!==scope.subscriptionId)throw Error('Explicit scope required');
 const prefix=args.slice(0,3).join(' ');
 if(!['account show --subscription','account get-access-token --subscription','rest --method GET','role assignment list','graph query -q'].includes(prefix))throw Error('Unsupported preflight read');
 if(args[0]==='rest'&&args[args.indexOf('--url')+1]!=='https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName')throw Error('Unsupported identity endpoint');
 if(args[0]==='graph'){
  const at=args.indexOf('-q')+1,expected='Resources | project id, name, type, resourceGroup, subscriptionId, location, kind, tags | order by type asc';
  if(args[at]!==expected)throw Error('Unsupported inventory query');
  args[at]=expected.replace(', tags','');
 }
 return args;
}
export function runPreflightRead(config,inputArgs,{execute=runAz}={}){
 const scope=validateScope(parseScope(readFileSync(config.engagementFile,'utf8'))),args=guardArgs([...inputArgs],scope);
 const command=['az',...args].map(shellWord).join(' '),decision=decide({command,cwd:config.sessionDir,toolName:'exec_command'});
 appendFileSync(config.audit,JSON.stringify({at:new Date().toISOString(),operation:args.slice(0,3),decision:decision.decision})+'\n',{mode:0o600});
 if(decision.decision!=='allow')throw Error('Shared guard denied preflight read');
 try{
  const result=execute(args,{cwd:config.sessionDir,env:{...process.env,AZURE_CONFIG_DIR:config.azureConfigDir,AZURE_CORE_COLLECT_TELEMETRY:'no',AZURE_EXTENSION_USE_DYNAMIC_INSTALL:'no'},maxBuffer:20000000,timeoutMs:120000});
  if(!result.ok)throw Error('Azure read failed');
  return result.stdout;
 }catch{throw Error('Guarded preflight Azure read failed; payload withheld');}
}
// PowerShell resolves this scoped function before an external az executable. It
// works on Windows too, without a .cmd file, a shell trampoline, or PATH changes.
export const PREFLIGHT_POWERSHELL_WRAPPER=`param([string]$ScriptPath, [string]$EngagementFile, [string]$SessionPath)
$ErrorActionPreference = 'Stop'
function global:az {
    & $env:REDTEAM_NODE_EXECUTABLE $env:REDTEAM_PREFLIGHT_SHIM '--az-shim' @args
    $global:LASTEXITCODE = $LASTEXITCODE
}
& $ScriptPath -EngagementFile $EngagementFile -SessionPath $SessionPath
`;
function shim(){
 try{
  process.stdout.write(runPreflightRead(read(process.env.REDTEAM_PREFLIGHT_CONFIG),process.argv.slice(3)));
 }catch{process.stderr.write('Guarded preflight Azure read failed; payload withheld\n');process.exitCode=2;}
}
export async function runLivePreflight({root,sessionDir,engagementFile,azureConfigDir,emit=()=>{},execute=runProcess,signal}){
 signal?.throwIfAborted();
 root=realpathSync(root);sessionDir=realpathSync(sessionDir);engagementFile=realpathSync(engagementFile);azureConfigDir=realpathSync(azureConfigDir);
 if(!isWithinDirectory(join(root,'engagements'),sessionDir)||!isWithinDirectory(sessionDir,azureConfigDir)||!isWithinDirectory(sessionDir,engagementFile))throw Error('Isolated session paths required');
 const doc=parseScope(readFileSync(engagementFile,'utf8')),scope=validateScope(doc),manifest=read(join(sessionDir,'evidence/preflight-manifest.json')),age=Date.now()-Date.parse(manifest.verifiedAt);
 if(manifest.status!=='passed'||manifest.readerEquivalent!==true||!Number.isFinite(age)||age<0||age>3600000||manifest.tenantId!==scope.tenantId||manifest.subscriptionId!==scope.subscriptionId||realpathSync(manifest.azureConfigDir)!==azureConfigDir||realpathSync(manifest.scopeFile)!==engagementFile||!manifest.accountName||manifest.accountName.toLowerCase()!==doc.engagement?.authorized_by?.toLowerCase())throw Error('Fresh exact-identity scope manifest required');
 const bin=join(sessionDir,'evidence/preflight-bin');mkdirSync(bin,{recursive:true,mode:0o700});
 const configFile=join(bin,'config.json'),audit=join(sessionDir,'evidence/preflight-host-audit.jsonl');
 writeFileSync(configFile,JSON.stringify({sessionDir,engagementFile,azureConfigDir,audit}),{mode:0o600});
 const wrapper=join(bin,'Invoke-GuardedPreflight.ps1');writeFileSync(wrapper,PREFLIGHT_POWERSHELL_WRAPPER,{mode:0o600});
 const env={...process.env,AZURE_CONFIG_DIR:azureConfigDir,AZURE_CORE_COLLECT_TELEMETRY:'no',AZURE_EXTENSION_USE_DYNAMIC_INSTALL:'no',REDTEAM_PREFLIGHT_CONFIG:configFile,REDTEAM_SESSION:sessionDir,REDTEAM_NODE_EXECUTABLE:process.execPath,REDTEAM_PREFLIGHT_SHIM:self};
 const run=async(file,args,options)=>{signal?.throwIfAborted();const output=await execute(file,args,{...options,signal,processTree:true});signal?.throwIfAborted();return output;};
 const azRead=async args=>JSON.parse(await run(process.execPath,[self,'--az-shim',...args],{cwd:root,env,timeout:180000,maxBytes:4000000}));
 writeFileSync(join(sessionDir,'evidence/preflight-manifest.json'),JSON.stringify({...manifest,status:'running',hostPreflightPassed:false},null,2),{mode:0o600});
 emit({type:'preflight.started',agent_id:'inventory-scope',status:'running'});
 const account=await azRead(['account','show','--subscription',scope.subscriptionId,'--output','json']);
 const me=await azRead(['rest','--method','GET','--url','https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName','--subscription',scope.subscriptionId,'--output','json']);
 if(account.id!==scope.subscriptionId||account.tenantId!==scope.tenantId||account.state!=='Enabled'||account.user?.name?.toLowerCase()!==manifest.accountName.toLowerCase()||me.userPrincipalName?.toLowerCase()!==manifest.accountName.toLowerCase()||me.id!==manifest.objectId)throw Error('Fresh Azure caller/scope mismatch');
 const marker=join(root,'engagements/.current-session'),previous=existsSync(marker)?readFileSync(marker):null;
 try{
  for(const script of ['Invoke-Preflight.ps1','Export-Inventory.ps1'])await run('pwsh',['-NoProfile','-File',wrapper,'-ScriptPath',join(root,'tools/powershell',script),'-EngagementFile',engagementFile,'-SessionPath',sessionDir],{cwd:root,env,timeout:300000,maxBytes:2000000});
 }finally{if(previous!==null)writeFileSync(marker,previous);else if(existsSync(marker))unlinkSync(marker);}
 signal?.throwIfAborted();
 const inventoryRef=join(sessionDir,'inventory/resources.json'),resources=read(inventoryRef),seen=new Set();
 if(!Array.isArray(resources))throw Error('Invalid inventory');
 for(const r of resources){const id=r.id?.toLowerCase();if(r.subscriptionId!==scope.subscriptionId||!id?.startsWith(`/subscriptions/${scope.subscriptionId.toLowerCase()}/`)||seen.has(id)||Object.hasOwn(r,'tags'))throw Error('Inventory scope, uniqueness or projection validation failed');seen.add(id);}
 writeFileSync(join(sessionDir,'evidence/preflight-manifest.json'),JSON.stringify({...manifest,status:'passed',verifiedAt:new Date().toISOString(),hostPreflightPassed:true,resourceCount:resources.length},null,2),{mode:0o600});
 emit({type:'preflight.completed',agent_id:'inventory-scope',status:'completed',metrics:{resources:resources.length}});
 return {resources,inventoryRef,scope};
}
if(process.argv[2]==='--az-shim'&&process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)shim();
