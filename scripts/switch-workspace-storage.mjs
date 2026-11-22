import { DatabaseSync } from 'node:sqlite';
import {
  initializeWorkspaceProjection,
  projectionTotals,
  workspaceTablesOnly,
} from '../server/projects/projection.ts';

const [path, command] = process.argv.slice(2);
if (!path || !['mode', 'dual', 'tables'].includes(command))
  throw new Error(
    'Usage: node scripts/switch-workspace-storage.mjs PATH_TO_SQLITE mode|dual|tables',
  );
const db = new DatabaseSync(path, { readOnly: command === 'mode' });
try {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  if (command === 'mode') console.log(workspaceTablesOnly(db) ? 'tables' : 'dual');
  else {
    const result = initializeWorkspaceProjection(db, command);
    console.info(
      'Workspace storage verified',
      JSON.stringify({
        mode: result.tablesOnly ? 'tables' : 'dual',
        elapsedMs: result.elapsedMs,
        ...projectionTotals(result.report),
      }),
    );
  }
} finally {
  db.close();
}
