import { allCheckpoints, findCheckpoint, type CourseProject, type LessonStep } from './models';

export type MasteryLevel = '掌握' | '未掌握';
export type RecordSyncStatus = 'pending' | 'synced' | 'suspended' | 'failed';

export interface Student {
  id: string;
  name: string;
  note: string;
  createdAt: string;
}

export interface MasteryRecord {
  id: string;
  studentId: string;
  stepId: string;
  checkpointId: string;
  checkpointTitle: string;
  checkpointTime: number;
  level: MasteryLevel;
  recordedAt: string;
  recordedBy: string;
  syncStatus: RecordSyncStatus;
  failCount: number;
  lastError: string;
  suspendReason: string;
  invalidated: boolean;
  invalidatedAt: string;
  migrated: boolean;
}

export interface CompletionConclusion {
  id: string;
  studentId: string;
  courseId: string;
  courseTitle: string;
  conclusion: '已结业';
  issuedAt: string;
  issuedBy: string;
  stepsCompleted: number;
  checkpointsCompleted: number;
}

export interface UnmatchedRecord {
  id: string;
  rawTitle: string;
  rawStepTitle: string;
  rawStudentName: string;
  reason: string;
  recordedAt: string;
}

export interface LearningArchive {
  id: string;
  students: Student[];
  records: MasteryRecord[];
  conclusions: CompletionConclusion[];
  unmatched: UnmatchedRecord[];
  lastReconciledAt: string;
  revision: number;
}

export interface RemoteArchive {
  id: string;
  roster: Student[];
  records: MasteryRecord[];
  conclusions: CompletionConclusion[];
}

export const ARCHIVE_STORAGE_KEY = 'sologsb-1012-learning-archive-v1';
export const REMOTE_STORAGE_KEY = 'sologsb-1012-archive-remote-v1';

const SEED_NOW = '2026-09-01T00:00:00.000Z';

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function seedRecord(
  id: string,
  studentId: string,
  stepId: string,
  checkpointId: string,
  checkpointTitle: string,
  checkpointTime: number,
  level: MasteryLevel,
  syncStatus: RecordSyncStatus,
): MasteryRecord {
  return {
    id,
    studentId,
    stepId,
    checkpointId,
    checkpointTitle,
    checkpointTime,
    level,
    recordedAt: SEED_NOW,
    recordedBy: '陈老师',
    syncStatus,
    failCount: 0,
    lastError: '',
    suspendReason: '',
    invalidated: false,
    invalidatedAt: '',
    migrated: false,
  };
}

export function createArchive(): LearningArchive {
  const students: Student[] = [
    { id: 'stu-wxm', name: '王小明', note: '', createdAt: SEED_NOW },
    { id: 'stu-lxh', name: '李小红', note: '', createdAt: SEED_NOW },
    { id: 'stu-zxg', name: '张小刚', note: '', createdAt: SEED_NOW },
    { id: 'stu-cxy', name: '陈小雨', note: '本学期新加入', createdAt: SEED_NOW },
  ];
  const records: MasteryRecord[] = [
    seedRecord('rec-1', 'stu-wxm', 'step-1-1', 'step-1-1-cp1', '抬手起势', 4, '掌握', 'synced'),
    seedRecord('rec-2', 'stu-lxh', 'step-1-1', 'step-1-1-cp2', '掌心前送', 16, '掌握', 'pending'),
    seedRecord('rec-3', 'stu-zxg', 'step-1-2', 'step-1-2-cp1', '起手定位', 6, '未掌握', 'pending'),
    seedRecord('rec-4', 'stu-cxy', 'step-1-1', 'step-1-1-cp1', '抬手起势', 4, '掌握', 'pending'),
    seedRecord('rec-5', 'stu-wxm', 'step-1-1', 'step-1-1-cp2', '掌心前送', 99, '掌握', 'synced'),
    seedRecord('rec-6', 'stu-zxg', 'step-1-1', 'step-1-1-cp1', '抬手起势', 10, '掌握', 'synced'),
    // 旧数据：缺检查点编号，升级时按标题回填
    { ...seedRecord('rec-7', 'stu-wxm', 'step-1-1', '', '抬手起势', 0, '掌握', 'synced'), checkpointId: '' },
    { ...seedRecord('rec-8', 'stu-lxh', '', '', '转身收势', 0, '掌握', 'synced'), stepId: '', checkpointId: '' },
  ];
  const conclusions: CompletionConclusion[] = [
    {
      id: 'concl-1',
      studentId: 'stu-wxm',
      courseId: 'sign-course-project',
      courseTitle: '零基础手语 · 问候与数量',
      conclusion: '已结业',
      issuedAt: SEED_NOW,
      issuedBy: '陈老师',
      stepsCompleted: 5,
      checkpointsCompleted: 14,
    },
  ];
  return {
    id: 'archive-local',
    students,
    records,
    conclusions,
    unmatched: [],
    lastReconciledAt: '',
    revision: 1,
  };
}

