import { BaseService } from "./types.js";
import type { User, UserList, Repository } from "./types.js";

/** 内部：规范化用户名 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** 导出：创建用户（调用内部 normalizeName） */
export function createUser(id: number, name: string): User {
  const clean = normalizeName(name);
  return { id, name: clean };
}

/** 导出类：实现 Repository、继承 BaseService */
export class UserService extends BaseService implements Repository<User> {
  private users: UserList = [];

  name(): string {
    return "UserService";
  }

  add(id: number, rawName: string): User {
    const user = createUser(id, rawName);
    this.users.push(user);
    return user;
  }

  findAll(): User[] {
    return this.users;
  }
}