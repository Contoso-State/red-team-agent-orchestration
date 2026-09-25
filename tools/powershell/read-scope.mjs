// Strict template-compatible YAML subset. Unsupported syntax fails closed.
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
// Canonical scope aliases for the live graph's unconditional read-only specialists.
// Active lanes and the gated M365 specialist are not supported by this scope loader.
const supportedDomains = new Set([
  'identity-posture', 'network-exposure', 'compute-platform', 'aks-container',
  'data-protection', 'web-exposure', 'ai-foundry', 'attack-surface',
  'logging-coverage', 'governance-posture', 'devops-supplychain'
]);
export function parseScope(text) {
  if (text.trimStart().startsWith('{')) return JSON.parse(text);
  const lines = text.split(/\r?\n/).flatMap((raw) => {
    if (/\t/.test(raw)) throw Error('Tabs are unsupported in scope YAML');
    let quote = '', line = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (quote) { line += c; if (c === quote && raw[i - 1] !== '\\') quote = ''; }
      else if (c === '"' || c === "'") { quote = c; line += c; }
      else if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) break;
      else line += c;
    }
    if (quote) throw Error('Unclosed YAML quote');
    if (!line.trim()) return [];
    return [{ indent: line.length - line.trimStart().length, value: line.trim() }];
  });
  const scalar = (s) => {
    if (s === '[]') return [];
    if (s === '{}') return {};
    if (s.startsWith('"')) return JSON.parse(s);
    if (/^'[^']*'$/.test(s)) return s.slice(1, -1);
    if (/^(true|false)$/.test(s)) return s === 'true';
    if (/^\d+$/.test(s)) return Number(s);
    if (!s || /^[!&*>{[|]/.test(s) || /:\s/.test(s)) throw Error(`Unsupported YAML scalar: ${s}`);
    return s;
  };
  let i = 0;
  function block(indent) {
    const array = lines[i].value.startsWith('- ');
    const out = array ? [] : {};
    function pair(obj, value, childIndent) {
      const match = value.match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
      if (!match || Object.hasOwn(obj, match[1])) throw Error('Invalid or duplicate YAML key');
      const [, key, tail] = match;
      obj[key] = tail !== undefined ? scalar(tail) :
        (i < lines.length && lines[i].indent > childIndent ? block(lines[i].indent) : null);
    }
    while (i < lines.length && lines[i].indent === indent) {
      const value = lines[i++].value;
      if (array) {
        if (!value.startsWith('- ')) throw Error('Mixed YAML collection');
        const rest = value.slice(2);
        if (/^[A-Za-z_][\w-]*:/.test(rest)) {
          const obj = {}; pair(obj, rest, indent + 2);
          while (i < lines.length && lines[i].indent === indent + 2) pair(obj, lines[i++].value, indent + 2);
          out.push(obj);
        } else out.push(scalar(rest));
      } else pair(out, value, indent);
      if (i < lines.length && lines[i].indent > indent) throw Error('Unsupported YAML indentation');
    }
    return out;
  }
  if (!lines.length || lines[0].indent !== 0) throw Error('Invalid scope document');
  const result = block(0);
  if (i !== lines.length) throw Error('Unparsed scope content');
  return result;
}
export function validateScope(doc) {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const scope = doc?.scope;
  if (!['read-only-assessment', 'attack-path-analysis'].includes(doc?.mode)) throw Error('Only read-only scope modes supported');
  if (!guid.test(scope?.tenant_id || '') || !Array.isArray(scope?.subscriptions) || scope.subscriptions.length !== 1 || !guid.test(scope.subscriptions[0]?.id || '')) throw Error('Scope requires one explicit GUID subscription and tenant');
  const sub = scope.subscriptions[0];
  if (sub.resource_groups !== undefined && !(Array.isArray(sub.resource_groups) && sub.resource_groups.length === 1 && sub.resource_groups[0] === '*')) throw Error('Narrowed resource groups unsupported by this exporter');
  if (scope.resource_types !== undefined && !(Array.isArray(scope.resource_types) && scope.resource_types.length === 0)) throw Error('Narrowed resource types unsupported by this exporter');
  if (scope.domains !== undefined && (!Array.isArray(scope.domains) || scope.domains.some(domain => !supportedDomains.has(domain)))) throw Error('Invalid or unsupported assessment domains');
  if (scope.exclusions !== undefined) {
    if (!scope.exclusions || Array.isArray(scope.exclusions) || typeof scope.exclusions !== 'object') throw Error('Invalid scope exclusions');
    for (const value of Object.values(scope.exclusions)) if (!Array.isArray(value) || value.length) throw Error('Scope exclusions unsupported by this exporter');
  }
  for (const key of ['required_roles', 'optional_roles']) if (doc.caller?.[key] !== undefined && (!Array.isArray(doc.caller[key]) || doc.caller[key].some(r => typeof r !== 'string' || !r))) throw Error('Invalid caller role requirements');
  return { tenantId: scope.tenant_id, subscriptionId: sub.id, domains: [...(scope.domains ?? [])], requiredRoles: doc.caller?.required_roles ?? ['Reader', 'Security Reader'], optionalRoles: doc.caller?.optional_roles ?? [] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { console.log(JSON.stringify(validateScope(parseScope(readFileSync(process.argv[2], 'utf8'))))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
