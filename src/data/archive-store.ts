/**
 * 学习档案：教研组另记的那份档案，与编排台的课程稿互不嵌套。
 * - 学员、掌握记录、结业结论只存这里；
 * - 断网先记入本机待对账队列，恢复后按学员与教研组档案对账合并；
 * - 对不上先挂起；传输失败或挂起后可“按档案侧为准”重试；
 * - 编排台检查点调整时，未结业学员的旧掌握记录作废，已结业的保留。
 */

export type MasteryLevel = '已掌握' | '基本掌握' | '需练习';
export type RecordStatus = 'valid' | 'voided';
export type GraduationOutcome = '结业' | '未结业';

export interface Student {
  id: string;
  name: string;
  className: string;
  note: string;
  createdAt: string;
}

export interface MasteryRecord {
  id: string;
  studentId: string;
  /** 编排台检查点编号；旧记录升级回填前为空。 */
  checkpointId: string;
  /** 登记时的检查点标题快照，档案侧留存，不随编排台改名而变。 */
  checkpointTitleSnapshot: string;
  level: MasteryLevel;
  note: string;
  recordedAt: string;
  status: RecordStatus;
  source: 'archive' | 'legacy';
  voidedAt?: string;
  voidReason?: string;
}

export interface GraduationConclusion {
  studentId: string;
  outcome: GraduationOutcome;
  note: string;
  concludedAt: string;
}

/** 旧数据升级时按标题补不上检查点编号的记录，单列待人工处理。 */
export interface UnmatchedLegacyRecord {
  id: string;
  studentId: string;
  checkpointTitle: string;
  level: MasteryLevel;
  note: string;
  recordedAt: string;
}

export interface OutboxEntry {
  id: string;
  studentId: string;
  createdAt: string;
}

export type QueueReason = 'conflict' | 'failed';

export interface ConflictDetail {
  label: string;
  local: string;
  remote: string;
}

export interface SuspendedEntry {
  id: string;
  studentId: string;
  reason: QueueReason;
  detectedAt: string;
  attempts: number;
  conflicts: ConflictDetail[];
  lastError?: string;
}

export interface MigrationInfo {
  at: string;
  matchedCount: number;
  unmatchedCount: string;
}

export interface ArchiveState {
  students: Student[];
  records: MasteryRecord[];
  conclusions: GraduationConclusion[];
  unmatched: UnmatchedLegacyRecord[];
  outbox: OutboxEntry[];
  suspended: SuspendedEntry[];
  migration?: {
    at: string;
    matchedCount: number;
    unmatchedCount: number;
  };
  lastReconcileAt?: string;
  lastReconcileResult?: ReconcileResult;
  /** 演示用：勾选后下一次对账模拟教研组档案不可达。 */
  simulateTransportFailure: boolean;
}

export interface ReconcileResult {
  status: 'offline' | 'fail' | 'conflict' | 'ok';
  pushedCount: number;
  pulledCount: number;
  conflictCount: number;
  message: string;
}

interface RemoteRecordState {
  id: string;
  checkpointId: string;
  checkpointTitleSnapshot: string;
  level: MasteryLevel;
  note: string;
  recordedAt: string;
  status: RecordStatus;
}

/** 教研组档案（模拟服务端，独立于两份本地稿存放）。 */
export interface RemoteDoc {
  studentId: string;
  name: string;
  className: string;
  note: string;
  records: RemoteRecordState[];
  conclusion?: GraduationConclusion;
  updatedAt: string;
}

export const ARCHIVE_STORAGE_KEY = 'sologsb-1012-sign-learning-archive-v1';
const REMOTE_INDEX_KEY = 'sologsb-1012-research-archive-index';
const REMOTE_DOC_PREFIX = 'sologsb-1012-research-archive/';

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function loadArchive(): ArchiveState | null {
  try {
    const raw = localStorage.getItem(ARCHIVE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ArchiveState) : null;
  } catch {
    return null;
  }
}

export function saveArchive(state: ArchiveState): void {
  localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(state));
}

