import { Component, Fragment, Host, State, h, Listen } from '@stencil/core';
import {
  cloneProject,
  createDemoProject,
  selectedModule,
  selectedStep,
  STORAGE_KEY,
  validateProject,
  type CameraAngle,
  type CaptionPosition,
  type Checkpoint,
  type CourseModule,
  type CourseProject,
  type Difficulty,
  type GestureZone,
  type LessonStep,
  type ValidationCheck,
} from '../../models';
import {
  addStudent,
  addToRemoteRoster,
  completionEligibility,
  createArchive,
  createRemoteArchive,
  hasConclusion,
  invalidateStaleRecords,
  issueCompletion,
  loadArchive,
  loadRemote,
  migrateArchive,
  recordMastery as recordMasteryRecord,
  reconcileArchive,
  recordsForStudent,
  recordsForStep,
  saveArchive,
  saveRemote,
  type LearningArchive,
  type MasteryLevel,
  type MasteryRecord,
  type RemoteArchive,
  type Student,
} from '../../archive';

type PreviewSize = 'phone' | 'tablet';

@Component({
  tag: 'app-root',
  styleUrl: 'app-root.css',
  scoped: true,
})
export class AppRoot {
  @State() project: CourseProject = createDemoProject();
  @State() previewSize: PreviewSize = 'phone';
  @State() activePanel: 'editor' | 'checks' | 'archive' = 'editor';
  @State() playing = false;
  @State() playProgress = 0;
  @State() offline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
  @State() toast?: { color: string; message: string };
  @State() archive: LearningArchive = createArchive();
  @State() remote: RemoteArchive = createRemoteArchive();
  @State() selectedStudentId = '';
  @State() simulateFailure = false;
  @State() newStudentName = '';
  @State() newStudentNote = '';
  private past: CourseProject[] = [];
  private future: CourseProject[] = [];
  private playTimer?: number;

