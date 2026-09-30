export type TaskType = 'command' | 'ai_chat';

export interface Task {
  id: string;
  userId: number;
  groupId?: number;
  chatType: '私聊' | '群聊';
  type: TaskType;
  label: string;
  execute: () => Promise<void>;
  createdAt: number;
}

type NotifyUserFn = (userId: number, message: string) => Promise<void>;
type NotifyGroupFn = (groupId: number, userId: number, message: string) => Promise<void>;

export class TaskManager {
  private commandRunning = new Map<string, Task>();
  private commandQueue: Task[] = [];
  private aiChatRunning: Task | null = null;
  private aiChatQueue: Task[] = [];
  private notifyUser: NotifyUserFn;
  private notifyGroup: NotifyGroupFn;

  static MAX_COMMAND_CONCURRENT = 5;
  static MAX_AI_CHAT_CONCURRENT = 1;
  static MAX_TASKS_PER_USER = 3;
  static TASK_TIMEOUT_MS = 60000;

  constructor(notifyUser: NotifyUserFn, notifyGroup: NotifyGroupFn) {
    this.notifyUser = notifyUser;
    this.notifyGroup = notifyGroup;
  }

  enqueue(taskDef: Omit<Task, 'id' | 'createdAt'>): number {
    const task: Task = {
      ...taskDef,
      id: `${taskDef.type}_${taskDef.userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now()
    };

    if (taskDef.type === 'command') {
      const userCount = this.countUserTasks(task.userId, 'command');
      if (userCount >= TaskManager.MAX_TASKS_PER_USER) {
        const msg = `你已有 ${userCount} 个任务在排队中，请等待完成后再试~`;
        this.sendNotify(task, msg);
        return -1;
      }

      if (this.commandRunning.size < TaskManager.MAX_COMMAND_CONCURRENT) {
        this.runTask(task, 'command');
        return 0;
      }

      this.commandQueue.push(task);
      const position = this.commandQueue.length;
      this.sendNotify(task,
        `📋 你的「${task.label}」任务已进入执行队列\n当前排队位置：第 ${position} 位（共 ${TaskManager.MAX_COMMAND_CONCURRENT} 个并发槽位）\n请耐心等待~`);
      return position;
    } else {
      const userCount = this.countUserTasks(task.userId, 'ai_chat');
      if (userCount >= TaskManager.MAX_TASKS_PER_USER) {
        this.sendNotify(task, `你已有 AI 对话在排队中，请等待完成后再试~`);
        return -1;
      }

      if (!this.aiChatRunning) {
        this.runTask(task, 'ai_chat');
        return 0;
      }

      this.aiChatQueue.push(task);
      const position = this.aiChatQueue.length;
      this.sendNotify(task,
        `💬 AI 回复正在排队，前方还有 ${position} 人\n轮到你会自动回复的~`);
      return position;
    }
  }

  get statusText(): string {
    const cmdRunning = this.commandRunning.size;
    const cmdQueued = this.commandQueue.length;
    const aiRunning = this.aiChatRunning ? 1 : 0;
    const aiQueued = this.aiChatQueue.length;
    return [
      `📊 任务队列状态`,
      `指令任务: ${cmdRunning}/${TaskManager.MAX_COMMAND_CONCURRENT} 运行中, ${cmdQueued} 排队中`,
      `AI对话: ${aiRunning}/${TaskManager.MAX_AI_CHAT_CONCURRENT} 运行中, ${aiQueued} 排队中`,
    ].join('\n');
  }

  private countUserTasks(userId: number, type: TaskType): number {
    if (type === 'command') {
      const running = Array.from(this.commandRunning.values()).filter(t => t.userId === userId).length;
      const queued = this.commandQueue.filter(t => t.userId === userId).length;
      return running + queued;
    }
    const running = this.aiChatRunning?.userId === userId ? 1 : 0;
    const queued = this.aiChatQueue.filter(t => t.userId === userId).length;
    return running + queued;
  }

  private sendNotify(task: Task, message: string) {
    if (task.chatType === '群聊' && task.groupId) {
      this.notifyGroup(task.groupId, task.userId, message);
    } else {
      this.notifyUser(task.userId, message);
    }
  }

  private async runTask(task: Task, type: TaskType) {
    if (type === 'command') {
      this.commandRunning.set(task.id, task);
    } else {
      this.aiChatRunning = task;
      if (task.chatType === '群聊' && task.groupId) {
        this.notifyGroup(task.groupId, task.userId, `轮到你了！正在思考中...`);
      }
    }

    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('任务执行超时')), TaskManager.TASK_TIMEOUT_MS);
    });

    try {
      await Promise.race([task.execute(), timeout]);
    } catch (err: any) {
      console.error(`[TaskManager] 任务 ${task.id} (${task.label}) 失败:`, err.message);
      const failMsg = `你的「${task.label}」任务执行失败了：${err.message}`;
      if (task.chatType === '群聊' && task.groupId) {
        this.notifyGroup(task.groupId, task.userId, failMsg);
      } else {
        this.notifyUser(task.userId, failMsg);
      }
    }

    if (type === 'command') {
      this.commandRunning.delete(task.id);
      this.tryDequeue('command');
    } else {
      this.aiChatRunning = null;
      this.tryDequeue('ai_chat');
    }
  }

  private tryDequeue(type: TaskType) {
    if (type === 'command') {
      while (this.commandQueue.length > 0 && this.commandRunning.size < TaskManager.MAX_COMMAND_CONCURRENT) {
        const next = this.commandQueue.shift()!;
        this.runTask(next, 'command');
      }
    } else {
      if (this.aiChatQueue.length > 0 && !this.aiChatRunning) {
        const next = this.aiChatQueue.shift()!;
        this.runTask(next, 'ai_chat');
      }
    }
  }
}
