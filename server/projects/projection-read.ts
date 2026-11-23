import type { SQLInputValue } from 'node:sqlite';
import type { ProjectionRows } from './projection.ts';

type JsonObject = Record<string, unknown>;
type Change = [path: string[], value?: unknown];
export const workspaceReadMetaTable = 'mnema_workspace_read_meta';

const columns = (values: Record<string, SQLInputValue>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value != null));
const order = (index: number) => (a: SQLInputValue[], b: SQLInputValue[]) =>
  Number(a[index]) - Number(b[index]);

function collections(rows: ProjectionRows) {
  const studies = rows.mnema_studies.sort(order(1)).map(
    ([id, _seq, title, type, status, createdAt, updatedAt, meta]): JsonObject & {
      segments: JsonObject[];
    } => ({
      ...JSON.parse(String(meta)),
      ...columns({ id, title, type, status, createdAt, updatedAt }),
      segments: [],
      summary: [],
    }),
  );
  const studyById = new Map(studies.map((study) => [study.id, study]));
  for (const row of rows.mnema_segments.sort(order(1))) {
    const [studyId, _seq, id, speaker, time, end, text, uncertain, correctedText, meta] = row;
    studyById.get(studyId)?.segments.push({
      ...JSON.parse(String(meta)),
      ...columns({ id, speaker, time, end, text, correctedText }),
      ...(uncertain == null ? {} : { uncertain: Boolean(uncertain) }),
    });
  }
  let projectSummary: unknown;
  for (const row of rows.mnema_summaries) {
    const [scope, studyId, , , , body, meta] = row;
    if (scope === 'project') {
      projectSummary = JSON.parse(String(body));
      continue;
    }
    const study = studyById.get(studyId);
    if (!study) continue;
    study.summary = JSON.parse(String(body));
    const info: unknown = JSON.parse(String(meta));
    if (info != null) study.summaryInfo = info;
  }
  for (const [studyId, kind, status, attempts, nextAt, error, meta] of rows.mnema_analysis_jobs) {
    const study = studyById.get(studyId);
    if (!study) continue;
    study[kind === 'summary' ? 'summaryInfo' : 'findingsInfo'] = {
      ...JSON.parse(String(meta)),
      ...columns({ state: status, attempts, nextAt, error }),
    };
  }
  const findings = rows.mnema_findings
    .sort(order(1))
    .map(
      ([
        id,
        _seq,
        studyId,
        kind,
        status,
        title,
        description,
        createdAt,
        updatedAt,
        meta,
      ]): JsonObject & { evidence?: SQLInputValue[] } => ({
        ...JSON.parse(String(meta)),
        ...columns({ id, studyId, kind, status, title, description, createdAt, updatedAt }),
      }),
    );
  const findingById = new Map(findings.map((finding) => [finding.id, finding]));
  for (const [findingId, seq, segmentId] of rows.mnema_finding_evidence.sort(order(1))) {
    const finding = findingById.get(findingId);
    if (!finding) continue;
    if (seq === 0) finding.segmentId = segmentId;
    else (finding.evidence ??= [])[Number(seq) - 1] = segmentId;
  }
  const highlights = rows.mnema_highlights
    .sort(order(1))
    .map(([id, _seq, studyId, segmentId, text, meta]) => ({
      ...JSON.parse(String(meta)),
      ...columns({ id, studyId, segmentId, text }),
    }));
  return { studies, findings, highlights, projectSummary };
}

function differences(actual: unknown, original: unknown, path: string[], result: Change[]) {
  if (actual === original) return;
  if (
    actual &&
    original &&
    typeof actual === 'object' &&
    typeof original === 'object' &&
    Array.isArray(actual) === Array.isArray(original) &&
    (!Array.isArray(actual) || (Array.isArray(original) && actual.length === original.length))
  ) {
    const projected = actual as JsonObject;
    const source = original as JsonObject;
    for (const key of Object.keys(original))
      if (Object.hasOwn(actual, key))
        differences(projected[key], source[key], [...path, key], result);
      else result.push([[...path, key], source[key]]);
    for (const key of Object.keys(actual))
      if (!Object.hasOwn(original, key)) result.push([[...path, key]]);
  } else result.push([path, original]);
}

// Legacy absent/null fields and metadata outside the seven projection tables must round-trip.
// Keep these details separately so the 7.2 image can still compare and write the original projection.
export function encodeWorkspaceReadMeta(source: JsonObject, rows: ProjectionRows) {
  const { studies, findings, highlights, projectSummary, ...base } = source;
  const projected = Object.fromEntries(
    Object.entries(collections(rows)).filter(([, value]) => value !== undefined),
  );
  const complete = { ...base, ...projected };
  const restore: Change[] = [];
  differences(complete, source, [], restore);
  return JSON.stringify({ base, restore });
}

export function decodeWorkspaceProjection(meta: string, rows: ProjectionRows): JsonObject {
  const { base, restore } = JSON.parse(meta) as { base: JsonObject; restore: Change[] };
  const state = {
    ...base,
    ...Object.fromEntries(
      Object.entries(collections(rows)).filter(([, value]) => value !== undefined),
    ),
  };
  for (const change of restore) {
    const [path, value] = change;
    const key = path.at(-1);
    let target: JsonObject = state;
    for (const parent of path.slice(0, -1)) {
      const child = target[parent];
      if (!Object.hasOwn(target, parent) || child === null || typeof child !== 'object')
        throw new Error('Invalid workspace read metadata');
      target = child as JsonObject;
    }
    if (!key) throw new Error('Invalid workspace read metadata');
    if (change.length === 1) delete target[key];
    else
      Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  return state;
}
