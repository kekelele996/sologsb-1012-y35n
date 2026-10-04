/**
 * 升级前的旧本地稿：课程与手语课掌握情况合订在一份文件里。
 * 学习记录只有检查点标题，没有检查点编号——升级时要按标题回填。
 */

export interface LegacyLessonStep {
  id: string;
  title: string;
  kind: '示范' | '讲解' | '练习';
  duration: number;
  demoTitle: string;
  demoUrl: string;
  handshape: string;
  gestureZone: '左侧' | '中央' | '右侧';
  caption: string;
  captionPosition: '下方安全区' | '上移 15%' | '角标提示' | '画面中央';
  camera: '正面' | '左侧 45°' | '右侧 45°' | '俯拍手部' | '全身远景';
  commonMistakes: string[];
  exercise: string;
  exerciseFeedback: string;
  altText: string;
  prerequisiteId: string;
  difficulty: '入门' | '进阶' | '挑战';
  cuePoints: number[];
}

export interface LegacyMasteryRecord {
  id: string;
  studentId: string;
  /** 旧数据只有检查点标题，没有编号。 */
  checkpointTitle: string;
  level: '已掌握' | '基本掌握' | '需练习';
  note: string;
  recordedAt: string;
}

export interface LegacyStudent {
  id: string;
  name: string;
  className: string;
  note: string;
}

export interface LegacyGraduationConclusion {
  studentId: string;
  outcome: '结业' | '未结业';
  concludedAt: string;
  note: string;
}

export interface LegacyCombinedDraft {
  id: string;
  title: string;
  teacher: string;
  audience: string;
  status: 'draft' | 'review' | 'changes' | 'frozen';
  selectedModuleId: string;
  selectedStepId: string;
  modules: Array<{
    id: string;
    title: string;
    summary: string;
    color: string;
    steps: LegacyLessonStep[];
  }>;
  frozenVersions: unknown[];
  lastSavedAt: string;
  revision: number;
  /** 教研组档案曾被抄进同一份本地稿里的部分。 */
  students: LegacyStudent[];
  masteryRecords: LegacyMasteryRecord[];
  conclusions: LegacyGraduationConclusion[];
}

