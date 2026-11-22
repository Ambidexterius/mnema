import { readWorkspaceProjection } from '../server/projects/projection-audit.ts';
import { projectionTotals } from '../server/projects/projection.ts';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/check-workspace-projection.mjs PATH_TO_SQLITE');
const report = readWorkspaceProjection(file);
console.log(JSON.stringify({ ...report, totals: projectionTotals(report) }, null, 2));
process.exitCode = report.ok ? 0 : 1;