  componentWillLoad(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) this.project = JSON.parse(saved) as CourseProject;
    } catch {
      this.project = createDemoProject();
    }
    this.archive = loadArchive();
    this.remote = loadRemote();
    this.runMigration();
    this.refreshInvalidation();
    if (!this.selectedStudentId && this.archive.students.length > 0) {
      this.selectedStudentId = this.archive.students[0].id;
    }
  }

  private runMigration(): void {
    const result = migrateArchive(this.archive, this.project);
    if (result.backfilled > 0 || result.unmatched > 0) {
      this.archive = result.archive;
      saveArchive(this.archive);
      if (result.backfilled > 0) this.showToast('success', `已按标题回填 ${result.backfilled} 条旧掌握记录的检查点编号。`);
      if (result.unmatched > 0) this.showToast('warning', `有 ${result.unmatched} 条旧记录补不上检查点编号，已单列。`);
    }
  }

  private refreshInvalidation(): void {
    const next = invalidateStaleRecords(this.archive, this.project);
    if (next !== this.archive) {
      this.archive = next;
      saveArchive(this.archive);
    }
  }

  disconnectedCallback(): void {
    if (this.playTimer) window.clearInterval(this.playTimer);
  }

  @Listen('online', { target: 'window' })
  handleOnline(): void {
    this.offline = false;
    this.showToast('success', '网络已恢复，正在按学员对账合并掌握记录。');
    this.reconcile();
  }

  @Listen('offline', { target: 'window' })
  handleOffline(): void {
    this.offline = true;
    this.showToast('warning', '当前处于离线状态，修改会继续保存在本机。');
  }

  @Listen('keydown', { target: 'window' })
  handleKeyboard(event: KeyboardEvent): void {
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName);
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.saveDraft(true);
      return;
    }
    if (!editing && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      this.moveStep(event.key === 'ArrowUp' ? -1 : 1);
    }
  }

  private get currentModule(): CourseModule {
    return selectedModule(this.project);
  }

  private get currentStep(): LessonStep | undefined {
    return selectedStep(this.project);
  }

  private get checks(): ValidationCheck[] {
    return validateProject(this.project);
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
  }

  private commit(update: (draft: CourseProject) => CourseProject, toast?: string): void {
    if (this.project.status === 'frozen') {
      this.showToast('warning', '当前版本已冻结，请先创建修订版。');
      return;
    }
    const before = cloneProject(this.project);
    const next = update(cloneProject(this.project));
    next.revision = before.revision + 1;
    next.lastSavedAt = new Date().toISOString();
    this.past = [...this.past, before].slice(-80);
    this.future = [];
    this.project = next;
    this.persist();
    if (toast) this.showToast('success', toast);
  }

  private undo(): void {
    const previous = this.past.pop();
    if (!previous) return this.showToast('medium', '没有可撤销的修改。');
    this.future = [cloneProject(this.project), ...this.future].slice(0, 80);
    this.project = previous;
    this.persist();
  }

  private redo(): void {
    const next = this.future.shift();
    if (!next) return;
    this.past = [...this.past, cloneProject(this.project)].slice(-80);
    this.project = next;
    this.persist();
  }

  private showToast(color: string, message: string): void {
    this.toast = { color, message };
    window.setTimeout(() => {
      if (this.toast?.message === message) this.toast = undefined;
    }, 3_200);
  }

  private selectModule(moduleId: string): void {
    const module = this.project.modules.find((item) => item.id === moduleId);
    this.project = { ...this.project, selectedModuleId: moduleId, selectedStepId: module?.steps[0]?.id ?? '' };
    this.persist();
  }

  private selectStep(stepId: string): void {
    this.project = { ...this.project, selectedStepId: stepId };
    this.persist();
  }

  private updateStep(patch: Partial<LessonStep>, toast?: string): void {
    const stepId = this.currentStep?.id;
    if (!stepId) return;
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => module.id === draft.selectedModuleId ? {
        ...module,
        steps: module.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step),
      } : module),
    }), toast);
  }

  private updateCurrentModule(patch: Partial<CourseModule>): void {
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => module.id === draft.selectedModuleId ? { ...module, ...patch } : module),
    }));
  }

  private addModule(): void {
    const index = this.project.modules.length + 1;
    const module: CourseModule = {
      id: `module-${Date.now().toString(36)}`,
      title: `模块 ${index} · 未命名`,
      summary: '说明该模块的学习目标与适用场景。',
      color: ['#15827a', '#8a3ffc', '#b34331', '#376ea8'][index % 4],
      steps: [],
    };
    this.commit((draft) => ({ ...draft, modules: [...draft.modules, module], selectedModuleId: module.id, selectedStepId: '' }), '已创建课程模块。');
  }

  private addStep(kind: LessonStep['kind'] = '示范'): void {
    const module = this.currentModule;
    if (!module) return this.addModule();
    const prior = module.steps.at(-1);
    const step: LessonStep = {
      id: `step-${Date.now().toString(36)}`,
      title: `新${kind}步骤 ${module.steps.length + 1}`,
      kind,
      duration: 45,
      demoTitle: '等待上传或录制示范片段',
      demoUrl: '',
      handshape: '描述起始手形、掌心方向和运动路径。',
      gestureZone: '中央',
      caption: '填写送给学习者的字幕说明。',
      captionPosition: '下方安全区',
      camera: '正面',
      commonMistakes: [],
      exercise: kind === '练习' ? '填写练习任务。' : '',
      exerciseFeedback: kind === '练习' ? '填写反馈方式。' : '',
      altText: '',
      prerequisiteId: prior?.id ?? '',
      difficulty: '入门',
      checkpoints: [
        { id: `cp-${Date.now().toString(36)}-1`, title: '起始手形', time: 8 },
        { id: `cp-${Date.now().toString(36)}-2`, title: '动作中点', time: 20 },
        { id: `cp-${Date.now().toString(36)}-3`, title: '结束停顿', time: 32 },
      ],
    };
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((item) => item.id === module.id ? { ...item, steps: [...item.steps, step] } : item),
      selectedStepId: step.id,
    }), '已新增学习步骤。');
  }

  private duplicateStep(): void {
    const step = this.currentStep;
    if (!step) return;
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => {
        if (module.id !== draft.selectedModuleId) return module;
        const index = module.steps.findIndex((item) => item.id === step.id);
        const duplicate = { ...structuredClone(step), id: `step-${Date.now().toString(36)}`, title: `${step.title}（副本）` };
        return { ...module, steps: [...module.steps.slice(0, index + 1), duplicate, ...module.steps.slice(index + 1)] };
      }),
    }), '已复制当前步骤。');
  }

  private deleteStep(stepId: string): void {
    if (this.currentModule.steps.length <= 1) {
      this.showToast('warning', '模块至少保留一个学习步骤。');
      return;
    }
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => module.id === draft.selectedModuleId ? {
        ...module,
        steps: module.steps.filter((step) => step.id !== stepId),
      } : module),
      selectedStepId: this.currentModule.steps.find((step) => step.id !== stepId)?.id ?? '',
    }), '已删除学习步骤。');
  }

  private moveStep(direction: number): void {
    const stepId = this.currentStep?.id;
    if (!stepId) return;
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => {
        if (module.id !== draft.selectedModuleId) return module;
        const index = module.steps.findIndex((step) => step.id === stepId);
        const nextIndex = Math.max(0, Math.min(module.steps.length - 1, index + direction));
        if (index === nextIndex) return module;
        const steps = [...module.steps];
        const [item] = steps.splice(index, 1);
        steps.splice(nextIndex, 0, item);
        return { ...module, steps };
      }),
    }), '已调整步骤顺序。');
  }

  private saveDraft(showMessage = true): void {
    if (this.project.status === 'frozen') {
      this.showToast('warning', '冻结版本不可覆盖，请先创建修订版。');
      return;
    }
    this.project = { ...this.project, status: 'draft', lastSavedAt: new Date().toISOString() };
    this.persist();
    if (showMessage) this.showToast('success', '草稿已保存在浏览器本地。');
  }

  private submitForReview(): void {
    const blocking = this.checks.filter((check) => check.severity === 'error');
    if (blocking.length) {
      this.activePanel = 'checks';
      this.showToast('danger', `仍有 ${blocking.length} 个阻断问题，修复后才能提交复核。`);
      return;
    }
    this.commit((draft) => ({ ...draft, status: 'review' }), '课程已提交复核。');
  }

  private returnForChanges(): void {
    this.commit((draft) => ({ ...draft, status: 'changes' }), '课程已退回修改。');
  }

  private freezeVersion(): void {
    const blocking = this.checks.filter((check) => check.severity === 'error');
    if (blocking.length) {
      this.activePanel = 'checks';
      this.showToast('danger', `冻结前仍有 ${blocking.length} 个阻断问题。`);
      return;
    }
    this.commit((draft) => {
      const { frozenVersions, ...snapshot } = cloneProject(draft);
      const version = {
        id: `frozen-${Date.now().toString(36)}`,
        label: `冻结版本 v${frozenVersions.length + 1}`,
        createdAt: new Date().toISOString(),
        snapshot,
      };
      return { ...draft, status: 'frozen', frozenVersions: [version, ...frozenVersions] };
    }, '当前课程版本已冻结。');
    this.playing = false;
  }

  private reviseFrozen(): void {
    this.commit((draft) => ({ ...draft, status: 'draft' }), '已创建修订版，可继续编辑。');
  }

  private updateCheckpoint(checkpointId: string, patch: Partial<Checkpoint>): void {
    const stepId = this.currentStep?.id;
    if (!stepId) return;
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => module.id === draft.selectedModuleId ? {
        ...module,
        steps: module.steps.map((step) => step.id === stepId ? {
          ...step,
          checkpoints: step.checkpoints.map((cp) => cp.id === checkpointId ? { ...cp, ...patch } : cp),
        } : step),
      } : module),
    }), '已更新检查点。');
    this.refreshInvalidation();
  }

  private addCheckpoint(): void {
    const stepId = this.currentStep?.id;
    if (!stepId) return;
    const id = `cp-${Date.now().toString(36)}`;
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => module.id === draft.selectedModuleId ? {
        ...module,
        steps: module.steps.map((step) => step.id === stepId ? {
          ...step,
          checkpoints: [...step.checkpoints, { id, title: '新检查点', time: Math.min(step.duration, 10) }],
        } : step),
      } : module),
    }), '已添加检查点。');
    this.refreshInvalidation();
  }

  private removeCheckpoint(checkpointId: string): void {
    const stepId = this.currentStep?.id;
    if (!stepId) return;
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => module.id === draft.selectedModuleId ? {
        ...module,
        steps: module.steps.map((step) => step.id === stepId ? {
          ...step,
          checkpoints: step.checkpoints.filter((cp) => cp.id !== checkpointId),
        } : step),
      } : module),
    }), '已删除检查点。');
    this.refreshInvalidation();
  }

  private selectStudent(studentId: string): void {
    this.selectedStudentId = studentId;
  }

  private addStudent(): void {
    if (!this.newStudentName.trim()) {
      this.showToast('warning', '请先填写学员姓名。');
      return;
    }
    this.archive = addStudent(this.archive, this.newStudentName, this.newStudentNote);
    const added = this.archive.students[this.archive.students.length - 1];
    this.selectedStudentId = added.id;
    this.newStudentName = '';
    this.newStudentNote = '';
    saveArchive(this.archive);
    this.showToast('success', '已添加学员，记录保存在学习档案。');
  }

  private recordMastery(checkpointId: string, level: MasteryLevel): void {
    if (!this.selectedStudentId) {
      this.showToast('warning', '请先选择学员。');
      return;
    }
    this.archive = recordMasteryRecord(this.archive, this.project, this.selectedStudentId, checkpointId, level, this.project.teacher);
    saveArchive(this.archive);
    this.showToast('success', level === '掌握' ? '已记录掌握（待同步）。' : '已记录未掌握（待同步）。');
  }

  private issueCompletion(): void {
    if (!this.selectedStudentId) return;
    this.archive = issueCompletion(this.archive, this.project, this.selectedStudentId, this.project.teacher);
    saveArchive(this.archive);
    this.showToast('success', '已发出结业结论，既往掌握记录照旧保留。');
  }

  private addToRoster(student: Student): void {
    this.remote = addToRemoteRoster(this.remote, student);
    saveRemote(this.remote);
    this.showToast('success', `已将 ${student.name} 加入教研组花名册。`);
  }

  private reconcile(): void {
    if (this.offline) {
      this.showToast('warning', '离线中，记录先保存在本机，恢复后自动对账合并。');
      return;
    }
    const result = reconcileArchive(this.archive, this.remote, { simulateFailure: this.simulateFailure });
    this.archive = result.archive;
    this.remote = result.remote;
    saveArchive(this.archive);
    saveRemote(this.remote);
    const { merged, suspended, failed } = result.outcome;
    if (failed > 0) {
      this.showToast('danger', `${failed} 条记录同步失败，可在档案侧重试。`);
    } else if (suspended > 0) {
      this.showToast('warning', `${merged} 条已合并，${suspended} 条对不上已挂起。`);
    } else if (merged > 0) {
      this.showToast('success', `已按学员对账合并 ${merged} 条掌握记录。`);
    } else {
      this.showToast('success', '对账完成，没有待同步记录。');
    }
  }

  private stepTitleOf(stepId: string): string {
    for (const module of this.project.modules) {
      const step = module.steps.find((item) => item.id === stepId);
      if (step) return step.title;
    }
    return '未知步骤';
  }

  private renderSyncBadge(record: MasteryRecord) {
    if (record.invalidated) return <span class="record-badge invalidated">已作废 · 待重上</span>;
    if (record.syncStatus === 'synced') return <span class="record-badge synced">已同步</span>;
    if (record.syncStatus === 'pending') return <span class="record-badge pending">待同步</span>;
    if (record.syncStatus === 'suspended') return <span class="record-badge suspended">已挂起</span>;
    return <span class="record-badge failed">失败 · 重试</span>;
  }

  private renderArchivePanel() {
    const students = this.archive.students;
    const selected = students.find((student) => student.id === this.selectedStudentId) ?? students[0];
    const eligibility = selected ? completionEligibility(this.archive, this.project, selected.id) : null;
    const completed = selected ? hasConclusion(this.archive, selected.id) : false;
    const conclusion = selected ? this.archive.conclusions.find((item) => item.studentId === selected.id) : undefined;
    const currentStep = this.currentStep;
    const pendingCount = this.archive.records.filter((record) => record.syncStatus === 'pending' && !record.invalidated).length;
    const suspendedCount = this.archive.records.filter((record) => record.syncStatus === 'suspended').length;
    const failedCount = this.archive.records.filter((record) => record.syncStatus === 'failed').length;
    const invalidatedCount = this.archive.records.filter((record) => record.invalidated).length;
    const unmatchedCount = this.archive.unmatched.length;
    const selectedRecords = selected ? recordsForStudent(this.archive, selected.id) : [];
    const localStudentNotInRemote = (record: MasteryRecord): boolean => {
      const student = this.archive.students.find((item) => item.id === record.studentId);
      if (!student) return false;
      return !this.remote.roster.some((item) => item.id === student.id || item.name === student.name);
    };

    return (
      <section class="archive-panel">
        <div class="archive-toolbar">
          <div class="archive-stats">
            <div><strong>{students.length}</strong><span>学员</span></div>
            <div><strong>{pendingCount}</strong><span>待同步</span></div>
            <div><strong>{suspendedCount}</strong><span>已挂起</span></div>
            <div><strong>{failedCount}</strong><span>失败</span></div>
            <div><strong>{invalidatedCount}</strong><span>已作废</span></div>
            <div><strong>{unmatchedCount}</strong><span>待补录</span></div>
          </div>
          <div class="archive-actions">
            <label class="simulate-toggle">
              <ion-toggle checked={this.simulateFailure} onIonChange={(event) => { this.simulateFailure = event.detail.checked; }} />
              <span>模拟同步失败</span>
            </label>
            <ion-button size="small" class="studio-button" onClick={() => this.reconcile()}>对账合并</ion-button>
          </div>
        </div>

        <div class="archive-body">
          <aside class="archive-roster">
            <div class="roster-add">
              <ion-input label="学员姓名" labelPlacement="stacked" class="studio-input" value={this.newStudentName} placeholder="例如 赵同学" onIonInput={(event) => { this.newStudentName = event.detail.value ?? ''; }} />
              <ion-input label="备注（可空）" labelPlacement="stacked" class="studio-input" value={this.newStudentNote} placeholder="教研组在册情况" onIonInput={(event) => { this.newStudentNote = event.detail.value ?? ''; }} />
              <ion-button size="small" class="studio-button" onClick={() => this.addStudent()}>添加学员</ion-button>
            </div>
            <div class="roster-list">
              {students.map((student) => (
                <button class={`roster-item ${student.id === selected?.id ? 'active' : ''}`} onClick={() => this.selectStudent(student.id)}>
                  <span class="roster-avatar">{student.name.slice(0, 1)}</span>
                  <span class="roster-copy">
                    <strong>{student.name}</strong>
                    <small>{hasConclusion(this.archive, student.id) ? '已结业' : '在学'}</small>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div class="archive-detail">
            {selected ? (
              <Fragment>
                <div class="detail-head">
                  <div>
                    <h2>{selected.name}</h2>
                    <small>{selected.note || '教研组在册学员'}</small>
                  </div>
                  <div class="detail-conclusion">
                    {completed && conclusion ? (
                      <span class="conclusion-badge">已结业 · {this.formatDate(conclusion.issuedAt)}</span>
                    ) : (
                      <ion-button size="small" class="studio-button" disabled={!eligibility?.eligible} onClick={() => this.issueCompletion()}>发出结业结论</ion-button>
                    )}
                  </div>
                </div>

                {eligibility && !completed && (
                  <div class="eligibility-bar">
                    <span>掌握进度 {eligibility.mastered}/{eligibility.total}</span>
                    <div class="eligibility-track"><span style={{ width: `${eligibility.total ? (eligibility.mastered / eligibility.total) * 100 : 0}%` }} /></div>
                  </div>
                )}

                {currentStep && (
                  <div class="record-mastery">
                    <h3>记录掌握 · {currentStep.title}</h3>
                    <p class="record-hint">按检查点记录，断网先存本机，恢复后按学员对账合并。</p>
                    <div class="checkpoint-record-list">
                      {currentStep.checkpoints.length === 0 && <p class="checkpoint-empty">当前步骤还没有检查点。</p>}
                      {currentStep.checkpoints.map((cp) => {
                        const existing = recordsForStep(this.archive, selected.id, currentStep.id).find((record) => record.checkpointId === cp.id && !record.invalidated);
                        return (
                          <div class="checkpoint-record-row" key={cp.id}>
                            <span class="cp-title">{cp.title}</span>
                            <span class="cp-time">{cp.time}s</span>
                            <div class="cp-actions">
                              <button class={existing?.level === '掌握' ? 'active master' : ''} onClick={() => this.recordMastery(cp.id, '掌握')}>掌握</button>
                              <button class={existing?.level === '未掌握' ? 'active unmaster' : ''} onClick={() => this.recordMastery(cp.id, '未掌握')}>未掌握</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div class="records-overview">
                  <h3>掌握记录</h3>
                  {selectedRecords.length === 0 && <p class="empty-records">暂无掌握记录。</p>}
                  <div class="record-list">
                    {selectedRecords.map((record) => (
                      <div class={`record-row ${record.invalidated ? 'invalidated' : ''}`} key={record.id}>
                        <div class="record-main">
                          <strong>{record.checkpointTitle || '未命名检查点'}</strong>
                          <small>{this.stepTitleOf(record.stepId)} · {record.level} · {this.formatDate(record.recordedAt)}</small>
                        </div>
                        <div class="record-tags">
                          {this.renderSyncBadge(record)}
                          {record.syncStatus === 'suspended' && localStudentNotInRemote(record) && (
                            <ion-button size="small" fill="outline" class="studio-button" onClick={() => this.addToRoster(this.archive.students.find((item) => item.id === record.studentId)!)}>加入教研组花名册</ion-button>
                          )}
                          {record.syncStatus === 'failed' && (
                            <ion-button size="small" fill="outline" class="studio-button" onClick={() => this.reconcile()}>重试</ion-button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Fragment>
            ) : (
              <div class="empty-detail">
                <div class="empty-glyph">档</div>
                <h2>学习档案为空</h2>
                <p>添加学员后即可按检查点记录掌握情况，断网也能先记。</p>
              </div>
            )}
          </div>
        </div>

        {unmatchedCount > 0 && (
          <div class="unmatched-section">
            <h3>补不上的检查点编号（单列）</h3>
            <div class="unmatched-list">
              {this.archive.unmatched.map((item) => (
                <div class="unmatched-item" key={item.id}>
                  <strong>{item.rawTitle}</strong>
                  <small>学员：{item.rawStudentName || '未知'} · {item.rawStepTitle || '未指定步骤'} · {item.reason}</small>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  private togglePlay(): void {
    if (this.playTimer) {
      window.clearInterval(this.playTimer);
      this.playTimer = undefined;
      this.playing = false;
      return;
    }
    const duration = Math.max(10, this.currentStep?.duration ?? 40);
    this.playing = true;
    this.playTimer = window.setInterval(() => {
      this.playProgress += 0.25 / duration;
      if (this.playProgress >= 1) {
        this.playProgress = 0;
        this.playing = false;
        if (this.playTimer) window.clearInterval(this.playTimer);
        this.playTimer = undefined;
      }
    }, 250);
  }

  private formatDate(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  }

  private renderStatusBadge() {
    if (this.project.status === 'review') return <ion-badge color="warning">待复核</ion-badge>;
    if (this.project.status === 'changes') return <ion-badge color="danger">已退回</ion-badge>;
    if (this.project.status === 'frozen') return <ion-badge color="success">已冻结</ion-badge>;
    return <ion-badge color="medium">草稿</ion-badge>;
  }

  private renderStepListItem(step: LessonStep, index: number) {
    const active = step.id === this.currentStep?.id;
    const issueCount = this.checks.filter((check) => check.stepId === step.id && check.severity !== 'info').length;
    return (
      <button class={`step-list-item ${active ? 'active' : ''}`} onClick={() => this.selectStep(step.id)}>
        <span class="step-index">{String(index + 1).padStart(2, '0')}</span>
        <span class="step-copy">
          <strong>{step.title}</strong>
          <small>{step.kind} · {step.duration}s · {step.difficulty}</small>
        </span>
        {issueCount > 0 && <span class="step-issue-count">{issueCount}</span>}
      </button>
    );
  }

  private renderStepEditor() {
    const step = this.currentStep;
    if (!step) {
      return (
        <div class="empty-editor">
          <div class="empty-glyph">手</div>
          <h2>这个模块还没有学习步骤</h2>
          <p>添加示范、讲解或练习步骤，然后设置前置条件与难度。</p>
          <ion-button class="studio-button" onClick={() => this.addStep('示范')}>添加第一个步骤</ion-button>
        </div>
      );
    }
    const frozen = this.project.status === 'frozen';
    const module = this.currentModule;
    const prerequisites = module.steps.filter((candidate, index) => candidate.id !== step.id && index < module.steps.findIndex((item) => item.id === step.id));
    return (
      <div class="step-editor">
        <div class="editor-title-row">
          <div>
            <span class="eyebrow">学习步骤 {module.steps.findIndex((item) => item.id === step.id) + 1}</span>
            <h1>{step.title}</h1>
            <p>最后修改 {this.formatDate(this.project.lastSavedAt)} · 修订号 {this.project.revision}</p>
          </div>
          <div class="title-actions">
            <ion-button fill="clear" class="studio-button" onClick={() => this.moveStep(-1)} title="Alt + ↑">上移</ion-button>
            <ion-button fill="clear" class="studio-button" onClick={() => this.moveStep(1)} title="Alt + ↓">下移</ion-button>
            <ion-button fill="outline" class="studio-button" onClick={() => this.duplicateStep()}>复制</ion-button>
            <ion-button fill="outline" color="danger" class="studio-button" onClick={() => this.deleteStep(step.id)}>删除</ion-button>
          </div>
        </div>

        {frozen && (
          <div class="frozen-callout">
            <div><strong>此版本已冻结</strong><span>字段已锁定，仍可预览和运行检查。</span></div>
            <ion-button size="small" class="studio-button" onClick={() => this.reviseFrozen()}>创建修订版</ion-button>
          </div>
        )}

        <section class="form-card">
          <div class="section-title"><span>01</span><div><h2>基础设计</h2><p>标题、类型、难度和预计时长</p></div></div>
          <div class="form-grid two">
            <ion-input disabled={frozen} label="步骤标题" labelPlacement="stacked" class="studio-input" value={step.title} onIonInput={(event) => this.updateStep({ title: event.detail.value ?? '' })} />
            <ion-select disabled={frozen} label="步骤类型" labelPlacement="stacked" class="studio-input" value={step.kind} onIonChange={(event) => this.updateStep({ kind: event.detail.value as LessonStep['kind'] })}>
              <ion-select-option value="示范">示范</ion-select-option>
              <ion-select-option value="讲解">讲解</ion-select-option>
              <ion-select-option value="练习">练习</ion-select-option>
            </ion-select>
            <ion-select disabled={frozen} label="难度标签" labelPlacement="stacked" class="studio-input" value={step.difficulty} onIonChange={(event) => this.updateStep({ difficulty: event.detail.value as Difficulty })}>
              {(['入门', '进阶', '挑战'] as Difficulty[]).map((item) => <ion-select-option value={item}>{item}</ion-select-option>)}
            </ion-select>
            <ion-input disabled={frozen} type="number" min="10" max="600" label="预计时长（秒）" labelPlacement="stacked" class="studio-input" value={String(step.duration)} onIonInput={(event) => this.updateStep({ duration: Number(event.detail.value) || 0 })} />
          </div>
        </section>

        <section class="form-card">
          <div class="section-title"><span>02</span><div><h2>示范片段与镜头</h2><p>记录素材标识、手形、镜头角度和动作区域</p></div></div>
          <div class="demo-row">
            <div class={`video-thumbnail zone-${step.gestureZone}`}>
              <span class="play-mark">▶</span>
              <strong>{step.kind}片段</strong>
              <small>{step.camera}</small>
            </div>
            <div class="demo-fields">
              <ion-input disabled={frozen} label="示范片段名称" labelPlacement="stacked" class="studio-input" value={step.demoTitle} onIonInput={(event) => this.updateStep({ demoTitle: event.detail.value ?? '' })} />
              <ion-input disabled={frozen} label="本地素材地址（可空）" labelPlacement="stacked" class="studio-input" value={step.demoUrl} placeholder="例如 assets/hello.mp4" onIonInput={(event) => this.updateStep({ demoUrl: event.detail.value ?? '' })} />
            </div>
          </div>
          <div class="form-grid two">
            <ion-select disabled={frozen} label="镜头角度" labelPlacement="stacked" class="studio-input" value={step.camera} onIonChange={(event) => this.updateStep({ camera: event.detail.value as CameraAngle })}>
              {(['正面', '左侧 45°', '右侧 45°', '俯拍手部', '全身远景'] as CameraAngle[]).map((item) => <ion-select-option value={item}>{item}</ion-select-option>)}
            </ion-select>
            <ion-select disabled={frozen} label="主要手形区域" labelPlacement="stacked" class="studio-input" value={step.gestureZone} onIonChange={(event) => this.updateStep({ gestureZone: event.detail.value as GestureZone })}>
              {(['左侧', '中央', '右侧'] as GestureZone[]).map((item) => <ion-select-option value={item}>{item}</ion-select-option>)}
            </ion-select>
          </div>
          <ion-textarea disabled={frozen} autoGrow label="手形说明" labelPlacement="stacked" class="studio-input" value={step.handshape} onIonInput={(event) => this.updateStep({ handshape: event.detail.value ?? '' })} />
        </section>

        <section class="form-card">
          <div class="section-title"><span>03</span><div><h2>字幕与无障碍</h2><p>检查字幕位置、动作遮挡与替代文本</p></div></div>
          <div class="form-grid two">
            <ion-select disabled={frozen} label="字幕位置" labelPlacement="stacked" class="studio-input" value={step.captionPosition} onIonChange={(event) => this.updateStep({ captionPosition: event.detail.value as CaptionPosition })}>
              {(['下方安全区', '上移 15%', '角标提示', '画面中央'] as CaptionPosition[]).map((item) => <ion-select-option value={item}>{item}</ion-select-option>)}
            </ion-select>
            <ion-input disabled={frozen} label="替代文本状态" labelPlacement="stacked" class={`studio-input ${step.altText ? '' : 'ion-invalid'}`} value={step.altText ? '已填写' : '缺失'} readonly />
          </div>
          <ion-textarea disabled={frozen} autoGrow label="步骤字幕" labelPlacement="stacked" class="studio-input" value={step.caption} onIonInput={(event) => this.updateStep({ caption: event.detail.value ?? '' })} />
          <ion-textarea disabled={frozen} autoGrow label="替代文本（必须描述动作与表情）" labelPlacement="stacked" class={`studio-input ${step.altText ? '' : 'ion-invalid'}`} value={step.altText} onIonInput={(event) => this.updateStep({ altText: event.detail.value ?? '' })} />
        </section>

        <section class="form-card">
          <div class="section-title"><span>04</span><div><h2>学习依赖与练习</h2><p>前置步骤、常见错误、练习任务与反馈</p></div></div>
          <div class="form-grid two">
            <ion-select disabled={frozen} label="前置条件" labelPlacement="stacked" class="studio-input" value={step.prerequisiteId} onIonChange={(event) => this.updateStep({ prerequisiteId: event.detail.value ?? '' })}>
              <ion-select-option value="">无前置条件</ion-select-option>
              {prerequisites.map((item) => <ion-select-option value={item.id}>{item.title}</ion-select-option>)}
            </ion-select>
            <div class="checkpoint-editor">
              <div class="checkpoint-editor-head">
                <span>检查点（编号 · 标题 · 秒）</span>
                <ion-button size="small" fill="clear" class="studio-button" disabled={frozen} onClick={() => this.addCheckpoint()}>＋ 添加检查点</ion-button>
              </div>
              {step.checkpoints.length === 0 && <p class="checkpoint-empty">暂无检查点，掌握记录将无法关联。</p>}
              {step.checkpoints.map((cp, index) => (
                <div class="checkpoint-row" key={cp.id}>
                  <span class="checkpoint-no">{index + 1}</span>
                  <ion-input disabled={frozen} class="studio-input checkpoint-title-input" value={cp.title} onIonInput={(event) => this.updateCheckpoint(cp.id, { title: event.detail.value ?? '' })} />
                  <ion-input disabled={frozen} type="number" min="0" max={step.duration} class="studio-input checkpoint-time-input" value={String(cp.time)} onIonInput={(event) => this.updateCheckpoint(cp.id, { time: Number(event.detail.value) || 0 })} />
                  <button class="checkpoint-remove" disabled={frozen} onClick={() => this.removeCheckpoint(cp.id)} title="删除检查点">×</button>
                </div>
              ))}
            </div>
          </div>
          <ion-textarea disabled={frozen} autoGrow label="常见错误（每行一条）" labelPlacement="stacked" class="studio-input" value={step.commonMistakes.join('\n')} onIonInput={(event) => this.updateStep({ commonMistakes: (event.detail.value ?? '').split('\n').filter(Boolean) })} />
          <div class="form-grid two">
            <ion-textarea disabled={frozen} autoGrow label="练习任务" labelPlacement="stacked" class="studio-input" value={step.exercise} onIonInput={(event) => this.updateStep({ exercise: event.detail.value ?? '' })} />
            <ion-textarea disabled={frozen} autoGrow label="练习反馈" labelPlacement="stacked" class="studio-input" value={step.exerciseFeedback} onIonInput={(event) => this.updateStep({ exerciseFeedback: event.detail.value ?? '' })} />
          </div>
        </section>
      </div>
    );
  }

  private renderPreview() {
    const step = this.currentStep;
    const progress = Math.round(this.playProgress * 100);
    return (
      <section class="preview-panel">
        <div class="preview-head">
          <div><span class="eyebrow">学习者预览</span><h2>设备与安全区检查</h2></div>
          <ion-segment value={this.previewSize} class="studio-segment" onIonChange={(event) => { this.previewSize = event.detail.value as PreviewSize; }}>
            <ion-segment-button value="phone">手机</ion-segment-button>
            <ion-segment-button value="tablet">平板</ion-segment-button>
          </ion-segment>
        </div>
        {step ? (
          <div class={`device-frame ${this.previewSize}`}>
            <div class="device-top"><span>{this.previewSize === 'phone' ? '9:16' : '4:3'}</span><span>{step.camera}</span></div>
            <div class={`preview-stage zone-${step.gestureZone} caption-${step.captionPosition.replace(/\s|%/g, '')} ${step.captionPosition === '画面中央' && step.gestureZone === '中央' ? 'overlap-warning' : ''}`}>
              <div class="stage-grid" />
              <div class="signer">
                <div class="head"><span class="face"><i /><i /></span></div>
                <div class="torso" />
                <div class="arm arm-left"><span class="hand" /></div>
                <div class="arm arm-right"><span class="hand" /></div>
              </div>
              <div class="gesture-marker" style={{ left: step.gestureZone === '左侧' ? '18%' : step.gestureZone === '右侧' ? '70%' : '43%' }} />
              <div class="caption-preview">{step.caption || '未填写字幕'}</div>
              {step.captionPosition === '角标提示' && <div class="corner-caption">{step.caption.slice(0, 18) || '角标提示'}</div>}
              <div class="safe-area"><span>字幕安全区</span></div>
            </div>
            <div class="player-controls">
              <button class="play-button" onClick={() => this.togglePlay()}>{this.playing ? 'Ⅱ' : '▶'}</button>
              <div class="player-timeline">
                <span style={{ width: `${progress}%` }} />
                {step.checkpoints.map((cp) => <i style={{ left: `${Math.min(100, (cp.time / Math.max(1, step.duration)) * 100)}%` }} title={`${cp.title} · ${cp.time}s`} />)}
              </div>
              <span class="time-code">{String(Math.floor(this.playProgress * step.duration)).padStart(2, '0')} / {step.duration}s</span>
            </div>
            <div class="preview-meta">
              <div><strong>{step.kind}</strong><span>步骤类型</span></div>
              <div><strong>{step.difficulty}</strong><span>难度标签</span></div>
              <div><strong>{step.checkpoints.length}</strong><span>检查点</span></div>
            </div>
            <p class="preview-caption-text">{step.caption}</p>
          </div>
        ) : <div class="empty-preview">选择步骤后显示设备预览。</div>}
      </section>
    );
  }

  private renderChecks() {
    const errors = this.checks.filter((check) => check.severity === 'error');
    const warnings = this.checks.filter((check) => check.severity === 'warning');
    const info = this.checks.filter((check) => check.severity === 'info');
    return (
      <section class="checks-panel">
        <div class="checks-summary">
          <div class="check-stat danger"><strong>{errors.length}</strong><span>阻断问题</span></div>
          <div class="check-stat warning"><strong>{warnings.length}</strong><span>需注意</span></div>
          <div class="check-stat"><strong>{info.length}</strong><span>优化建议</span></div>
        </div>
        <div class="check-list">
          {this.checks.length === 0 && <div class="all-clear"><strong>✓ 未发现问题</strong><p>字幕遮挡、步骤跳级和替代文本检查均已通过。</p></div>}
          {this.checks.map((check) => (
            <button class={`check-item ${check.severity}`} onClick={() => {
              if (check.moduleId) this.selectModule(check.moduleId);
              if (check.stepId) this.selectStep(check.stepId);
              this.activePanel = 'editor';
            }}>
              <span class="check-severity">{check.severity === 'error' ? '!' : check.severity === 'warning' ? '△' : 'i'}</span>
              <span><strong>{check.title}</strong><small>{check.detail}</small></span>
              <span class="check-arrow">→</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  render() {
    const module = this.currentModule;
    const errors = this.checks.filter((check) => check.severity === 'error').length;
    return (
      <Host>
        <ion-app>
          <ion-header class="studio-header">
            <ion-toolbar>
              <ion-buttons slot="start"><div class="logo-mark">手</div><div class="app-title"><strong>SignCourse Studio</strong><span>手语课程编排工具</span></div></ion-buttons>
              <ion-buttons slot="end" class="header-actions">
                <button class={`connection-status ${this.offline ? 'offline' : ''}`} onClick={() => { this.offline = !this.offline; this.showToast(this.offline ? 'warning' : 'success', this.offline ? '已进入离线模拟，编辑继续保存在本机。' : '已恢复在线模拟，本地草稿保持同步。'); }}><span />{this.offline ? '离线编辑中（点击恢复）' : '本地自动保存（点击模拟离线）'}</button>
                <ion-button fill="clear" class="studio-button" disabled={this.past.length === 0} onClick={() => this.undo()}>撤销</ion-button>
                <ion-button fill="clear" class="studio-button" disabled={this.future.length === 0} onClick={() => this.redo()}>重做</ion-button>
                <ion-button fill="outline" class="studio-button" onClick={() => this.saveDraft()}>保存草稿</ion-button>
                {this.project.status === 'review'
                  ? <ion-button color="success" class="studio-button" onClick={() => this.freezeVersion()}>冻结版本</ion-button>
                  : this.project.status === 'changes'
                    ? <ion-button color="warning" class="studio-button" onClick={() => this.submitForReview()}>重新提交</ion-button>
                    : this.project.status === 'frozen'
                      ? <ion-button class="studio-button" onClick={() => this.reviseFrozen()}>创建修订版</ion-button>
                      : <ion-button color="primary" class="studio-button" onClick={() => this.submitForReview()}>提交复核</ion-button>}
              </ion-buttons>
            </ion-toolbar>
          </ion-header>

          <ion-content fullscreen>
            <div class="project-ribbon">
              <div class="project-heading">
                {this.renderStatusBadge()}
                <ion-input value={this.project.title} class="project-title-input" onIonInput={(event) => { this.project = { ...this.project, title: event.detail.value ?? '' }; this.persist(); }} />
                <span>{this.project.teacher} · {this.project.audience}</span>
              </div>
              <div class="project-metrics">
                <div><strong>{this.project.modules.length}</strong><span>模块</span></div>
                <div><strong>{this.project.modules.reduce((sum, item) => sum + item.steps.length, 0)}</strong><span>步骤</span></div>
                <div><strong>{Math.ceil(this.project.modules.reduce((sum, item) => sum + item.steps.reduce((total, lesson) => total + lesson.duration, 0), 0) / 60)}</strong><span>分钟</span></div>
                <div class={errors ? 'has-errors' : ''}><strong>{errors}</strong><span>阻断问题</span></div>
              </div>
              <div class="workflow-actions">
                {this.project.status === 'review' && <ion-button fill="clear" color="danger" class="studio-button" onClick={() => this.returnForChanges()}>退回修改</ion-button>}
                {this.project.status === 'draft' && <ion-button fill="clear" class="studio-button" onClick={() => this.addModule()}>＋ 新建模块</ion-button>}
                <ion-button fill="clear" class="studio-button" onClick={() => this.addStep('练习')}>＋ 练习步骤</ion-button>
              </div>
            </div>

            <main class="studio-workspace">
              <aside class="course-panel">
                <div class="panel-heading"><div><span class="eyebrow">课程结构</span><h2>模块与步骤</h2></div><button class="add-step-button" onClick={() => this.addStep('示范')}>＋</button></div>
                <div class="module-list">
                  {this.project.modules.map((item) => (
                    <section class={`module-card ${item.id === module?.id ? 'active' : ''}`} key={item.id}>
                      <button class="module-head" onClick={() => this.selectModule(item.id)}>
                        <span class="module-color" style={{ background: item.color }} />
                        <span><strong>{item.title}</strong><small>{item.steps.length} 个学习步骤</small></span>
                      </button>
                      {item.id === module?.id && <div class="step-list">{item.steps.map((lesson, index) => this.renderStepListItem(lesson, index))}</div>}
                    </section>
                  ))}
                </div>
                <div class="module-editor">
                  <ion-input disabled={this.project.status === 'frozen'} label="当前模块标题" labelPlacement="stacked" class="studio-input" value={module?.title ?? ''} onIonInput={(event) => this.updateCurrentModule({ title: event.detail.value ?? '' })} />
                  <ion-textarea disabled={this.project.status === 'frozen'} autoGrow label="模块目标" labelPlacement="stacked" class="studio-input" value={module?.summary ?? ''} onIonInput={(event) => this.updateCurrentModule({ summary: event.detail.value ?? '' })} />
                </div>
              </aside>

              <section class="editor-panel">
                <div class="panel-switcher">
                  <button class={this.activePanel === 'editor' ? 'active' : ''} onClick={() => { this.activePanel = 'editor'; }}>步骤编排</button>
                  <button class={this.activePanel === 'checks' ? 'active' : ''} onClick={() => { this.activePanel = 'checks'; }}>发布前检查 <span>{this.checks.length}</span></button>
                  <button class={this.activePanel === 'archive' ? 'active' : ''} onClick={() => { this.activePanel = 'archive'; this.refreshInvalidation(); }}>学习档案 <span>{this.archive.records.filter((record) => record.syncStatus === 'pending' || record.syncStatus === 'suspended' || record.syncStatus === 'failed' || record.invalidated).length}</span></button>
                </div>
                <div class="editor-scroll">{this.activePanel === 'editor' ? this.renderStepEditor() : this.activePanel === 'checks' ? this.renderChecks() : this.renderArchivePanel()}</div>
              </section>

              {this.renderPreview()}
            </main>
          </ion-content>
          <ion-toast isOpen={Boolean(this.toast)} message={this.toast?.message} color={this.toast?.color} duration={3200} onDidDismiss={() => { this.toast = undefined; }} />
        </ion-app>
      </Host>
    );
  }
}