export function createRemoteArchive(): RemoteArchive {
  const roster: Student[] = [
    { id: 'stu-wxm', name: '王小明', note: '', createdAt: SEED_NOW },
    { id: 'stu-lxh', name: '李小红', note: '', createdAt: SEED_NOW },
    { id: 'stu-zxg', name: '张小刚', note: '', createdAt: SEED_NOW },
  ];
  const records: MasteryRecord[] = [
    seedRecord('rec-1', 'stu-wxm', 'step-1-1', 'step-1-1-cp1', '抬手起势', 4, '掌握', 'synced'),
    seedRecord('rec-5', 'stu-wxm', 'step-1-1', 'step-1-1-cp2', '掌心前送', 99, '掌握', 'synced'),
    seedRecord('rec-6', 'stu-zxg', 'step-1-1', 'step-1-1-cp1', '抬手起势', 10, '掌握', 'synced'),
  ];
  return { id: 'archive-remote', roster, records, conclusions: [] };
}

export function loadArchive(): LearningArchive {
  try {
    const raw = localStorage.getItem(ARCHIVE_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as LearningArchive;
  } catch {
    /* 读取失败则重建 */
  }
  return createArchive();
}

export function saveArchive(archive: LearningArchive): void {
  localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archive));
}

export function loadRemote(): RemoteArchive {
  try {
    const raw = localStorage.getItem(REMOTE_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as RemoteArchive;
  } catch {
    /* 读取失败则重建 */
  }
  return createRemoteArchive();
}

export function saveRemote(remote: RemoteArchive): void {
  localStorage.setItem(REMOTE_STORAGE_KEY, JSON.stringify(remote));
}

export function addStudent(archive: LearningArchive, name: string, note: string): LearningArchive {
  const trimmed = name.trim();
  if (!trimmed) return archive;
  const student: Student = {
    id: uid('stu'),
    name: trimmed,
    note: note.trim(),
    createdAt: new Date().toISOString(),
  };
  return { ...archive, students: [...archive.students, student], revision: archive.revision + 1 };
}

export function recordsForStudent(archive: LearningArchive, studentId: string): MasteryRecord[] {
  return archive.records.filter((record) => record.studentId === studentId);
}

export function recordsForStep(archive: LearningArchive, studentId: string, stepId: string): MasteryRecord[] {
  return archive.records.filter((record) => record.studentId === studentId && record.stepId === stepId);
}

export function hasConclusion(archive: LearningArchive, studentId: string): boolean {
  return archive.conclusions.some((conclusion) => conclusion.studentId === studentId);
}

export function completionEligibility(
  archive: LearningArchive,
  project: CourseProject,
  studentId: string,
): { total: number; mastered: number; eligible: boolean } {
  const all = allCheckpoints(project);
  const mastered = new Set(
    archive.records
      .filter((record) => record.studentId === studentId && record.level === '掌握' && !record.invalidated && record.checkpointId)
      .map((record) => record.checkpointId),
  );
  const count = all.filter(({ checkpoint }) => mastered.has(checkpoint.id)).length;
  return { total: all.length, mastered: count, eligible: all.length > 0 && count === all.length };
}

export function recordMastery(
  archive: LearningArchive,
  project: CourseProject,
  studentId: string,
  checkpointId: string,
  level: MasteryLevel,
  recordedBy: string,
): LearningArchive {
  const found = findCheckpoint(project, checkpointId);
  if (!found) return archive;
  const record: MasteryRecord = {
    id: uid('rec'),
    studentId,
    stepId: found.step.id,
    checkpointId,
    checkpointTitle: found.checkpoint.title,
    checkpointTime: found.checkpoint.time,
    level,
    recordedAt: new Date().toISOString(),
    recordedBy: recordedBy.trim() || '陈老师',
    syncStatus: 'pending',
    failCount: 0,
    lastError: '',
    suspendReason: '',
    invalidated: false,
    invalidatedAt: '',
    migrated: false,
  };
  return { ...archive, records: [...archive.records, record], revision: archive.revision + 1 };
}

export function issueCompletion(
  archive: LearningArchive,
  project: CourseProject,
  studentId: string,
  issuedBy: string,
): LearningArchive {
  if (hasConclusion(archive, studentId)) return archive;
  const eligibility = completionEligibility(archive, project, studentId);
  if (!eligibility.eligible) return archive;
  const conclusion: CompletionConclusion = {
    id: uid('concl'),
    studentId,
    courseId: project.id,
    courseTitle: project.title,
    conclusion: '已结业',
    issuedAt: new Date().toISOString(),
    issuedBy: issuedBy.trim() || '陈老师',
    stepsCompleted: project.modules.reduce((sum, module) => sum + module.steps.length, 0),
    checkpointsCompleted: eligibility.mastered,
  };
  return { ...archive, conclusions: [...archive.conclusions, conclusion], revision: archive.revision + 1 };
}

function checkpointStale(record: MasteryRecord, project: CourseProject): boolean {
  if (!record.checkpointId) return false;
  const found = findCheckpoint(project, record.checkpointId);
  if (!found) return true;
  return found.checkpoint.title !== record.checkpointTitle || found.checkpoint.time !== record.checkpointTime;
}

export function invalidateStaleRecords(archive: LearningArchive, project: CourseProject): LearningArchive {
  const completedStudentIds = new Set(archive.conclusions.map((conclusion) => conclusion.studentId));
  let changed = false;
  const records = archive.records.map((record) => {
    if (record.invalidated) return record;
    if (completedStudentIds.has(record.studentId)) return record; // 已经结业的照旧留着
    if (!record.checkpointId) return record; // 旧数据由升级流程处理
    if (checkpointStale(record, project)) {
      changed = true;
      return { ...record, invalidated: true, invalidatedAt: new Date().toISOString() };
    }
    return record;
  });
  return changed ? { ...archive, records, revision: archive.revision + 1 } : archive;
}

export interface ReconcileOptions {
  simulateFailure?: boolean;
}

export interface ReconcileOutcome {
  merged: number;
  suspended: number;
  failed: number;
  stillPending: number;
}

export function reconcileArchive(
  archive: LearningArchive,
  remote: RemoteArchive,
  options: ReconcileOptions = {},
): { archive: LearningArchive; remote: RemoteArchive; outcome: ReconcileOutcome } {
  const localStudentById = new Map(archive.students.map((student) => [student.id, student]));
  const remoteById = new Map(remote.roster.map((student) => [student.id, student]));

  let merged = 0;
  let suspended = 0;
  let failed = 0;

  const records = archive.records.map((record) => {
    if (record.syncStatus === 'synced') return record;
    if (record.syncStatus === 'suspended') return record; // 等待人工对账
    if (record.invalidated) return record; // 已作废，不进同步队列
    // pending / failed → 尝试对账合并
    if (options.simulateFailure) {
      failed += 1;
      return {
        ...record,
        syncStatus: 'failed' as const,
        failCount: record.failCount + 1,
        lastError: '模拟同步失败：教研组档案服务暂不可用。',
      };
    }
    const localStudent = localStudentById.get(record.studentId);
    const remoteMatch =
      remoteById.get(record.studentId) ??
      (localStudent ? remote.roster.find((student) => student.name === localStudent.name) : undefined);
    if (!remoteMatch) {
      suspended += 1;
      return {
        ...record,
        syncStatus: 'suspended' as const,
        suspendReason: '学员不在教研组花名册中，无法对账合并。',
      };
    }
    merged += 1;
    return { ...record, syncStatus: 'synced' as const, failCount: 0, lastError: '', suspendReason: '' };
  });

  // 把已同步的记录按 id 合并进教研组档案
  const synced = records.filter((record) => record.syncStatus === 'synced');
  const syncedById = new Map(synced.map((record) => [record.id, record]));
  const remoteRecords = remote.records
    .map((record) => syncedById.get(record.id) ?? record)
    .concat(synced.filter((record) => !remote.records.some((existing) => existing.id === record.id)));

  const stillPending = records.filter((record) => record.syncStatus === 'pending').length;

  return {
    archive: { ...archive, records, lastReconciledAt: new Date().toISOString(), revision: archive.revision + 1 },
    remote: { ...remote, records: remoteRecords },
    outcome: { merged, suspended, failed, stillPending },
  };
}

export function addToRemoteRoster(remote: RemoteArchive, student: Student): RemoteArchive {
  if (remote.roster.some((item) => item.id === student.id || item.name === student.name)) return remote;
  return { ...remote, roster: [...remote.roster, student] };
}

export function resolveSuspended(
  archive: LearningArchive,
  recordId: string,
  remoteStudentId: string,
): LearningArchive {
  const records = archive.records.map((record) => {
    if (record.id !== recordId || record.syncStatus !== 'suspended') return record;
    return { ...record, studentId: remoteStudentId, syncStatus: 'pending' as const, suspendReason: '' };
  });
  return { ...archive, records, revision: archive.revision + 1 };
}

export function migrateArchive(
  archive: LearningArchive,
  project: CourseProject,
): { archive: LearningArchive; backfilled: number; unmatched: number } {
  let backfilled = 0;
  let unmatchedCount = 0;
  const unmatched: UnmatchedRecord[] = [...archive.unmatched];

  const records = archive.records.flatMap((record) => {
    if (record.checkpointId) return [record];
    // 旧数据：缺检查点编号，按标题回填
    let step: LessonStep | undefined;
    if (record.stepId) {
      for (const module of project.modules) {
        const found = module.steps.find((item) => item.id === record.stepId);
        if (found) {
          step = found;
          break;
        }
      }
    }
    let checkpoint = step?.checkpoints.find((item) => item.title === record.checkpointTitle);
    if (!checkpoint) {
      for (const module of project.modules) {
        for (const candidate of module.steps) {
          const found = candidate.checkpoints.find((item) => item.title === record.checkpointTitle);
          if (found) {
            step = candidate;
            checkpoint = found;
            break;
          }
        }
        if (checkpoint) break;
      }
    }
    if (step && checkpoint) {
      backfilled += 1;
      return [
        {
          ...record,
          stepId: step.id,
          checkpointId: checkpoint.id,
          checkpointTitle: checkpoint.title,
          checkpointTime: checkpoint.time,
          migrated: true,
        },
      ];
    }
    unmatchedCount += 1;
    unmatched.push({
      id: record.id,
      rawTitle: record.checkpointTitle,
      rawStepTitle: step?.title ?? '',
      rawStudentName: archive.students.find((student) => student.id === record.studentId)?.name ?? '',
      reason: '在当前课程中找不到同名检查点，编号无法回填。',
      recordedAt: record.recordedAt,
    });
    return [];
  });

  return {
    archive: { ...archive, records, unmatched, revision: archive.revision + 1 },
    backfilled,
    unmatched: unmatchedCount,
  };
}
