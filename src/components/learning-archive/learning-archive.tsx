import { Component, Host, Prop, State, Watch, h } from '@stencil/core';
import type { CheckpointRef } from '../../models';
import {
  addMasteryRecord,
  addStudent,
  bindUnmatched,
  concludeStudent,
  discardUnmatched,
  isGraduated,
  loadArchive,
  reconcile,
  setSimulateTransportFailure,
  studentRecords,
  updateStudent,
  type ArchiveState,
  type GraduationOutcome,
  type MasteryLevel,
  type MasteryRecord,
  type ReconcileResult,
  type Student,
  type SuspendedEntry,
} from '../../data/archive-store';

type DraftRecord = { checkpointId: string; level: MasteryLevel; note: string };

@Component({
  tag: 'learning-archive',
  styleUrl: 'learning-archive.css',
  scoped: true,
})
export class LearningArchive {
  /** 编排台检查点目录（只读），由 app-root 注入，档案不反向改课程。 */
  @Prop() checkpoints: CheckpointRef[] = [];
  @Prop() online = true;

  @State() archive: ArchiveState | null = null;
  @State() selectedStudentId = '';
  @State() showAddStudent = false;
  @State() showAddRecord = false;
  @State() draftRecord: DraftRecord = { checkpointId: '', level: '已掌握', note: '' };
  @State() dismissMigration = false;
  @State() toast?: { color: string; message: string };

  componentWillLoad(): void {
    this.reload();
  }

  @Watch('online')
  handleOnlineChange(online: boolean): void {
    if (online && this.archive?.outbox.length) {
      // 恢复联网后自动按学员对账。
      const { state, result } = reconcile(true);
      this.archive = { ...state };
      this.flashResult(result);
    }
  }

  private reload(): void {
    this.archive = loadArchive();
    if (this.archive && !this.archive.students.some((student) => student.id === this.selectedStudentId)) {
      this.selectedStudentId = this.archive.students[0]?.id ?? '';
    }
  }

  private showToast(color: string, message: string): void {
    this.toast = { color, message };
    window.setTimeout(() => {
      if (this.toast?.message === message) this.toast = undefined;
    }, 3_600);
  }

  private flashResult(result: ReconcileResult): void {
    const color = result.status === 'ok' ? 'success' : result.status === 'offline' ? 'medium' : 'warning';
    this.showToast(color, result.message);
  }

  private get currentStudent(): Student | undefined {
    return this.archive?.students.find((student) => student.id === this.selectedStudentId);
  }

  private get currentRecords(): MasteryRecord[] {
    return this.archive ? studentRecords(this.archive, this.selectedStudentId) : [];
  }

  private get currentGraduated(): boolean {
    return this.archive ? isGraduated(this.archive, this.selectedStudentId) : false;
  }

  private checkpointName(record: MasteryRecord): string {
    const ref = this.checkpoints.find((item) => item.id === record.checkpointId);
    if (ref) return `${ref.code} · ${ref.title}`;
    return record.checkpointTitleSnapshot || record.checkpointId || '未知检查点';
  }

  private checkpointRef(record: MasteryRecord): CheckpointRef | undefined {
    return this.checkpoints.find((item) => item.id === record.checkpointId);
  }

