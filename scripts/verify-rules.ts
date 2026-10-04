/* 数据层规则验证（临时脚本，不进交付物）。 */
import { strict as assert } from 'node:assert';
import { runStartupMigration } from '../src/data/migration';
import {
  addMasteryRecord,
  concludeStudent,
  loadArchive,
  reconcile,
  setSimulateTransportFailure,
  voidRecordsForCheckpoints,
} from '../src/data/archive-store';
import { createCheckpoint, diffProjectCheckpoints, PROJECT_STORAGE_KEY } from '../src/models';

// ---- localStorage 垫片 ----
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};

let pass = 0;
const ok = (name: string, cond: boolean) => {
  assert.equal(cond, true, name);
  console.log(`✓ ${name}`);
  pass += 1;
};

// ===== 1. 拆分 + 标题回填 + 补不上单列 =====
const { project, usedFixture } = runStartupMigration();
ok('首次启动用旧合订稿做升级演示', usedFixture === true);
ok('编排稿写入 PROJECT_STORAGE_KEY', store.has(PROJECT_STORAGE_KEY));
const firstStep = project.modules[0].steps[0];
ok('旧 cuePoints 升级为带编号/标题的检查点',
  firstStep.checkpoints.length === 3 &&
  firstStep.checkpoints[0].code === 'CP-01' &&
  firstStep.checkpoints[0].title === '观察点 1 · 4s' &&
  firstStep.checkpoints[0].atSecond === 4);

const archive = loadArchive()!;
ok('学员与掌握记录拆到学习档案', archive.students.length === 5 && archive.records.length === 3);
ok('旧记录按标题回填了检查点编号',
  archive.records.find((r) => r.id === 'legacy-rec-1')!.checkpointId === 'step-1-1-cp-1');
ok('标题补不上的旧记录单列', archive.unmatched.length === 2);
ok('迁移信息记录了 3 回填 / 2 单列',
  archive.migration!.matchedCount === 3 && archive.migration!.unmatchedCount === 2);
ok('已结业结论迁到学习档案', archive.conclusions.some((c) => c.studentId === 'student-lin' && c.outcome === '结业'));

// ===== 2. 恢复后按学员对账：冲突挂起 / 无冲突并档 / 远端独有下载 =====
const r1 = reconcile(true);
ok('对账状态为 conflict（赵一诺对不上）', r1.result.status === 'conflict');
ok('赵一诺挂起，陈昊不挂起',
  r1.state.suspended.some((s) => s.studentId === 'student-zhao' && s.reason === 'conflict') &&
  !r1.state.suspended.some((s) => s.studentId === 'student-chen'));
const after = loadArchive()!;
ok('教研组独有的林小满记录被下载并档',
  after.records.some((r) => r.id === 'remote-lin-extra-1' && r.studentId === 'student-lin'));
ok('成功对平的学员离开待对账队列',
  !after.outbox.some((o) => o.studentId === 'student-chen'));
ok('挂起学员的本机改动保留在待对账队列',
  after.outbox.some((o) => o.studentId === 'student-zhao'));
ok('挂起条目列出了双方字段差异',
  after.suspended.find((s) => s.studentId === 'student-zhao')!.conflicts.some((c) => c.label.includes('掌握程度')));

// ===== 3. 失败后按档案侧重试 =====
const r2 = reconcile(true, true);
ok('按档案侧重试后冲突解除',
  r2.result.status === 'ok' && !loadArchive()!.suspended.some((s) => s.studentId === 'student-zhao'));
const remoteZhao = JSON.parse(store.get('sologsb-1012-research-archive/student-zhao')!);
ok('重试以档案侧为准（掌握程度=基本掌握）',
  remoteZhao.records.find((r: any) => r.id === 'legacy-rec-2').level === '基本掌握');

