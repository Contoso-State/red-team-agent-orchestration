/** A finite config-only ARM read catalog; model output can select IDs, never commands. */
import { decide } from '../../guardrails/guard.mjs';
import { runAzAsync } from '../az/run-az.mjs';
const CATALOG={
 'microsoft.storage/storageaccounts':['2023-05-01','data','{id:id,publicNetworkAccess:properties.publicNetworkAccess,allowBlobPublicAccess:properties.allowBlobPublicAccess,minimumTlsVersion:properties.minimumTlsVersion,allowSharedKeyAccess:properties.allowSharedKeyAccess}'],
 'microsoft.keyvault/vaults':['2023-07-01','data','{id:id,publicNetworkAccess:properties.publicNetworkAccess,enableRbacAuthorization:properties.enableRbacAuthorization,enablePurgeProtection:properties.enablePurgeProtection,enableSoftDelete:properties.enableSoftDelete}'],
 'microsoft.web/sites':['2023-12-01','web','{id:id,httpsOnly:properties.httpsOnly,publicNetworkAccess:properties.publicNetworkAccess,kind:kind}'],
 'microsoft.containerregistry/registries':['2023-07-01','aks-container','{id:id,publicNetworkAccess:properties.publicNetworkAccess,adminUserEnabled:properties.adminUserEnabled,anonymousPullEnabled:properties.anonymousPullEnabled,sku:sku.name}'],
 'microsoft.containerservice/managedclusters':['2024-02-01','aks-container','{id:id,enableRBAC:properties.enableRBAC,disableLocalAccounts:properties.disableLocalAccounts,apiServerAccessProfile:properties.apiServerAccessProfile,azureRBAC:properties.aadProfile.enableAzureRBAC}'],
 'microsoft.network/networksecuritygroups':['2023-11-01','network','{id:id,rules:properties.securityRules[].{name:name,direction:properties.direction,access:properties.access,protocol:properties.protocol,source:properties.sourceAddressPrefix,sources:properties.sourceAddressPrefixes,destinationPort:properties.destinationPortRange,destinationPorts:properties.destinationPortRanges}}'],
 'microsoft.compute/virtualmachines':['2024-03-01','compute','{id:id,securityType:properties.securityProfile.securityType,secureBoot:properties.securityProfile.uefiSettings.secureBootEnabled,vTPM:properties.securityProfile.uefiSettings.vTpmEnabled}'],
 'microsoft.cognitiveservices/accounts':['2023-05-01','ai','{id:id,publicNetworkAccess:properties.publicNetworkAccess,disableLocalAuth:properties.disableLocalAuth,kind:kind}']
};
export function catalogFor(resources,domain){return resources.filter(r=>CATALOG[r.type?.toLowerCase()]?.[1]===domain).map(r=>({id:r.id,type:r.type}));}
export function descriptor(resource,scope){
 const entry=CATALOG[resource.type?.toLowerCase()];if(!entry||typeof resource.id!=='string'||!resource.id.toLowerCase().startsWith(`/subscriptions/${scope.subscriptionId.toLowerCase()}/resourcegroups/`)||/[?#\s]/.test(resource.id)||resource.id.split('/').some(part=>part==='.'||part==='..'||part.includes('%'))||!resource.id.toLowerCase().includes('/providers/'+resource.type.toLowerCase().split('/').join('/')))throw Error('Resource is not an authorized read descriptor');
 return ['rest','--method','GET','--url',`https://management.azure.com${resource.id}?api-version=${entry[0]}`,'--subscription',scope.subscriptionId,'--query',entry[2],'-o','json','--only-show-errors'];
}
export const shellWord=s=>/^[a-zA-Z0-9_./:@=-]+$/.test(s)?s:`'${s.replaceAll("'","'\\''")}'`;
export function createReadBroker({root,scope,azureConfigDir,emit,execute=runAzAsync}){
 const cache=new Map();
 return async(resource,{agent_id,fresh=false,signal}={})=>{
  const args=descriptor(resource,scope),key=resource.id.toLowerCase();if(!fresh&&cache.has(key)){emit({type:'tool.cached',agent_id,metrics:{cache_hits:1}});return cache.get(key);}
  const command=['az',...args].map(shellWord).join(' ');if(decide({command,cwd:root,toolName:'exec_command'}).decision!=='allow')throw Error('Shared guard denied config read');
  emit({type:'tool.allowed',agent_id,status:'running'});
  try{const result=await execute(args,{cwd:root,signal,timeoutMs:180000,maxBuffer:4000000,env:{...process.env,AZURE_CONFIG_DIR:azureConfigDir,AZURE_CORE_COLLECT_TELEMETRY:'no',AZURE_EXTENSION_USE_DYNAMIC_INSTALL:'no'}});if(!result.ok)throw Error('Azure read failed');const data=JSON.parse(result.stdout);if(data.id?.toLowerCase()!==key)throw Error('ARM response scope mismatch');const evidence={resource_id:resource.id,source:'Azure ARM GET (config projection)',collected_at:new Date().toISOString(),data};cache.set(key,evidence);emit({type:'tool.completed',agent_id,status:'completed',metrics:{azure_reads:1}});return evidence;}catch{emit({type:'tool.failed',agent_id,status:'failed'});throw Error('Guarded ARM configuration read failed; payload withheld');}
 };
}
