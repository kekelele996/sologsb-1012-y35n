export type CourseStatus = 'draft' | 'review' | 'changes' | 'frozen';
export type Difficulty = '入门' | '进阶' | '挑战';
export type CameraAngle = '正面' | '左侧 45°' | '右侧 45°' | '俯拍手部' | '全身远景';
export type CaptionPosition = '下方安全区' | '上移 15%' | '角标提示' | '画面中央';
export type GestureZone = '左侧' | '中央' | '右侧';

/**
 * 检查点归编排台维护：编号 + 标题 + 所在秒数。
 * 学习档案里的掌握记录只按检查点编号（id）挂接。
 */
export interface Checkpoint {
  id: string;
  code: string;
  title: string;
  atSecond: number;
}

export interface LessonStep {
  id: string;
  title: string;
  kind: '示范' | '讲解' | '练习';
  duration: number;
  demoTitle: string;
  demoUrl: string;
  handshape: string;
  gestureZone: GestureZone;
  caption: string;
  captionPosition: CaptionPosition;
  camera: CameraAngle;
  commonMistakes: string[];
  exercise: string;
  exerciseFeedback: string;
  altText: string;
  prerequisiteId: string;
  difficulty: Difficulty;
  checkpoints: Checkpoint[];
}

export interface CourseModule {
  id: string;
  title: string;
  summary: string;
  color: string;
  steps: LessonStep[];
}

export interface FrozenVersion {
  id: string;
  label: string;
  createdAt: string;
  snapshot: Omit<CourseProject, 'frozenVersions'>;
}

export interface CourseProject {
  id: string;
  title: string;
  teacher: string;
  audience: string;
  status: CourseStatus;
  selectedModuleId: string;
  selectedStepId: string;
  modules: CourseModule[];
  frozenVersions: FrozenVersion[];
  lastSavedAt: string;
  revision: number;
}

export interface ValidationCheck {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  stepId?: string;
  moduleId?: string;
}

/** 供学习档案登记掌握记录时选择的检查点目录（只读投影）。 */
export interface CheckpointRef {
  id: string;
  code: string;
  title: string;
  stepId: string;
  stepTitle: string;
  moduleId: string;
  moduleTitle: string;
  atSecond: number;
}

export const PROJECT_STORAGE_KEY = 'sologsb-1012-sign-course-project-v2';
/** 升级前课程与掌握情况合订在一起的旧本地稿。 */
export const LEGACY_PROJECT_STORAGE_KEY = 'sologsb-1012-sign-course-project-v1';

/** 旧数据升级 / 演示数据生成检查点时使用的稳定编号。 */
export function seededCheckpointId(stepId: string, index: number): string {
  return `${stepId}-cp-${index + 1}`;
}

