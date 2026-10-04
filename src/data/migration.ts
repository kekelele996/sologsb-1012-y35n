/**
 * 一次性拆分迁移：
 * 旧本地稿（课程模块、学习步骤与掌握情况合订）→
 *   编排台项目（课程模块 / 学习步骤 / 带编号的检查点，PROJECT_STORAGE_KEY）
 *   学习档案（学员 / 掌握记录 / 结业结论，ARCHIVE_STORAGE_KEY）
 * 旧掌握记录缺检查点编号，按检查点标题回填；标题对不上的记录单列。
 */

import {
  Checkpoint,
  CheckpointRef,
  CourseProject,
  LEGACY_PROJECT_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  seededCheckpointId,
  type CourseModule,
  type LessonStep,
} from '../models';
import {
  type MasteryRecord,
  type MasteryLevel,
  type RemoteDoc,
  type Student,
  type UnmatchedLegacyRecord,
  seedInitialArchive,
  upsertRemoteDoc,
} from './archive-store';
import { type LegacyCombinedDraft, createLegacyFixture } from './legacy-fixture';

/** 旧稿只有 cuePoints 秒数，升级时按固定模板补出带编号、带标题的检查点。 */
function legacyCheckpointTitle(index: number, atSecond: number): string {
  return `观察点 ${index + 1} · ${atSecond}s`;
}

function upgradeLegacyStep(step: LegacyCombinedDraft['modules'][number]['steps'][number]): LessonStep {
  const { cuePoints, ...rest } = step;
  const checkpoints: Checkpoint[] = [...(cuePoints ?? [])]
    .sort((a, b) => a - b)
    .map((atSecond, index) => ({
      id: seededCheckpointId(step.id, index),
      code: `CP-${String(index + 1).padStart(2, '0')}`,
      title: legacyCheckpointTitle(index, atSecond),
      atSecond,
    }));
  return { ...rest, checkpoints };
}

export function upgradeLegacyProject(legacy: LegacyCombinedDraft): CourseProject {
  const modules: CourseModule[] = legacy.modules.map((module) => ({
    id: module.id,
    title: module.title,
    summary: module.summary,
    color: module.color,
    steps: module.steps.map((step) => upgradeLegacyStep(step)),
  }));
  // 冻结版本是历史快照：内容不改写，只把步骤里的旧 cuePoints 结构升级成检查点结构。
  const frozenVersions = (legacy.frozenVersions ?? []).map((version: any) => {
    const snapshot = version?.snapshot as LegacyCombinedDraft | undefined;
    if (!snapshot?.modules) return version;
    return {
      ...version,
      snapshot: {
        ...snapshot,
        modules: snapshot.modules.map((module) => ({ ...module, steps: module.steps.map((step) => upgradeLegacyStep(step)) })),
      },
    };
  }) as CourseProject['frozenVersions'];
  return {
    id: legacy.id,
    title: legacy.title,
    teacher: legacy.teacher,
    audience: legacy.audience,
    status: legacy.status,
    selectedModuleId: legacy.selectedModuleId,
    selectedStepId: legacy.selectedStepId,
    modules,
    frozenVersions,
    lastSavedAt: legacy.lastSavedAt,
    revision: legacy.revision,
  };
}

/** 首次启动没有任何本地稿时，用旧版演示稿模拟一次升级，便于看到拆分与回填结果。 */
export function createDemoProject(): CourseProject {
  return upgradeLegacyProject(createLegacyFixture());
}

function buildCheckpointTitleIndex(project: CourseProject): Map<string, CheckpointRef> {
  const index = new Map<string, CheckpointRef>();
  project.modules.forEach((module) => {
    module.steps.forEach((step) => {
      step.checkpoints.forEach((checkpoint) => {
        index.set(checkpoint.title.trim(), {
          id: checkpoint.id,
          code: checkpoint.code,
          title: checkpoint.title,
          atSecond: checkpoint.atSecond,
          stepId: step.id,
          stepTitle: step.title,
          moduleId: module.id,
          moduleTitle: module.title,
        });
      });
    });
  });
  return index;
}

