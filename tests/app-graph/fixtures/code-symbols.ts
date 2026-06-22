export async function runTask() {
  return true;
}

function localHelper() {
  return "ok";
}

export class TaskRunner {}

export interface TaskInput {
  name: string;
}

export type TaskResult = {
  ok: boolean;
};

export enum TaskState {
  Ready = "ready",
}

export const TASK_LIMIT = 3;

const internalFlag = localHelper();
