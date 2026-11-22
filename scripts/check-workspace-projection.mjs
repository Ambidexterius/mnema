import { DatabaseSync } from 'node:sqlite';
import { compareWorkspaceProjection, projectionTotals } from '../server/projects/projection.ts';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/check-workspace-projection.mjs PATH_TO_SQLITE');
const db = new DatabaseSync(file, { readOnly: true });
try {
  db.exec('BEGIN');
  const report = compareWorkspaceProjection(db);
  console.log(JSON.stringify({ ...report, totals: projectionTotals(report) }, null, 2));
  process.exitCode = report.ok ? 0 : 1;
} finally {
  db.close();
}
