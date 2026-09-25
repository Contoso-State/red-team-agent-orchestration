/** Render the live run's canonical findings without inventing attack-path topology. */
import { join } from 'node:path';
import { runProcess } from './native-model.mjs';

export async function renderLiveReport({ root, sessionDir, engagementFile, signal }) {
  const findings = join(sessionDir, 'reports/findings.json');
  await runProcess(process.execPath, [join(root, 'tools/validate-findings.mjs'),
    '--findings', findings], { cwd: root, signal });
  const output = 'reports/report.html';
  await runProcess(process.execPath, [join(root, 'tools/report/generate-report.mjs'),
    '--findings', findings, '--engagement', engagementFile,
    '--title', 'Bounded live configuration assessment — coverage incomplete',
    '--out', join(sessionDir, output)], { cwd: root, signal });
  return output;
}