export function createLegacyFixture(): LegacyCombinedDraft {
  return {
    id: 'sign-course-project',
    title: '零基础手语 · 问候与数量',
    teacher: '陈老师 / 特殊教育中心',
    audience: '初次接触手语的初中学习者',
    status: 'draft',
    selectedModuleId: 'module-1',
    selectedStepId: 'step-1-2',
    modules: [
      {
        id: 'module-1',
        title: '模块一 · 日常问候',
        summary: '建立手形、视线和面部表情之间的配合，完成三个基础问候。',
        color: '#15827a',
        steps: [
          {
            id: 'step-1-1',
            title: '观察“你好”的完整动作',
            kind: '示范',
            duration: 35,
            demoTitle: '你好 · 正面慢速示范',
            demoUrl: '',
            handshape: '右手掌张开，拇指向上，自额头向外送出',
            gestureZone: '右侧',
            caption: '你好：手掌从额前向前送出，同时保持微笑。',
            captionPosition: '下方安全区',
            camera: '正面',
            commonMistakes: ['手掌过于僵硬', '没有视线交流'],
            exercise: '跟随示范完成两次，每次保持两秒。',
            exerciseFeedback: '镜面检查手掌高度是否与眉线一致。',
            altText: '教师面向镜头，用右手掌从额头向前送出，并点头微笑。',
            prerequisiteId: '',
            difficulty: '入门',
            cuePoints: [4, 16, 28],
          },
          {
            id: 'step-1-2',
            title: '拆解“你好”的手形',
            kind: '讲解',
            duration: 50,
            demoTitle: '你好 · 手部近景',
            demoUrl: '',
            handshape: '四指并拢，拇指张开；掌心朝左前侧',
            gestureZone: '中央',
            caption: '注意四指并拢，动作沿身体中轴向前。',
            captionPosition: '画面中央',
            camera: '俯拍手部',
            commonMistakes: ['拇指贴住掌心', '动作方向偏向一侧'],
            exercise: '固定肩部，只移动前臂完成五次。',
            exerciseFeedback: '如果动作跑偏，先在镜前标记起点和终点。',
            altText: '手部近景展示四指并拢、拇指张开的起始手形。',
            prerequisiteId: 'step-1-1',
            difficulty: '入门',
            cuePoints: [6, 24, 42],
          },
          {
            id: 'step-1-3',
            title: '双人问候练习',
            kind: '练习',
            duration: 75,
            demoTitle: '你好 · 双人轮流练习',
            demoUrl: '',
            handshape: '保持标准手形，配合点头与视线交换',
            gestureZone: '中央',
            caption: '轮流问候，每次动作结束后停一拍，再交换角色。',
            captionPosition: '上移 15%',
            camera: '全身远景',
            commonMistakes: ['动作过早结束', '两人视线没有相遇'],
            exercise: '两人一组轮流完成问候，交换三次。',
            exerciseFeedback: '同伴负责确认视线和动作停顿。',
            altText: '两名学习者相对站立，交替做出问候动作并看向对方。',
            prerequisiteId: 'step-1-2',
            difficulty: '进阶',
            cuePoints: [10, 34, 57],
          },
        ],
      },
      {
        id: 'module-2',
        title: '模块二 · 数量表达',
        summary: '用数字、空间位置和顺序词完成价格询问。',
        color: '#8a3ffc',
        steps: [
          {
            id: 'step-2-1',
            title: '数字一到五的稳定手形',
            kind: '讲解',
            duration: 60,
            demoTitle: '数字 1—5 · 镜面视图',
            demoUrl: '',
            handshape: '食指到五指依次展开，手心朝前',
            gestureZone: '中央',
            caption: '数字一到五：从食指开始依次增加，不移动手腕。',
            captionPosition: '下方安全区',
            camera: '正面',
            commonMistakes: ['拇指遮挡手指数', '手腕左右摆动'],
            exercise: '按随机口令连续展示 1—5。',
            exerciseFeedback: '每个数字保持一秒，同伴随机报数。',
            altText: '教师手心朝前，依次伸出食指到五指，展示数字一到五。',
            prerequisiteId: '',
            difficulty: '入门',
            cuePoints: [8, 26, 44],
          },
          {
            id: 'step-2-2',
            title: '组合成“多少钱”',
            kind: '示范',
            duration: 45,
            demoTitle: '多少钱 · 双手组合动作',
            demoUrl: '',
            handshape: '双手在胸前交替翻转，随后食指向前点出',
            gestureZone: '中央',
            caption: '先做“钱”的交替手形，再用食指向前询问。',
            captionPosition: '角标提示',
            camera: '右侧 45°',
            commonMistakes: ['两手动作不同步', '疑问表情缺失'],
            exercise: '配合疑问表情完成三次询问。',
            exerciseFeedback: '录下动作，检查双手是否在胸前同一高度。',
            altText: '教师双手机械交替翻转后，食指朝前点出并抬眉疑问。',
            prerequisiteId: 'step-2-1',
            difficulty: '进阶',
            cuePoints: [5, 22, 37],
          },
        ],
      },
    ],
    frozenVersions: [],
    lastSavedAt: '2026-09-20T08:30:00.000Z',
    revision: 7,
    students: [
      { id: 'student-lin', name: '林小满', className: '初二手语兴趣班', note: '反应快，表情配合好。' },
      { id: 'student-zhao', name: '赵一诺', className: '初二手语兴趣班', note: '动作幅度偏小。' },
      { id: 'student-chen', name: '陈昊', className: '初二手语兴趣班', note: '旁听补录。' },
      { id: 'student-zhou', name: '周启明', className: '社区夜校班', note: '旧档案转来。' },
      { id: 'student-sun', name: '孙悦', className: '社区夜校班', note: '' },
    ],
    masteryRecords: [
      {
        id: 'legacy-rec-1',
        studentId: 'student-lin',
        checkpointTitle: '观察点 1 · 4s',
        level: '已掌握',
        note: '额前送掌高度准确，微笑自然。',
        recordedAt: '2026-09-22T09:10:00.000Z',
      },
      {
        id: 'legacy-rec-2',
        studentId: 'student-zhao',
        checkpointTitle: '观察点 2 · 24s',
        level: '基本掌握',
        note: '拇指偶尔贴掌心。',
        recordedAt: '2026-09-23T03:40:00.000Z',
      },
      {
        id: 'legacy-rec-3',
        studentId: 'student-chen',
        checkpointTitle: '观察点 1 · 4s',
        level: '需练习',
        note: '动作方向需要再纠正。',
        recordedAt: '2026-09-24T01:55:00.000Z',
      },
      {
        id: 'legacy-rec-4',
        studentId: 'student-zhou',
        checkpointTitle: '旧版“道别”手势检查点',
        level: '基本掌握',
        note: '旧稿标题在现课程里找不到。',
        recordedAt: '2026-08-30T07:20:00.000Z',
      },
      {
        id: 'legacy-rec-5',
        studentId: 'student-sun',
        checkpointTitle: '数字九到十（旧版）',
        level: '需练习',
        note: '课程改版后该检查点已删除。',
        recordedAt: '2026-09-02T06:00:00.000Z',
      },
    ],
    conclusions: [
      {
        studentId: 'student-lin',
        outcome: '结业',
        concludedAt: '2026-09-28T10:00:00.000Z',
        note: '全部检查点通过，结业证书编号 NO.2026-0091。',
      },
    ],
  };
}