function loadRemoteIndex(): string[] {
  try {
    const raw = localStorage.getItem(REMOTE_INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRemoteIndex(index: string[]): void {
  localStorage.setItem(REMOTE_INDEX_KEY, JSON.stringify(index));
}

export function loadRemoteDoc(studentId: string): RemoteDoc | null {
  try {
    const raw = localStorage.getItem(REMOTE_DOC_PREFIX + studentId);
    return raw ? (JSON.parse(raw) as RemoteDoc) : null;
  } catch {
    return null;
  }
}

export function upsertRemoteDoc(doc: RemoteDoc): void {
  const index = loadRemoteIndex();
  if (!index.includes(doc.studentId)) saveRemoteIndex([...index, doc.studentId]);
  localStorage.setItem(REMOTE_DOC_PREFIX + doc.studentId, JSON.stringify({ ...doc, updatedAt: new Date().toISOString() }));
}

export function isGraduated(state: ArchiveState, studentId: string): boolean {
  return state.conclusions.some((item) => item.studentId === studentId && item.outcome === '结业');
}

export function studentRecords(state: ArchiveState, studentId: string): MasteryRecord[] {
  return state.records
    .filter((record) => record.studentId === studentId)
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
}

export interface SeedArchiveInput {
  students: Student[];
  records: MasteryRecord[];
  conclusions: GraduationConclusion[];
  unmatched: UnmatchedLegacyRecord[];
  pendingStudentIds: string[];
  migration: { at: string; matchedCount: number; unmatchedCount: number };
}

/** 旧合订稿拆分时建立学习档案（仅迁移路径调用）。 */
export function seedInitialArchive(input: SeedArchiveInput): ArchiveState {
  const state: ArchiveState = {
    students: input.students,
    records: input.records,
    conclusions: input.conclusions,
    unmatched: input.unmatched,
    outbox: input.pendingStudentIds.map((studentId) => ({ id: newId('ob'), studentId, createdAt: input.migration.at })),
    suspended: [],
    migration: input.migration,
    simulateTransportFailure: false,
  };
  saveArchive(state);
  return state;
}

function queueStudent(state: ArchiveState, studentId: string): void {
  if (!state.outbox.some((entry) => entry.studentId === studentId)) {
    state.outbox.push({ id: newId('ob'), studentId, createdAt: new Date().toISOString() });
  }
}

function mutate(mutator: (state: ArchiveState) => void): ArchiveState {
  const state = loadArchive();
  if (!state) throw new Error('学习档案尚未初始化');
  mutator(state);
  saveArchive(state);
  return state;
}

export function addStudent(input: { name: string; className: string; note: string }): ArchiveState {
  return mutate((state) => {
    const student: Student = { id: newId('student'), name: input.name.trim(), className: input.className.trim(), note: input.note.trim(), createdAt: new Date().toISOString() };
    state.students.push(student);
    queueStudent(state, student.id);
  });
}

export function updateStudent(studentId: string, patch: Partial<Pick<Student, 'name' | 'className' | 'note'>>): ArchiveState {
  return mutate((state) => {
    const student = state.students.find((item) => item.id === studentId);
    if (!student) return;
    Object.assign(student, patch);
    queueStudent(state, studentId);
  });
}

export function addMasteryRecord(input: {
  studentId: string;
  checkpointId: string;
  checkpointTitle: string;
  level: MasteryLevel;
  note: string;
}): ArchiveState {
  return mutate((state) => {
    state.records.push({
      id: newId('rec'),
      studentId: input.studentId,
      checkpointId: input.checkpointId,
      checkpointTitleSnapshot: input.checkpointTitle,
      level: input.level,
      note: input.note.trim(),
      recordedAt: new Date().toISOString(),
      status: 'valid',
      source: 'archive',
    });
    queueStudent(state, input.studentId);
  });
}

export function concludeStudent(studentId: string, outcome: GraduationOutcome, note: string): ArchiveState {
  return mutate((state) => {
    const conclusion: GraduationConclusion = { studentId, outcome, note: note.trim(), concludedAt: new Date().toISOString() };
    const index = state.conclusions.findIndex((item) => item.studentId === studentId);
    if (index >= 0) state.conclusions[index] = conclusion;
    else state.conclusions.push(conclusion);
    queueStudent(state, studentId);
  });
}

/** 单列的旧记录人工补绑检查点编号后，转成正式掌握记录。 */
export function bindUnmatched(unmatchedId: string, checkpointId: string, checkpointTitle: string): ArchiveState {
  return mutate((state) => {
    const index = state.unmatched.findIndex((item) => item.id === unmatchedId);
    if (index < 0) return;
    const legacy = state.unmatched[index];
    state.unmatched.splice(index, 1);
    state.records.push({
      id: legacy.id,
      studentId: legacy.studentId,
      checkpointId,
      checkpointTitleSnapshot: checkpointTitle,
      level: legacy.level,
      note: legacy.note,
      recordedAt: legacy.recordedAt,
      status: 'valid',
      source: 'legacy',
    });
    queueStudent(state, legacy.studentId);
  });
}

export function discardUnmatched(unmatchedId: string): ArchiveState {
  return mutate((state) => {
    state.unmatched = state.unmatched.filter((item) => item.id !== unmatchedId);
  });
}

export function setSimulateTransportFailure(enabled: boolean): ArchiveState {
  return mutate((state) => {
    state.simulateTransportFailure = enabled;
  });
}

/**
 * 编排台检查点一改就调用：编号对应的未结业学员有效记录全部作废，需要重新登记；
 * 已经结业的学员，记录照旧保留。
 */
export function voidRecordsForCheckpoints(checkpointIds: string[]): { state: ArchiveState; voidedCount: number } {
  const state = loadArchive();
  if (!state) return { state: null as unknown as ArchiveState, voidedCount: 0 };
  const idSet = new Set(checkpointIds);
  const now = new Date().toISOString();
  let voidedCount = 0;
  state.records.forEach((record) => {
    if (record.status !== 'valid') return;
    if (!idSet.has(record.checkpointId)) return;
    if (isGraduated(state, record.studentId)) return;
    record.status = 'voided';
    record.voidedAt = now;
    record.voidReason = '检查点已调整，旧掌握记录作废，需重新登记。';
    voidedCount += 1;
  });
  saveArchive(state);
  return { state, voidedCount };
}

interface StudentPayload {
  name: string;
  className: string;
  note: string;
  records: RemoteRecordState[];
  conclusion?: GraduationConclusion;
}

function buildPayload(state: ArchiveState, studentId: string): StudentPayload | null {
  const student = state.students.find((item) => item.id === studentId);
  if (!student) return null;
  return {
    name: student.name,
    className: student.className,
    note: student.note,
    records: state.records
      .filter((record) => record.studentId === studentId)
      .map((record) => ({
        id: record.id,
        checkpointId: record.checkpointId,
        checkpointTitleSnapshot: record.checkpointTitleSnapshot,
        level: record.level,
        note: record.note,
        recordedAt: record.recordedAt,
        status: record.status,
      })),
    conclusion: state.conclusions.find((item) => item.studentId === studentId),
  };
}

function signatureEqual(a: RemoteRecordState, b: RemoteRecordState): boolean {
  return a.level === b.level && a.note === b.note && a.status === b.status && a.checkpointId === b.checkpointId;
}

function describeLevel(value: string): string {
  return value || '（空）';
}

/**
 * 恢复联网后按学员对账合并：
 * - 对不上（同一条记录双方各改了内容、学员资料或结论不一致）→ 挂起；
 * - 传输失败 → 保留待对账并重试；
 * - preferArchive 时按档案侧（本机学习档案）为准覆盖教研组档案。
 */
export function reconcile(online: boolean, preferArchive = false): { state: ArchiveState; result: ReconcileResult } {
  const state = loadArchive();
  if (!state) throw new Error('学习档案尚未初始化');
  if (!online) {
    const result: ReconcileResult = { status: 'offline', pushedCount: 0, pulledCount: 0, conflictCount: state.suspended.length, message: '当前离线，掌握记录已先记在本机，恢复联网后按学员对账。' };
    return { state, result };
  }

  const transportFailed = state.simulateTransportFailure;
  const pendingIds = state.outbox.map((entry) => entry.studentId);
  // 挂起（冲突/失败）的学员重试时，本机改动仍属未对账，同样保留本地意图。
  const intentIds = new Set([...pendingIds, ...state.suspended.map((entry) => entry.studentId)]);
  const studentIds = [...new Set([...pendingIds, ...loadRemoteIndex(), ...state.suspended.map((entry) => entry.studentId)])];

  let pushedCount = 0;
  let pulledCount = 0;
  let failCount = 0;
  const allConflicts: { studentName: string; details: ConflictDetail[] }[] = [];
  const resolvedSuspended: string[] = [];
  const stillSuspended = new Map<string, SuspendedEntry>();

  const markFailed = (studentId: string, error: string): void => {
    const existing = state.suspended.find((entry) => entry.studentId === studentId);
    if (existing) {
      existing.reason = 'failed';
      existing.attempts += 1;
      existing.lastError = error;
      stillSuspended.set(studentId, existing);
    } else {
      stillSuspended.set(studentId, {
        id: newId('sus'),
        studentId,
        reason: 'failed',
        detectedAt: new Date().toISOString(),
        attempts: 1,
        conflicts: [],
        lastError: error,
      });
    }
    failCount += 1;
  };

  const markConflict = (studentId: string, conflicts: ConflictDetail[]): void => {
    const existing = state.suspended.find((entry) => entry.studentId === studentId);
    if (existing) {
      existing.reason = 'conflict';
      existing.attempts += 1;
      existing.conflicts = conflicts;
      existing.lastError = undefined;
      stillSuspended.set(studentId, existing);
    } else {
      stillSuspended.set(studentId, {
        id: newId('sus'),
        studentId,
        reason: 'conflict',
        detectedAt: new Date().toISOString(),
        attempts: 1,
        conflicts,
      });
    }
    allConflicts.push({ studentName: state.students.find((item) => item.id === studentId)?.name ?? studentId, details: conflicts });
  };

  for (const studentId of studentIds) {
    const hasPending = intentIds.has(studentId);
    const payload = buildPayload(state, studentId);
    if (!payload) continue;
    let remote = loadRemoteDoc(studentId);

    if (transportFailed) {
      markFailed(studentId, '教研组档案暂不可达（模拟故障），保留本机记录待重试。');
      continue;
    }

    if (!remote) {
      upsertRemoteDoc({ studentId, ...payload, updatedAt: new Date().toISOString() });
      pushedCount += 1;
      if (hasPending) resolvedSuspended.push(studentId);
      continue;
    }

    const conflicts: ConflictDetail[] = [];
    // 有待对账的本机改动时，资料差异才算冲突；纯下载直接采信教研组档案。
    if (hasPending || preferArchive) {
      if (remote.name !== payload.name) conflicts.push({ label: '学员姓名', local: payload.name, remote: remote.name });
      if (remote.className !== payload.className) conflicts.push({ label: '班级', local: payload.className, remote: remote.className });
      if (remote.note !== payload.note) conflicts.push({ label: '学员备注', local: describeLevel(payload.note), remote: describeLevel(remote.note) });
      if ((payload.conclusion?.outcome ?? '') !== (remote.conclusion?.outcome ?? '') || (payload.conclusion?.note ?? '') !== (remote.conclusion?.note ?? '')) {
        conflicts.push({
          label: '结业结论',
          local: payload.conclusion ? `${payload.conclusion.outcome}｜${payload.conclusion.note}` : '（无结论）',
          remote: remote.conclusion ? `${remote.conclusion.outcome}｜${remote.conclusion.note}` : '（无结论）',
        });
      }
    }

    const localMap = new Map(payload.records.map((record) => [record.id, record]));
    const remoteMap = new Map(remote.records.map((record) => [record.id, record]));
    const mergedRecords: RemoteRecordState[] = [];

    remote.records.forEach((remoteRecord) => {
      const localRecord = localMap.get(remoteRecord.id);
      if (!localRecord) {
        // 教研组档案独有：下载并档到本机。
        if (!state.records.some((record) => record.id === remoteRecord.id)) {
          state.records.push({
            id: remoteRecord.id,
            studentId,
            checkpointId: remoteRecord.checkpointId,
            checkpointTitleSnapshot: remoteRecord.checkpointTitleSnapshot,
            level: remoteRecord.level,
            note: remoteRecord.note,
            recordedAt: remoteRecord.recordedAt,
            status: remoteRecord.status,
            source: 'archive',
          });
          pulledCount += 1;
        }
        mergedRecords.push(remoteRecord);
        return;
      }
      if (!signatureEqual(localRecord, remoteRecord)) {
        const title = localRecord.checkpointTitleSnapshot || remoteRecord.checkpointTitleSnapshot || remoteRecord.checkpointId;
        if (localRecord.level !== remoteRecord.level) conflicts.push({ label: `掌握程度｜${title}`, local: localRecord.level, remote: remoteRecord.level });
        if (localRecord.note !== remoteRecord.note) conflicts.push({ label: `评语｜${title}`, local: describeLevel(localRecord.note), remote: describeLevel(remoteRecord.note) });
        if (localRecord.status !== remoteRecord.status) conflicts.push({ label: `记录状态｜${title}`, local: localRecord.status === 'voided' ? '已作废' : '有效', remote: remoteRecord.status === 'voided' ? '已作废' : '有效' });
      }
      mergedRecords.push(preferArchive ? localRecord : remoteRecord);
    });
    payload.records.forEach((localRecord) => {
      if (!remoteMap.has(localRecord.id)) {
        mergedRecords.push(localRecord);
        pushedCount += 1;
      }
    });

    // 无待对账改动且无冲突：学员资料/结论以教研组档案为准下载。
    if (!hasPending && !preferArchive) {
      const localStudent = state.students.find((item) => item.id === studentId);
      if (localStudent) {
        if (localStudent.name !== remote.name || localStudent.className !== remote.className || localStudent.note !== remote.note) {
          localStudent.name = remote.name;
          localStudent.className = remote.className;
          localStudent.note = remote.note;
          pulledCount += 1;
        }
      }
      if (remote.conclusion && !state.conclusions.some((item) => item.studentId === studentId)) {
        state.conclusions.push(remote.conclusion);
        pulledCount += 1;
      }
    }

    if (conflicts.length && !preferArchive) {
      markConflict(studentId, conflicts);
      continue;
    }

    // mergedRecords：共有记录 preferArchive 时取本机、否则保留教研组版本；
    // 双方各自独有的记录都并入。
    const nextDoc: RemoteDoc = preferArchive
      ? {
          studentId,
          name: payload.name,
          className: payload.className,
          note: payload.note,
          records: mergedRecords,
          conclusion: payload.conclusion,
          updatedAt: new Date().toISOString(),
        }
      : {
          studentId,
          name: hasPending ? payload.name : remote.name,
          className: hasPending ? payload.className : remote.className,
          note: hasPending ? payload.note : remote.note,
          records: mergedRecords,
          conclusion: payload.conclusion ?? remote.conclusion,
          updatedAt: new Date().toISOString(),
        };
    upsertRemoteDoc(nextDoc);
    if (hasPending) pushedCount += 1;
    resolvedSuspended.push(studentId);
  }

  // 只有对平的学员才离开待对账队列；挂起（冲突/失败）的保留，等待按档案侧重试。
  state.outbox = state.outbox.filter((entry) => !resolvedSuspended.includes(entry.studentId));
  state.suspended = [...stillSuspended.values()];
  state.lastReconcileAt = new Date().toISOString();

  let result: ReconcileResult;
  if (transportFailed) {
    result = { status: 'fail', pushedCount: 0, pulledCount: 0, conflictCount: allConflicts.length, message: `教研组档案不可达，${failCount} 名学员的对账失败，可按档案侧重试。` };
  } else if (allConflicts.length > 0) {
    result = {
      status: 'conflict',
      pushedCount,
      pulledCount,
      conflictCount: allConflicts.reduce((sum, item) => sum + item.details.length, 0),
      message: `${allConflicts.length} 名学员对账对不上，已挂起；上传 ${pushedCount} 条、并档 ${pulledCount} 条。`,
    };
  } else {
    const suspendedRemaining = state.suspended.length;
    result = {
      status: 'ok',
      pushedCount,
      pulledCount,
      conflictCount: 0,
      message: suspendedRemaining === 0
        ? `对账完成：上传 ${pushedCount} 名学员档案，下载并档 ${pulledCount} 条记录。`
        : `对账完成：上传 ${pushedCount} 名学员档案，并档 ${pulledCount} 条记录；仍有 ${suspendedRemaining} 名学员挂起。`,
    };
  }
  state.lastReconcileResult = result;
  saveArchive(state);
  return { state, result };
}
