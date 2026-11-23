import { materialActivity } from '../../app/material-activity.ts';
import {
  studiesForReader,
  summaryFindingsRevision,
  summarySourcesMatch,
} from '../analysis/evidence.ts';
import type { createMembership } from '../auth/membership.ts';
import type { openDatabase } from '../db.ts';
import type { ExtensionContext, ServerExtension } from '../extension.ts';
import { keySlot as slotPattern, type modelKeyStore } from '../model-connections.ts';
import type { createProjectSharing } from '../project-sharing.ts';
import type { Person } from '../request-context.ts';
import type { Processor } from '../../app/types.ts';
import type { legacyFinding, reportOf } from '../analysis/review.ts';
import type { ProjectSnapshot } from './store.ts';
import type { StoredFinding, StoredModel } from './types.ts';

type ProjectViewer = Person | Parameters<ExtensionContext['view']>[0];

interface ProjectViewServices extends Pick<
  ReturnType<typeof createMembership>,
  'users' | 'userDirectory'
> {
  q: ReturnType<typeof openDatabase>['q'];
  getState: () => ProjectSnapshot;
  currentWs: () => string;
  getExtension: () => Pick<ServerExtension, 'stateFields' | 'studyFields'> | undefined;
  isBuiltin: (model: Pick<StoredModel, 'id' | 'builtin'>) => boolean;
  modelKeys: ReturnType<typeof modelKeyStore>;
  sharing: Pick<ReturnType<typeof createProjectSharing>, 'canManage'>;
  processors: () => Processor[];
  legacyFinding: typeof legacyFinding;
  reportOf: typeof reportOf;
}

export function createProjectView({
  q,
  getState,
  currentWs,
  getExtension,
  isBuiltin,
  modelKeys,
  sharing,
  users,
  userDirectory,
  processors,
  legacyFinding,
  reportOf,
}: ProjectViewServices) {
  // Only the active recording job owns a preview. Project reads still pass through view's access filters.
  const view = (person: ProjectViewer) => {
    const extension = getExtension();
    const { state: raw, version } = getState();
    const full = person.role === 'full';
    // Readers never receive drafts or rejected findings: not in the list, counters or any other field.
    const findings = raw.findings
      .map(legacyFinding)
      .filter((f) => full || f.status === 'verified')
      .map<StoredFinding>((f) => ({
        ...f,
        basis: reportOf(raw.studies.find((s) => s.id === f.studyId)) === 'ready' ? 'report' : 'raw',
      }));
    const pendingJobs = new Map(
      q<{ study_id: string; status: 'queued' | 'running' }>(
        "SELECT study_id,status FROM mnema_jobs WHERE workspace_id=? AND status IN ('queued','running') AND kind!='speakers'",
      )
        .all(currentWs())
        .map((job) => [job.study_id, job.status]),
    );
    const uploadSizes = new Map(
      q<{ id: string; size: number }>("SELECT id,size FROM mnema_uploads WHERE status='ready'")
        .all()
        .map((file) => [file.id, file.size]),
    );
    const studies = (full ? raw.studies : studiesForReader(raw.studies, findings)).map((s) => ({
      ...s,
      ...extension?.studyFields(s, raw, person, version),
      fileSize: s.fileId === undefined ? undefined : uploadSizes.get(s.fileId),
      processingState: pendingJobs.get(s.id),
      activity: materialActivity({ ...s, processingState: pendingJobs.get(s.id) }),
      ...(!full && s.summaryInfo?.review !== 'verified'
        ? { summary: [], summaryInfo: undefined }
        : {}),
      ...(!full ? { findingsInfo: undefined } : {}),
      report: reportOf(s),
      findings: findings.filter((f) => f.studyId === s.id && f.status === 'verified').length,
      drafts: full ? findings.filter((f) => f.studyId === s.id && f.status === 'draft').length : 0,
    }));
    let highlights = raw.highlights;
    if (!full && highlights?.length) {
      const visible = new Map<string, Set<string>>(
        studies.map((study) => [study.id, new Set(study.segments?.map((segment) => segment.id))]),
      );
      highlights = highlights.filter((highlight) =>
        visible.get(highlight.studyId)?.has(highlight.segmentId),
      );
    }
    // projectSummary is always present, so switching projects never keeps the previous project's summary on the client.
    const summary = raw.projectSummary;
    // A legacy overview does not record the findings sent to the model before a mask.
    const currentFindings =
      summary &&
      (Object.hasOwn(summary, 'reviewedRevision')
        ? summary.reviewedRevision === null ||
          summary.reviewedRevision === summaryFindingsRevision(findings)
        : !raw.studies.some((study) => 'redactionCount' in study && study.redactionCount));
    const canReadSummary =
      summary &&
      currentFindings &&
      summarySourcesMatch(
        full ? studiesForReader(raw.studies, findings) : studies,
        summary.sources,
      );
    const state = {
      ...raw,
      ...extension?.stateFields(raw, person),
      projectSummary: canReadSummary ? summary : null,
      ...(!full && raw.importSource
        ? {
            importSource: {
              provider: raw.importSource.provider,
              url: raw.importSource.url,
              importedAt: raw.importSource.importedAt,
            },
          }
        : {}),
      findings,
      studies,
      highlights,
    };
    return {
      version,
      state: {
        ...state,
        workspace: {
          id: currentWs(),
          ...q<{ name: string; created: number; creatorName: string | null }>(
            'SELECT w.name,w.created,u.name AS creatorName FROM mnema_workspaces w LEFT JOIN user u ON u.id=w.created_by WHERE w.id=?',
          ).get(currentWs()),
          profile: raw.projectProfile || {},
          canManageSharing: sharing.canManage(currentWs(), person.id),
          sharingMode: q<{ mode: string }>(
            'SELECT mode FROM mnema_project_sharing WHERE workspace_id=?',
          ).get(currentWs())?.mode,
        },
        models: state.models.map((m) => ({
          ...m,
          builtin: isBuiltin(m),
          hasStoredKey: modelKeys.has(currentWs(), m.id),
          keyConfigured:
            modelKeys.has(currentWs(), m.id) ||
            (slotPattern.test(m.keyRef || '') && Boolean(process.env[m.keyRef])),
        })),
        processors: processors(),
        users:
          'manageUsers' in person && person.manageUsers
            ? userDirectory(person)
            : sharing.canManage(currentWs(), person.id)
              ? users()
              : [],
      },
      user: person,
    };
  };
  return view;
}
