import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function backendBuildId(
  directory: URL,
  version: string,
  dependencies: Record<string, unknown>,
  includePrivate: boolean,
) {
  const root = fileURLToPath(directory);
  const hash = createHash('sha256').update(
    JSON.stringify({
      version,
      dependencies: Object.fromEntries(
        Object.entries(dependencies).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    }),
  );
  const sources = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'),
    )
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((path) => includePrivate || !path.startsWith('private/'))
    .sort();

  for (const path of sources) {
    hash
      .update(path)
      .update('\0')
      .update(readFileSync(join(root, path)));
  }
  return hash.digest('hex').slice(0, 16);
}
