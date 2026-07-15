"""服务模块：从 models 导入并调用。"""

from models import User, normalize
import models


def create_user(name: str) -> User:
    cleaned = normalize(name)
    return User(cleaned)


def bulk_create(names: list) -> list:
    return [create_user(n) for n in names]


class UserService(User):
    """继承 User 的服务类。"""

    def run(self) -> None:
        create_user("admin")