// ===== 4. 断网先记，恢复后自动可对账 =====
addMasteryRecord({
  studentId: 'student-chen',
  checkpointId: 'step-1-2-cp-1',
  checkpointTitle: '观察点 1 · 6s',
  level: '已掌握',
  note: '离线登记的新记录',
});
const offline = loadArchive()!;
ok('新记录先落本机且学员进入待对账队列',
  offline.records.some((r) => r.note === '离线登记的新记录') &&
  offline.outbox.some((o) => o.studentId === 'student-chen'));

// ===== 4b. 教研组档案故障：失败挂起，保留队列；恢复后重试成功 =====
setSimulateTransportFailure(true);
const fail = reconcile(true);
ok('传输故障时对账失败并挂起', fail.result.status === 'fail' && fail.state.suspended.some((s) => s.reason === 'failed'));
ok('失败后待对账队列保留，未丢记录', loadArchive()!.outbox.some((o) => o.studentId === 'student-chen'));
setSimulateTransportFailure(false);
const retry = reconcile(true);
ok('故障恢复后重试对平', retry.result.status === 'ok' && !retry.state.suspended.some((s) => s.reason === 'failed'));

const r3 = reconcile(true);
ok('恢复后该学员顺利对平',
  r3.result.status === 'ok' && !loadArchive()!.outbox.some((o) => o.studentId === 'student-chen'));

// ===== 5. 检查点一改旧掌握记录作废；已结业照旧保留 =====
const before = structuredClone(JSON.parse(store.get(PROJECT_STORAGE_KEY)!));
const edited = structuredClone(before);
const cp = edited.modules[0].steps[0].checkpoints[0];
cp.title = '观察点 1（修订）';
const { changed, deleted } = diffProjectCheckpoints(before, edited);
ok('diff 能识别被修改的检查点', changed.length === 1 && changed[0].id === cp.id);

// 先给未结业学员陈昊登记该检查点
addMasteryRecord({
  studentId: 'student-chen',
  checkpointId: cp.id,
  checkpointTitle: '观察点 1 · 4s',
  level: '已掌握',
  note: '作废前的记录',
});
// 林小满（已结业）也有同检查点的旧记录 legacy-rec-1
const { voidedCount } = voidRecordsForCheckpoints([cp.id]);
const voidedState = loadArchive()!;
const chenRec = voidedState.records.filter((r) => r.studentId === 'student-chen' && r.checkpointId === cp.id && r.note === '作废前的记录');
const linRec = voidedState.records.find((r) => r.id === 'legacy-rec-1')!;
ok('未结业学员的旧记录被作废（含作废原因）',
  chenRec.every((r) => r.status === 'voided' && r.voidReason) && voidedCount >= 1);
ok('已结业学员的旧记录照旧保留为有效', linRec.status === 'valid');

// 删除步骤（连带删检查点）也走同一规则
const before2 = structuredClone(JSON.parse(store.get(PROJECT_STORAGE_KEY)!));
const deletedStep = before2.modules[0].steps[1];
const deletedCpIds = deletedStep.checkpoints.map((c: any) => c.id);
before2.modules[0].steps = before2.modules[0].steps.filter((s: any) => s.id !== deletedStep.id);
const deltaDel = diffProjectCheckpoints(JSON.parse(store.get(PROJECT_STORAGE_KEY)!), before2);
ok('diff 能识别被删步骤带走的检查点', deltaDel.deleted.map((d) => d.id).join(',') === deletedCpIds.join(','));

// ===== 6. 已结业后不再接受新掌握记录（组件层规则，这里验证结论存在即可冻结语义） =====
concludeStudent('student-zhou', '未结业', '测试结论');
ok('可登记未结业结论', loadArchive()!.conclusions.some((c) => c.studentId === 'student-zhou' && c.outcome === '未结业'));

// ===== 7. 二次启动幂等，不再迁移 =====
const second = runStartupMigration();
ok('已有 v2 稿时启动幂等（不再跑迁移）', second.usedFixture === false && loadArchive()!.records.length >= 5);

console.log(`\n全部 ${pass} 项断言通过。`);
