import { createHash } from 'node:crypto';
import type { Finding, Study } from '../../app/types.ts';

export function studiesForReader(
  studies: (Study & { importSource?: { catalog?: boolean } })[],
  findings: Finding[],
) {
  const segmentsByStudy = new Map<string, Set<string>>();
  for (const finding of findings) {
    if (finding.status !== 'verified') continue;
    const segments = segmentsByStudy.get(finding.studyId) || new Set<string>();
    segments.add(finding.segmentId);
    segmentsByStudy.set(finding.studyId, segments);
  }
  return studies.flatMap((study) => {
    if (!study.importSource?.catalog) return [study];
    const visible = segmentsByStudy.get(study.id),
      segments = study.segments?.filter((segment) => visible?.has(segment.id)) || [];
    return segments.length ? [{ ...study, segments }] : [];
  });
}

export function summarySourcesMatch(
  studies: Study[],
  sources: { studyId: string; segmentId: string; text: string }[],
) {
  return Boolean(
    Array.isArray(sources) &&
    sources.length &&
    sources.every((source) => {
      const study = studies.find((item) => item.id === source.studyId && item.status === 'ready');
      const segment = study?.segments?.find((item) => item.id === source.segmentId);
      return segment && (segment.correctedText ?? segment.text) === source.text;
    }),
  );
}

export function summaryFindingsRevision(findings: Finding[]) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        findings
          .filter((finding) => finding.status === 'verified')
          .map((finding) => [
            finding.id,
            finding.title,
            finding.kind,
            finding.importance,
            finding.origin,
            finding.studyId,
            finding.segmentId,
            finding.evidence,
          ]),
      ),
    )
    .digest('hex');
}
