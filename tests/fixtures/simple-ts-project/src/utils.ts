import { createUser } from "./service.js";
import type { User } from "./types.js";

/** 导出：批量创建用户（跨文件调用 createUser） */
export function createUsers(names: string[]): User[] {
  return names.map((name, idx) => createUser(idx, name));
}

/** 导出：格式化用户为字符串 */
export function formatUser(user: User): string {
  return `#${user.id} ${user.name}`;
}

/** 内部常量（非导出，变量节点） */
const DEFAULT_LIMIT = 100;