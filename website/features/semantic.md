# 语义摘要

IGraph 为文件和符号生成 LLM 语义摘要，让图谱不仅包含结构信息，还包含**语义理解**。

## 工作原理

构建过程中，IGraph 将每个符号的源代码和上下文信息发送给 LLM，生成简洁的语义描述。摘要存储在图谱数据库中，供检索和展示使用。

### 符号摘要

对每个函数、类、组件等符号，LLM 生成一句话摘要，描述其职责和行为：

> `verifyToken` — 验证 JWT 令牌的有效性，检查签名和过期时间，返回解码后的用户信息

### 文件摘要

对每个文件，基于其导出符号和内部逻辑生成文件级概述：

> `src/auth/jwt.ts` — JWT 认证模块，提供令牌生成、验证和刷新功能

## 启发式降级

当没有 `IGRAPH_API_KEY` 或使用 `--no-llm` 标志时，IGraph 自动切换到启发式摘要：

```bash
igraph build --no-llm
```

启发式方案基于符号名称、参数签名和代码结构自动生成描述，无需联网：

> `verifyToken(token: string): Promise<User>` — 接受 token 参数，返回 User 类型的 Promise

虽然不如 LLM 摘要精确，但保证离线可用。

## 配置

在 `.igraph/config.json` 的 `llm` 部分：

```json
{
  "llm": {
    "baseURL": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "fileSummaryModel": "gpt-4o",
    "temperature": 0,
    "maxConcurrency": 5,
    "promptVersion": "v1.0"
  }
}
```

| 字段 | 说明 |
|------|------|
| `model` | 符号摘要使用的模型（轻量、快速） |
| `fileSummaryModel` | 文件摘要使用的模型（更强的理解力） |
| `maxConcurrency` | 并发请求数，避免触发限流 |

::: tip 成本控制
符号摘要使用 `gpt-4o-mini` 等轻量模型即可，文件摘要建议使用更强的模型以获得更好的概述质量。
:::
