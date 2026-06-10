#!/usr/bin/env node
/**
 * make-scale-fixtures.mjs — generate deterministic large-scale test fixtures.
 *
 * Produces synthetic (NON-LIVE, all-zero subscription IDs) artifacts that exercise the
 * scale behaviors described in knowledge/scaling.md:
 *
 *   - findings.scale.json      An AGGREGATED finding whose affected_resources[] exceeds the
 *                              ARG 1,000-row page cap (the ">1,000-row paged check" case),
 *                              plus a normal N=1 finding and an aggregated attack-path finding.
 *   - attack-paths.scale.json  A non-linear path whose nodes reference a SPECIFIC affected
 *                              instance of an aggregated finding (the instance-ref case), so
 *                              the validator's affected_resources[] cross-check is exercised.
 *
 * Deterministic: same output every run, safe to commit. No Azure calls. No live data.
 *
 * Usage:  node tools/report/sample/scale/make-scale-fixtures.mjs
 * Output is written next to this script.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const SUB = '00000000-0000-0000-0000-000000000000';
const NOW = '2026-06-10T00:00:00Z';
const N_PUBLIC_BLOB = 1200; // intentionally > the ARG 1,000-row page cap

function pad(n, width = 4) {
  return String(n).padStart(width, '0');
}

function storageInstance(i) {
  const rg = `rg-data-${pad((i % 12) + 1, 2)}`;
  const name = `stscale${pad(i)}`;
  return {
    resource_id: `/subscriptions/${SUB}/resourceGroups/${rg}/providers/Microsoft.Storage/storageAccounts/${name}`,
    subscription_id: SUB,
    resource_group: rg,
    type: 'microsoft.storage/storageaccounts',
    region: i % 2 ? 'eastus' : 'westus2',
    name,
  };
}

const publicBlobInstances = Array.from({ length: N_PUBLIC_BLOB }, (_, i) => storageInstance(i));

// Representative = the first (and, by convention, most-exposed) affected instance.
const publicBlobRepresentative = publicBlobInstances[0];

const findings = [
  {
    id: 'AZ-STOR-001',
    title: `Public blob access enabled on ${N_PUBLIC_BLOB} storage accounts`,
    severity: 'High',
    confidence: 'High',
    agent: 'data-protection',
    category: 'Storage',
    check_id: 'CHK-STOR-PUBLIC-BLOB',
    finding_class: 'storage-public-blob',
    dedupe_key: `storage-public-blob:${SUB}`,
    resource_id: publicBlobRepresentative.resource_id,
    subscription_id: SUB,
    resource_group: publicBlobRepresentative.resource_group,
    region: publicBlobRepresentative.region,
    description:
      `${N_PUBLIC_BLOB} storage accounts in this subscription allow public blob access. This is one ` +
      'aggregated finding (one finding class, many affected instances), not one finding per account.',
    attack_vector: 'Anonymous enumeration of public containers -> unauthenticated data read.',
    risk: 'Bulk data exposure across the estate; trivially discoverable by automated scanners.',
    recommendation:
      "Set 'allowBlobPublicAccess' = false at the account level and audit container ACLs. Apply via " +
      'Azure Policy to prevent regression across all current and future accounts.',
    evidence: [
      { source: 'Azure Resource Graph', summary: `${N_PUBLIC_BLOB} accounts returned where properties.allowBlobPublicAccess == true (paged, >1,000 rows).` },
      { source: 'Azure Resource Graph', summary: `Representative: ${publicBlobRepresentative.name} (${publicBlobRepresentative.region}) allows public blob access.` },
      { source: 'Azure Resource Graph', summary: `Representative: ${publicBlobInstances[1].name} allows public blob access.` },
    ],
    affected_resources: publicBlobInstances,
    controls: {
      cis_azure: ['CIS 3.7'],
      mitre: ['T1530'],
      defender_for_cloud: ['Storage account public access should be disallowed'],
    },
    status: 'open',
    first_seen: NOW,
    last_seen: NOW,
  },
  {
    id: 'AZ-NET-001',
    title: 'Management port (RDP 3389) open to the internet',
    severity: 'Critical',
    confidence: 'High',
    agent: 'network-exposure',
    category: 'Network',
    check_id: 'CHK-NET-MGMT-PORT-INTERNET',
    finding_class: 'nsg-mgmt-port-internet',
    dedupe_key: `nsg-mgmt-port-internet:${SUB}`,
    resource_id: `/subscriptions/${SUB}/resourceGroups/rg-edge/providers/Microsoft.Network/networkSecurityGroups/nsg-jump`,
    subscription_id: SUB,
    resource_group: 'rg-edge',
    region: 'eastus',
    description: 'An NSG permits inbound RDP from 0.0.0.0/0 to a jump host. Single-instance (N=1) finding.',
    attack_vector: 'Internet RDP brute force -> initial access on the jump host.',
    risk: 'Direct foothold into the management network.',
    recommendation: 'Restrict the rule source to a bastion/known admin range or move to Azure Bastion.',
    evidence: [
      { source: 'Azure Resource Graph', summary: 'nsg-jump rule allows Inbound Allow 3389 from source *.' },
    ],
    affected_resources: [
      {
        resource_id: `/subscriptions/${SUB}/resourceGroups/rg-edge/providers/Microsoft.Network/networkSecurityGroups/nsg-jump`,
        subscription_id: SUB,
        resource_group: 'rg-edge',
        type: 'microsoft.network/networksecuritygroups',
        region: 'eastus',
        name: 'nsg-jump',
      },
    ],
    status: 'open',
    first_seen: NOW,
    last_seen: NOW,
  },
  {
    id: 'AZ-PATH-001',
    title: 'Public storage exfil pivots to a privileged identity',
    severity: 'Critical',
    confidence: 'Medium',
    agent: 'authorization-attack-path',
    category: 'Attack Path',
    finding_class: 'public-storage-to-privileged-identity',
    resource_id: `/subscriptions/${SUB}/resourceGroups/rg-edge/providers/Microsoft.Network/networkSecurityGroups/nsg-jump`,
    subscription_id: SUB,
    resource_group: 'rg-edge',
    region: 'eastus',
    description:
      'A specific public storage account (one instance of the aggregated AZ-STOR-001 finding) leaks ' +
      'a deployment credential that maps to a privileged identity, chaining to a Critical end state.',
    attack_vector: 'Public blob read -> leaked credential -> privileged role -> subscription control.',
    risk: 'Aggregated-finding instance becomes the entry point of a Critical chain.',
    recommendation: 'Disable public access on the named account first; rotate the leaked credential.',
    evidence: [
      { source: 'Azure Resource Graph', summary: `Path entry uses the specific account ${storageInstance(7).name}, an instance of AZ-STOR-001.` },
    ],
    attack_path: [
      `Public storage account (${storageInstance(7).name})`,
      'Leaked deployment credential in a public container',
      'Privileged service principal',
      'Subscription control',
    ],
    status: 'confirmed',
    first_seen: NOW,
    last_seen: NOW,
  },
];

// Attack-path graph: a node references a SPECIFIC affected instance of the aggregated finding.
const exfilInstance = storageInstance(7);
const attackPaths = {
  generated: NOW,
  paths: [
    {
      id: 'AZ-PATH-001',
      title: 'Public storage exfil pivots to a privileged identity',
      severity: 'Critical',
      entry: 'n1',
      end_state: 'n4',
      finding_id: 'AZ-PATH-001',
      break_chain: 'Disable public blob access (AZ-STOR-001) and rotate the leaked credential.',
      nodes: [
        {
          id: 'n1',
          label: `Public storage: ${exfilInstance.name}`,
          type: 'entry',
          // resource_id MUST be one of AZ-STOR-001.affected_resources[] (instance-ref invariant)
          resource_id: exfilInstance.resource_id,
          finding_id: 'AZ-STOR-001',
        },
        { id: 'n2', label: 'Leaked deployment credential', type: 'pivot' },
        { id: 'n3', label: 'Privileged service principal', type: 'pivot' },
        { id: 'n4', label: 'Subscription control', type: 'target' },
      ],
      edges: [
        { from: 'n1', to: 'n2', label: 'anonymous blob read', technique: 'T1530', finding_id: 'AZ-STOR-001' },
        { from: 'n2', to: 'n3', label: 'credential reuse', technique: 'T1078.004' },
        { from: 'n3', to: 'n4', label: 'privileged role', technique: 'T1098' },
      ],
    },
  ],
};

writeFileSync(join(OUT_DIR, 'findings.scale.json'), JSON.stringify({ findings }, null, 2) + '\n');
writeFileSync(join(OUT_DIR, 'attack-paths.scale.json'), JSON.stringify(attackPaths, null, 2) + '\n');

console.error(
  `Wrote scale fixtures to ${OUT_DIR}: ` +
    `findings.scale.json (${findings.length} findings, AZ-STOR-001 has ${N_PUBLIC_BLOB} affected resources), ` +
    'attack-paths.scale.json (1 path, instance-ref node).'
);
