"""数据模型模块。"""

__all__ = ["User", "BaseModel"]


class BaseModel:
    """基础模型。"""

    def save(self) -> None:
        pass


class User(BaseModel):
    """用户模型，继承 BaseModel。"""

    def __init__(self, name: str) -> None:
        self.name = name

    def describe(self) -> str:
        return normalize(self.name)


def normalize(value: str) -> str:
    return value.strip().lower()


def _private_helper() -> int:
    return 42


MAX_USERS = 100