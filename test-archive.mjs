// 快速验证学习档案的拆分与对账逻辑（运行：node_modules/.bin/tsx test-archive.mjs）
import { createDemoProject } from './src/models.ts';
import {
  createArchive,
  createRemoteArchive,
  migrateArchive,
  invalidateStaleRecords,
  reconcileArchive,
  completionEligibility,
  recordMastery,
  issueCompletion,
  hasConclusion,
} from './src/archive.ts';

// mock localStorage
const store = new Map();
global.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, value),
  removeItem: (key) => store.delete(key),
};

const project = createDemoProject();
let archive = createArchive();
let remote = createRemoteArchive();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('— 升级：旧数据按标题回填检查点编号 —');
{
  const before = archive.records.length;
  const result = migrateArchive(archive, project);
  archive = result.archive;
  check('回填 1 条（抬手起势）', result.backfilled === 1);
  check('补不上单列 1 条（转身收势）', result.unmatched === 1);
  check('记录数减少 1（移到 unmatched）', archive.records.length === before - 1);
  const rec7 = archive.records.find((r) => r.id === 'rec-7');
  check('rec-7 已回填 checkpointId', rec7 && rec7.checkpointId === 'step-1-1-cp1');
  check('unmatched 里是转身收势', archive.unmatched[0]?.rawTitle === '转身收势');
}

console.log('— 检查点一改：旧掌握记录作废重上，已结业照旧留着 —');
{
  const result = invalidateStaleRecords(archive, project);
  archive = result;
  const rec5 = archive.records.find((r) => r.id === 'rec-5');
  const rec6 = archive.records.find((r) => r.id === 'rec-6');
  check('王小明（已结业）的陈旧记录照旧留着', rec5 && !rec5.invalidated);
  check('张小刚（未结业）的陈旧记录已作废', rec6 && rec6.invalidated);
}

console.log('— 断网先记，恢复后按学员对账合并 —');
{
  const result = reconcileArchive(archive, remote);
  archive = result.archive;
  remote = result.remote;
  const rec2 = archive.records.find((r) => r.id === 'rec-2');
  const rec3 = archive.records.find((r) => r.id === 'rec-3');
  const rec4 = archive.records.find((r) => r.id === 'rec-4');
  check('李小红的记录已合并', rec2 && rec2.syncStatus === 'synced');
  check('张小刚的记录已合并', rec3 && rec3.syncStatus === 'synced');
  check('陈小雨不在花名册 → 挂起', rec4 && rec4.syncStatus === 'suspended');
  check('合并数 2，挂起数 1', result.outcome.merged === 2 && result.outcome.suspended === 1);
}

console.log('— 失败后按档案侧重试 —');
{
  // 造一条失败记录
  archive = recordMastery(archive, project, 'stu-lxh', 'step-1-1-cp1', '掌握', '陈老师');
  const failResult = reconcileArchive(archive, remote, { simulateFailure: true });
  archive = failResult.archive;
  check('模拟失败 → 记录 failed', failResult.outcome.failed === 1);
  const failedRec = archive.records.find((r) => r.syncStatus === 'failed');
  check('失败记录可重试', !!failedRec);
  // 重试（不再模拟失败）
  const retryResult = reconcileArchive(archive, remote);
  archive = retryResult.archive;
  const retried = archive.records.find((r) => r.id === failedRec.id);
  check('重试后合并成功', retried && retried.syncStatus === 'synced');
}

console.log('— 结业结论 —');
{
  const elig = completionEligibility(archive, project, 'stu-lxh');
  check('李小红掌握进度统计正常', typeof elig.mastered === 'number' && elig.total > 0);
  // 给李小红补掌握所有检查点
  for (const m of project.modules) {
    for (const s of m.steps) {
      for (const cp of s.checkpoints) {
        archive = recordMastery(archive, project, 'stu-lxh', cp.id, '掌握', '陈老师');
      }
    }
  }
  const elig2 = completionEligibility(archive, project, 'stu-lxh');
  check('补齐后可结业', elig2.eligible);
  archive = issueCompletion(archive, project, 'stu-lxh', '陈老师');
  check('已发出结业结论', hasConclusion(archive, 'stu-lxh'));
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