  private formatDate(value?: string): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  }

  private runReconcile(preferArchive = false): void {
    const { state, result } = reconcile(this.online, preferArchive);
    this.archive = { ...state };
    this.flashResult(result);
  }

  private handleAddStudent(event: Event): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return this.showToast('warning', '学员姓名不能为空。');
    const state = addStudent({ name, className: String(data.get('className') ?? ''), note: String(data.get('note') ?? '') });
    this.archive = { ...state };
    this.showAddStudent = false;
    this.selectedStudentId = state.students[state.students.length - 1].id;
    this.showToast('success', this.online ? '学员已建档并入队对账。' : '当前离线，学员已先记在本机待对账。');
  }

  private saveStudentNote(field: 'name' | 'className' | 'note', value: string): void {
    if (!this.currentStudent) return;
    const state = updateStudent(this.currentStudent.id, { [field]: value });
    this.archive = { ...state };
  }

  private openAddRecord(): void {
    if (!this.currentStudent) return;
    if (this.currentGraduated) return this.showToast('medium', '该学员已结业，掌握记录照旧保留，不再新增登记。');
    this.draftRecord = { checkpointId: this.checkpoints[0]?.id ?? '', level: '已掌握', note: '' };
    this.showAddRecord = true;
  }

  private handleAddRecord(event: Event): void {
    event.preventDefault();
    const checkpoint = this.checkpoints.find((item) => item.id === this.draftRecord.checkpointId);
    if (!checkpoint) return this.showToast('warning', '请先选择检查点。');
    const state = addMasteryRecord({
      studentId: this.selectedStudentId,
      checkpointId: checkpoint.id,
      checkpointTitle: `${checkpoint.code} · ${checkpoint.title}`,
      level: this.draftRecord.level,
      note: this.draftRecord.note,
    });
    this.archive = { ...state };
    this.showAddRecord = false;
    this.showToast('success', this.online ? '掌握记录已登记并入队对账。' : '当前离线，掌握记录已先记在本机，恢复后按学员对账。');
  }

  private conclude(outcome: GraduationOutcome): void {
    if (!this.currentStudent) return;
    const valid = this.currentRecords.filter((record) => record.status === 'valid');
    if (valid.length === 0) return this.showToast('warning', '还没有掌握记录，不能出具结业结论。');
    const note = window.prompt(outcome === '结业' ? '结业结论备注（可留空）：' : '未结业原因（可留空）：', '') ?? '';
    const state = concludeStudent(this.currentStudent.id, outcome, note);
    this.archive = { ...state };
    this.showToast('success', outcome === '结业' ? '已登记结业结论；此后检查点改动不再作废该学员记录。' : '已登记未结业结论。');
  }

  private handleBind(unmatchedId: string, event: Event): void {
    const checkpointId = (event.target as HTMLSelectElement).value;
    if (!checkpointId) return;
    const ref = this.checkpoints.find((item) => item.id === checkpointId);
    if (!ref) return;
    const state = bindUnmatched(unmatchedId, checkpointId, `${ref.code} · ${ref.title}`);
    this.archive = { ...state };
    this.showToast('success', `已按编号 ${ref.code} 回填并转入正式掌握记录。`);
  }

  private handleDiscard(unmatchedId: string): void {
    const state = discardUnmatched(unmatchedId);
    this.archive = { ...state };
    this.showToast('medium', '该旧记录已从档案中剔除。');
  }

  private toggleFailureSimulation(enabled: boolean): void {
    const state = setSimulateTransportFailure(enabled);
    this.archive = { ...state };
    this.showToast(enabled ? 'warning' : 'success', enabled ? '已开启教研组故障模拟，下一次对账会失败。' : '已关闭故障模拟。');
  }

  private renderMigrationBanner() {
    if (this.dismissMigration || !this.archive?.migration) return null;
    const info = this.archive.migration;
    return (
      <div class="archive-banner">
        <div>
          <strong>旧合订稿已拆分（{this.formatDate(info.at)}）</strong>
          <span>
            编排台与学习档案分开维护；{info.matchedCount} 条旧掌握记录已按检查点标题回填编号
            {info.unmatchedCount > 0 ? `，${info.unmatchedCount} 条补不上编号，已在下方单列。` : '，全部回填成功。'}
          </span>
        </div>
        <ion-button fill="clear" size="small" class="archive-button" onClick={() => { this.dismissMigration = true; }}>知道了</ion-button>
      </div>
    );
  }

  private renderSyncStatus() {
    const outboxCount = this.archive?.outbox.length ?? 0;
    const suspendedCount = this.archive?.suspended.length ?? 0;
    return (
      <section class="archive-card sync-card">
        <div class="archive-card-head">
          <div><span class="archive-eyebrow">断网记账 / 对账合并</span><h2>教研组档案对账</h2></div>
          <span class={`sync-pill ${this.online ? 'online' : 'offline'}`}>{this.online ? '在线' : '离线 · 先记本机'}</span>
        </div>
        <div class="sync-metrics">
          <div><strong>{outboxCount}</strong><span>待对账学员</span></div>
          <div><strong>{suspendedCount}</strong><span>挂起</span></div>
          <div><strong>{this.archive?.lastReconcileAt ? this.formatDate(this.archive.lastReconcileAt) : '—'}</strong><span>上次对账</span></div>
        </div>
        {this.archive?.lastReconcileResult && <p class="sync-last-result">{this.archive.lastReconcileResult.message}</p>}
        <div class="sync-actions">
          <ion-button size="small" class="archive-button" disabled={!this.online || outboxCount === 0} onClick={() => this.runReconcile(false)}>立即按学员对账</ion-button>
          <label class="failure-toggle">
            <input type="checkbox" checked={this.archive?.simulateTransportFailure ?? false} onChange={(event) => this.toggleFailureSimulation((event.target as HTMLInputElement).checked)} />
            模拟教研组档案故障
          </label>
        </div>
        {this.renderSuspended()}
      </section>
    );
  }

  private renderSuspended() {
    const suspended = this.archive?.suspended ?? [];
    if (suspended.length === 0) return null;
    return (
      <div class="suspend-list">
        {suspended.map((entry) => {
          const student = this.archive?.students.find((item) => item.id === entry.studentId);
          return this.renderSuspendedEntry(entry, student);
        })}
      </div>
    );
  }

  private renderSuspendedEntry(entry: SuspendedEntry, student?: Student) {
    return (
      <div class={`suspend-item ${entry.reason}`} key={entry.id}>
        <div class="suspend-head">
          <strong>{student?.name ?? entry.studentId}</strong>
          <span>{entry.reason === 'conflict' ? `对账对不上 · ${entry.conflicts.length} 处差异` : '对账失败'}</span>
        </div>
        {entry.reason === 'conflict' ? (
          <ul class="conflict-list">
            {entry.conflicts.map((conflict) => (
              <li>
                <span class="conflict-label">{conflict.label}</span>
                <span class="conflict-side local">档案侧：{conflict.local}</span>
                <span class="conflict-side remote">教研组：{conflict.remote}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="fail-detail">{entry.lastError}</p>
        )}
        <div class="suspend-actions">
          <ion-button size="small" color="primary" class="archive-button" onClick={() => this.runReconcile(true)}>按档案侧重试</ion-button>
          <span class="attempts">第 {entry.attempts} 次检测</span>
        </div>
      </div>
    );
  }

  private renderStudentSidebar() {
    const students = this.archive?.students ?? [];
    return (
      <aside class="student-panel">
        <div class="archive-card-head">
          <div><span class="archive-eyebrow">学员名册</span><h2>{students.length} 名学员</h2></div>
          <ion-button size="small" fill="outline" class="archive-button" onClick={() => { this.showAddStudent = true; }}>＋ 建档</ion-button>
        </div>
        <div class="student-list">
          {students.map((student) => {
            const graduated = this.archive ? isGraduated(this.archive, student.id) : false;
            const pending = this.archive?.outbox.some((entry) => entry.studentId === student.id);
            return (
              <button class={`student-item ${student.id === this.selectedStudentId ? 'active' : ''}`} onClick={() => { this.selectedStudentId = student.id; }}>
                <span class="student-avatar">{student.name.slice(0, 1)}</span>
                <span class="student-copy">
                  <strong>{student.name}{graduated && <em class="graduated-tag">已结业</em>}</strong>
                  <small>{student.className || '未分班'}{pending ? ' · 待对账' : ''}</small>
                </span>
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  private renderStudentDetail() {
    const student = this.currentStudent;
    if (!student) {
      return <div class="empty-detail">选择或新建一名学员，开始登记手语掌握情况。</div>;
    }
    const conclusion = this.archive?.conclusions.find((item) => item.studentId === student.id);
    return (
      <section class="detail-panel">
        <div class="detail-head">
          <input class="student-name-input" value={student.name} disabled={this.currentGraduated} onChange={(event) => this.saveStudentNote('name', (event.target as HTMLInputElement).value)} />
          {conclusion && <span class={`conclusion-badge ${conclusion.outcome === '结业' ? 'pass' : 'fail'}`}>{conclusion.outcome}</span>}
        </div>
        <div class="student-fields">
          <input value={student.className} placeholder="班级" disabled={this.currentGraduated} onChange={(event) => this.saveStudentNote('className', (event.target as HTMLInputElement).value)} />
          <textarea value={student.note} placeholder="学员备注" disabled={this.currentGraduated} onChange={(event) => this.saveStudentNote('note', (event.target as HTMLTextAreaElement).value)} />
        </div>
        {conclusion && <p class="conclusion-note">结论时间 {this.formatDate(conclusion.concludedAt)}{conclusion.note ? ` · ${conclusion.note}` : ''}</p>}

        <div class="record-toolbar">
          <h3>掌握记录（{this.currentRecords.length}）</h3>
          <ion-button size="small" class="archive-button" onClick={() => this.openAddRecord()}>＋ 登记检查点</ion-button>
        </div>
        <div class="record-list">
          {this.currentRecords.length === 0 && <p class="empty-records">还没有掌握记录。</p>}
          {this.currentRecords.map((record) => {
            const ref = this.checkpointRef(record);
            return (
              <div class={`record-item ${record.status === 'voided' ? 'voided' : ''}`} key={record.id}>
                <span class={`level-badge level-${record.level}`}>{record.level}</span>
                <span class="record-body">
                  <strong>{this.checkpointName(record)}</strong>
                  <small>{ref ? `${ref.moduleTitle} / ${ref.stepTitle}` : '检查点在编排台已找不到'}</small>
                  {record.note && <small class="record-note">{record.note}</small>}
                  {record.status === 'voided' && <small class="void-reason">{record.voidReason}（{this.formatDate(record.voidedAt)}）</small>}
                </span>
                <span class="record-meta">
                  <small>{record.source === 'legacy' ? '旧稿回填' : '档案登记'}</small>
                  <small>{this.formatDate(record.recordedAt)}</small>
                </span>
              </div>
            );
          })}
        </div>

        <div class="conclude-actions">
          <ion-button size="small" color="success" fill={conclusion?.outcome === '结业' ? 'solid' : 'outline'} class="archive-button" disabled={this.currentGraduated} onClick={() => this.conclude('结业')}>出具结业结论</ion-button>
          <ion-button size="small" color="warning" fill="outline" class="archive-button" disabled={this.currentGraduated} onClick={() => this.conclude('未结业')}>登记未结业</ion-button>
          {this.currentGraduated && <span class="frozen-hint">已结业学员的记录冻结保留，检查点调整不再作废。</span>}
        </div>
      </section>
    );
  }

  private renderUnmatched() {
    const unmatched = this.archive?.unmatched ?? [];
    return (
      <section class="archive-card unmatched-card">
        <div class="archive-card-head">
          <div><span class="archive-eyebrow">旧数据升级 · 补不上检查点编号</span><h2>单列待处理（{unmatched.length}）</h2></div>
        </div>
        {unmatched.length === 0 ? (
          <p class="empty-unmatched">旧掌握记录已全部按标题回填编号。</p>
        ) : (
          <div class="unmatched-list">
            {unmatched.map((item) => {
              const student = this.archive?.students.find((candidate) => candidate.id === item.studentId);
              return (
                <div class="unmatched-item" key={item.id}>
                  <span class={`level-badge level-${item.level}`}>{item.level}</span>
                  <span class="unmatched-body">
                    <strong>{item.checkpointTitle}</strong>
                    <small>{student?.name ?? item.studentId} · {this.formatDate(item.recordedAt)} · {item.note}</small>
                  </span>
                  <select key={item.id} class="bind-select" onChange={(event) => this.handleBind(item.id, event)}>
                    <option value="" selected>按现有检查点补绑…</option>
                    {this.checkpoints.map((ref) => <option value={ref.id}>{ref.code} · {ref.title}（{ref.stepTitle}）</option>)}
                  </select>
                  <ion-button size="small" fill="clear" color="danger" class="archive-button" onClick={() => this.handleDiscard(item.id)}>剔除</ion-button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  private renderAddStudentModal() {
    if (!this.showAddStudent) return null;
    return (
      <div class="modal-backdrop" onClick={() => { this.showAddStudent = false; }}>
        <form class="modal-card" onSubmit={(event) => this.handleAddStudent(event)} onClick={(event) => event.stopPropagation()}>
          <h3>新建学员档案</h3>
          <input name="name" placeholder="姓名 *" autoFocus />
          <input name="className" placeholder="班级" />
          <textarea name="note" placeholder="备注" />
          <div class="modal-actions">
            <ion-button fill="clear" class="archive-button" type="button" onClick={() => { this.showAddStudent = false; }}>取消</ion-button>
            <ion-button class="archive-button" type="submit">建档</ion-button>
          </div>
        </form>
      </div>
    );
  }

  private renderAddRecordModal() {
    if (!this.showAddRecord) return null;
    return (
      <div class="modal-backdrop" onClick={() => { this.showAddRecord = false; }}>
        <form class="modal-card" onSubmit={(event) => this.handleAddRecord(event)} onClick={(event) => event.stopPropagation()}>
          <h3>登记掌握情况</h3>
          <select onChange={(event) => { this.draftRecord = { ...this.draftRecord, checkpointId: (event.target as HTMLSelectElement).value }; }}>
            {this.checkpoints.map((ref) => <option value={ref.id} selected={ref.id === this.draftRecord.checkpointId}>{ref.code} · {ref.title}（{ref.moduleTitle} / {ref.stepTitle}）</option>)}
          </select>
          <div class="level-picker">
            {(['已掌握', '基本掌握', '需练习'] as MasteryLevel[]).map((level) => (
              <button type="button" class={this.draftRecord.level === level ? `active level-${level}` : `level-${level}`} onClick={() => { this.draftRecord = { ...this.draftRecord, level }; }}>{level}</button>
            ))}
          </div>
          <textarea placeholder="评语（可留空）" value={this.draftRecord.note} onInput={(event) => { this.draftRecord = { ...this.draftRecord, note: (event.target as HTMLTextAreaElement).value }; }} />
          <div class="modal-actions">
            <ion-button fill="clear" class="archive-button" type="button" onClick={() => { this.showAddRecord = false; }}>取消</ion-button>
            <ion-button class="archive-button" type="submit">保存登记</ion-button>
          </div>
        </form>
      </div>
    );
  }

  render() {
    return (
      <Host>
        <div class="archive-shell">
          {this.renderMigrationBanner()}
          <div class="archive-grid">
            {this.renderStudentSidebar()}
            {this.renderStudentDetail()}
            <div class="archive-side">
              {this.renderSyncStatus()}
              {this.renderUnmatched()}
            </div>
          </div>
        </div>
        {this.renderAddStudentModal()}
        {this.renderAddRecordModal()}
        <ion-toast isOpen={Boolean(this.toast)} message={this.toast?.message} color={this.toast?.color} duration={3600} onDidDismiss={() => { this.toast = undefined; }} />
      </Host>
    );
  }
}
