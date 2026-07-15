import { createUsers, formatUser } from "./utils.js";
import type { User } from "./types.js";

/** 导出 Hook：use 开头 → hook 节点 */
export function useUsers(names: string[]): User[] {
  return createUsers(names);
}

/** 内部组件：大写开头 → component 节点 */
function UserItem(props: { user: User }): JSX.Element {
  return <li>{formatUser(props.user)}</li>;
}

/** 导出组件：使用 useUsers hook + 渲染 UserItem（JSX 引用） */
export function UserListView(props: { names: string[] }): JSX.Element {
  const users = useUsers(props.names);
  return (
    <ul>
      {users.map((u) => (
        <UserItem key={u.id} user={u} />
      ))}
    </ul>
  );
}