/** 教研组档案侧的既有资料：赵一诺对同一条记录有不同评价（冲突演示）；陈昊完全一致（并档演示）。 */
function seedRemoteLedger(students: Student[], records: MasteryRecord[]): void {
  const findRecord = (id: string): MasteryRecord | undefined => records.find((record) => record.id === id);
  const toRemote = (record: MasteryRecord) => ({
    id: record.id,
    checkpointId: record.checkpointId,
    checkpointTitleSnapshot: record.checkpointTitleSnapshot,
    level: record.level,
    note: record.note,
    recordedAt: record.recordedAt,
    status: record.status,
  });

  // 林小满：教研组档案里还有一条本机没有的记录，恢复对账时下载并档。
  const lin = students.find((item) => item.id === 'student-lin');
  const linExtra: MasteryRecord = {
    id: 'remote-lin-extra-1',
    studentId: 'student-lin',
    checkpointId: 'step-1-2-cp-3',
    checkpointTitleSnapshot: '观察点 3 · 42s',
    level: '已掌握',
    note: '教研组复评：拆解动作完全到位。',
    recordedAt: '2026-09-26T02:00:00.000Z',
    status: 'valid',
    source: 'archive',
  };
  if (lin) {
    const doc: RemoteDoc = {
      studentId: lin.id,
      name: lin.name,
      className: lin.className,
      note: lin.note,
      records: [...records.filter((record) => record.studentId === lin.id).map(toRemote), toRemote(linExtra)],
      conclusion: {
        studentId: lin.id,
        outcome: '结业',
        concludedAt: '2026-09-28T10:00:00.000Z',
        note: '全部检查点通过，结业证书编号 NO.2026-0091。',
      },
      updatedAt: '2026-09-28T10:00:00.000Z',
    };
    upsertRemoteDoc(doc);
  }

  // 赵一诺：教研组把同一检查点评为“需练习”，与本机“基本掌握”对不上 → 挂起。
  const zhao = students.find((item) => item.id === 'student-zhao');
  const zhaoRecord = findRecord('legacy-rec-2');
  if (zhao && zhaoRecord) {
    upsertRemoteDoc({
      studentId: zhao.id,
      name: zhao.name,
      className: zhao.className,
      note: '教研组备注：动作幅度偏小，需加强腕部稳定性。',
      records: [{ ...toRemote(zhaoRecord), level: '需练习', note: '教研组复课：手腕晃动明显，建议重测。' }],
      updatedAt: '2026-09-29T01:00:00.000Z',
    });
  }

  // 陈昊：教研组档案与本机完全一致，离线记录恢复后应顺利对平。
  const chen = students.find((item) => item.id === 'student-chen');
  if (chen) {
    upsertRemoteDoc({
      studentId: chen.id,
      name: chen.name,
      className: chen.className,
      note: chen.note,
      records: records.filter((record) => record.studentId === chen.id).map(toRemote),
      updatedAt: '2026-09-25T02:30:00.000Z',
    });
  }
}

export interface MigrationOutcome {
  project: CourseProject;
  usedFixture: boolean;
}

/**
 * 启动时执行拆分：
 * - 已有 v2 编排稿：不动；
 * - 只有旧合订稿 v1（或首次启动演示）：升级并建立学习档案；
 * - 旧掌握记录按标题回填检查点编号，补不上的进入 unmatched 单列。
 */
export function runStartupMigration(): MigrationOutcome {
  const existingProject = localStorage.getItem(PROJECT_STORAGE_KEY);
  if (existingProject) {
    return { project: JSON.parse(existingProject) as CourseProject, usedFixture: false };
  }

  let legacy: LegacyCombinedDraft;
  let usedFixture = false;
  const rawLegacy = localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY);
  if (rawLegacy) {
    legacy = JSON.parse(rawLegacy) as LegacyCombinedDraft;
  } else {
    legacy = createLegacyFixture();
    usedFixture = true;
  }

  const project = upgradeLegacyProject(legacy);
  localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));

  const titleIndex = buildCheckpointTitleIndex(project);
  const students: Student[] = (legacy.students ?? []).map((student) => ({
    id: student.id,
    name: student.name,
    className: student.className,
    note: student.note,
    createdAt: legacy.lastSavedAt,
  }));

  const records: MasteryRecord[] = [];
  const unmatched: UnmatchedLegacyRecord[] = [];
  (legacy.masteryRecords ?? []).forEach((legacyRecord) => {
    const matched = titleIndex.get(legacyRecord.checkpointTitle.trim());
    if (matched) {
      records.push({
        id: legacyRecord.id,
        studentId: legacyRecord.studentId,
        checkpointId: matched.id,
        checkpointTitleSnapshot: matched.title,
        level: legacyRecord.level as MasteryLevel,
        note: legacyRecord.note,
        recordedAt: legacyRecord.recordedAt,
        status: 'valid',
        source: 'legacy',
      });
    } else {
      unmatched.push({
        id: legacyRecord.id,
        studentId: legacyRecord.studentId,
        checkpointTitle: legacyRecord.checkpointTitle,
        level: legacyRecord.level as MasteryLevel,
        note: legacyRecord.note,
        recordedAt: legacyRecord.recordedAt,
      });
    }
  });

  const conclusions = (legacy.conclusions ?? []).map((item) => ({
    studentId: item.studentId,
    outcome: item.outcome,
    note: item.note,
    concludedAt: item.concludedAt,
  }));

  const migratedAt = new Date().toISOString();
  // 陈昊、赵一诺的旧记录迁移时处于离线状态，先入本机待对账队列。
  seedInitialArchive({
    students,
    records,
    conclusions,
    unmatched,
    pendingStudentIds: ['student-zhao', 'student-chen'],
    migration: { at: migratedAt, matchedCount: records.length, unmatchedCount: unmatched.length },
  });
  seedRemoteLedger(students, records);

  // 迁移完成，旧合订稿不再保留在原位。
  localStorage.removeItem(LEGACY_PROJECT_STORAGE_KEY);

  return { project, usedFixture };
}