/** 教师在编排台新增检查点时使用的唯一编号。 */
export function createCheckpoint(stepId: string, code: number, atSecond = 0, title = ''): Checkpoint {
  return {
    id: `${stepId}-cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    code: `CP-${String(code).padStart(2, '0')}`,
    title,
    atSecond,
  };
}

export function selectedModule(project: CourseProject): CourseModule {
  return project.modules.find((module) => module.id === project.selectedModuleId) ?? project.modules[0];
}

export function selectedStep(project: CourseProject): LessonStep | undefined {
  const module = selectedModule(project);
  return module?.steps.find((step) => step.id === project.selectedStepId) ?? module?.steps[0];
}

/** 按模块/步骤顺序展开全部检查点，供学习档案侧只读引用。 */
export function listCheckpoints(project: CourseProject): CheckpointRef[] {
  const refs: CheckpointRef[] = [];
  project.modules.forEach((module) => {
    module.steps.forEach((step) => {
      step.checkpoints.forEach((checkpoint) => {
        refs.push({
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
  return refs;
}

/** 一次提交前后，检查点的改动明细。学习档案据此作废旧掌握记录。 */
export interface CheckpointDelta {
  id: string;
  stepId: string;
  oldTitle: string;
  newTitle: string;
}

export function diffProjectCheckpoints(before: CourseProject, after: CourseProject): { changed: CheckpointDelta[]; deleted: CheckpointDelta[] } {
  const beforeSteps = new Map<string, LessonStep>();
  before.modules.forEach((module) => module.steps.forEach((step) => beforeSteps.set(step.id, step)));

  const changed: CheckpointDelta[] = [];
  const deleted: CheckpointDelta[] = [];

  after.modules.forEach((module) => {
    module.steps.forEach((step) => {
      const oldStep = beforeSteps.get(step.id);
      if (!oldStep) return;
      const oldMap = new Map(oldStep.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
      step.checkpoints.forEach((checkpoint) => {
        const old = oldMap.get(checkpoint.id);
        if (!old) return;
        if (old.code !== checkpoint.code || old.title !== checkpoint.title || old.atSecond !== checkpoint.atSecond) {
          changed.push({ id: checkpoint.id, stepId: step.id, oldTitle: old.title, newTitle: checkpoint.title });
        }
      });
    });
  });

  after.modules.forEach((module) => {
    module.steps.forEach((step) => beforeSteps.delete(step.id));
  });
  beforeSteps.forEach((step) => {
    step.checkpoints.forEach((checkpoint) => {
      deleted.push({ id: checkpoint.id, stepId: step.id, oldTitle: checkpoint.title, newTitle: checkpoint.title });
    });
  });

  return { changed, deleted };
}

export function validateProject(project: CourseProject): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  if (!project.title.trim()) checks.push({ id: 'title', severity: 'error', title: '课程标题缺失', detail: '发布前需要为课程填写清晰标题。' });
  if (project.modules.length === 0) checks.push({ id: 'modules', severity: 'error', title: '没有课程模块', detail: '至少需要创建一个包含学习步骤的模块。' });

  project.modules.forEach((module) => {
    if (!module.steps.length) {
      checks.push({ id: `empty-${module.id}`, severity: 'error', title: `${module.title} 没有学习步骤`, detail: '空模块无法进入复核。', moduleId: module.id });
    }
    module.steps.forEach((step, index) => {
      if (!step.altText.trim()) {
        checks.push({ id: `alt-${step.id}`, severity: 'error', title: `${step.title} 缺少替代文本`, detail: '示范片段需要描述手形、移动和面部表情。', stepId: step.id, moduleId: module.id });
      }
      if (!step.caption.trim()) {
        checks.push({ id: `caption-${step.id}`, severity: 'warning', title: `${step.title} 缺少字幕`, detail: '听障学习者在静音预览时无法获得说明。', stepId: step.id, moduleId: module.id });
      }
      if (step.captionPosition === '画面中央' && (step.gestureZone === '中央' || step.camera === '俯拍手部')) {
        checks.push({ id: `overlap-${step.id}`, severity: 'error', title: `${step.title} 字幕可能遮挡动作`, detail: `字幕位于${step.captionPosition}，而主要手形位于${step.gestureZone}。`, stepId: step.id, moduleId: module.id });
      }
      if (step.duration < 20) {
        checks.push({ id: `duration-${step.id}`, severity: 'warning', title: `${step.title} 时长过短`, detail: '示范与练习不足 20 秒，学习者来不及观察和跟做。', stepId: step.id, moduleId: module.id });
      }
      if (step.prerequisiteId) {
        const prerequisiteIndex = module.steps.findIndex((candidate) => candidate.id === step.prerequisiteId);
        if (prerequisiteIndex < 0) {
          checks.push({ id: `missing-pre-${step.id}`, severity: 'error', title: `${step.title} 的前置步骤不存在`, detail: '请重新选择前置条件或移除依赖。', stepId: step.id, moduleId: module.id });
        } else if (prerequisiteIndex >= index) {
          checks.push({ id: `jump-${step.id}`, severity: 'error', title: `${step.title} 出现步骤跳级`, detail: '前置步骤位于当前步骤之后，学习顺序无法成立。', stepId: step.id, moduleId: module.id });
        }
      }
      if (step.kind === '练习' && (!step.exercise.trim() || !step.exerciseFeedback.trim())) {
        checks.push({ id: `practice-${step.id}`, severity: 'warning', title: `${step.title} 的练习反馈不完整`, detail: '练习任务需要明确完成动作和即时反馈方式。', stepId: step.id, moduleId: module.id });
      }
      if (step.commonMistakes.filter(Boolean).length === 0) {
        checks.push({ id: `mistakes-${step.id}`, severity: 'info', title: `${step.title} 尚未记录常见错误`, detail: '补充常见错误有助于教师现场提示。', stepId: step.id, moduleId: module.id });
      }
      const seenCodes = new Set<string>();
      step.checkpoints.forEach((checkpoint) => {
        if (!checkpoint.title.trim()) {
          checks.push({ id: `cp-title-${checkpoint.id}`, severity: 'warning', title: `${step.title} 有检查点缺标题`, detail: '学习档案要按检查点标题登记掌握情况，请补全标题。', stepId: step.id, moduleId: module.id });
        }
        if (!checkpoint.code.trim()) {
          checks.push({ id: `cp-code-${checkpoint.id}`, severity: 'warning', title: `${step.title} 有检查点缺编号`, detail: '编号是掌握记录挂接检查点的凭据。', stepId: step.id, moduleId: module.id });
        } else if (seenCodes.has(checkpoint.code)) {
          checks.push({ id: `cp-dup-${checkpoint.id}`, severity: 'warning', title: `${step.title} 的检查点编号 ${checkpoint.code} 重复`, detail: '同一学习步骤内的检查点编号必须唯一。', stepId: step.id, moduleId: module.id });
        } else {
          seenCodes.add(checkpoint.code);
        }
        if (checkpoint.atSecond < 0 || checkpoint.atSecond > step.duration) {
          checks.push({ id: `cp-time-${checkpoint.id}`, severity: 'warning', title: `检查点 ${checkpoint.code || checkpoint.title} 超出步骤时长`, detail: `检查点需要落在 0–${step.duration} 秒之间。`, stepId: step.id, moduleId: module.id });
        }
      });
    });
  });

  return checks;
}

export function cloneProject(project: CourseProject): CourseProject {
  return structuredClone(project);
}
