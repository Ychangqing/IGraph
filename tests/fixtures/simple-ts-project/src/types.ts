/** 领域类型定义 */
export interface User {
  id: number;
  name: string;
}

export type UserList = User[];

export interface Repository<T> {
  findAll(): T[];
}

export abstract class BaseService {
  abstract name(): string;
}

/** 内部辅助类型（非导出） */
type InternalFlag = boolean;