<script setup>
import { ref, onMounted } from 'vue'

const showComparison = ref(false)

onMounted(() => {
  // Comparison scroll reveal
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        showComparison.value = true
        observer.disconnect()
      }
    },
    { threshold: 0.1 }
  )
  const el = document.querySelector('.compare-section')
  if (el) observer.observe(el)
})
</script>

<template>
  <div class="home-custom">
    <!-- Hero -->
    <section class="hero-section">
      <div class="hero-glow"></div>
      <h1 class="hero-title">IGraph</h1>
      <p class="hero-subtitle">代码知识图谱构建工具</p>
      <p class="hero-tagline">
        解析 → 语义化 → 向量化，将代码仓库转化为可查询的知识图谱，让 AI 助手真正理解你的代码
      </p>
      <div class="hero-actions">
        <a href="/IGraph/guide/quick-start" class="btn-primary">快速开始 →</a>
        <a href="/IGraph/reference/cli" class="btn-secondary">CLI 参考</a>
      </div>
      <div class="hero-install">
        <span class="prompt">$</span>
        <code>npm install -g igraph-cli</code>
      </div>
    </section>

    <!-- 动态对比 -->
    <section class="compare-section" :class="{ visible: showComparison }">
      <p class="section-label">对比效果</p>
      <h2 class="section-title">同一个需求，两种结果</h2>
      <p class="section-desc">当 AI 助手接入代码知识图谱后，从「凭猜测修改」变为「精准跨模态编排」。</p>

      <div class="compare-prompt">
        <span class="compare-prompt-text">给交易溯源查询加按币种筛选条件。</span>
      </div>
      <div class="compare-grid">
        <!-- 左：普通 Agent -->
        <div class="compare-card compare-left">
          <div class="compare-card-header">
            <span class="terminal-dot red"></span>
            <span class="terminal-dot yellow"></span>
            <span class="terminal-dot green"></span>
            <span class="compare-card-title">Coding Agent</span>
          </div>
          <div class="compare-card-body">
            <div class="compare-step">
              <span class="step-dot dot-blue"></span>
              <span class="step-text"><code>grep "交易溯源"</code> · <code>grep "币种"</code> — 反复检索关键词定位相关文件</span>
            </div>
            <div class="compare-narrative">
              看起来要在交易溯源查询页加一个币种筛选，我先找到相关页面和查询函数改一下。
            </div>
            <div class="compare-step">
              <span class="step-dot dot-blue"></span>
              <span class="step-text">Edit 交易溯源查询页组件 — 新增币种筛选下拉</span>
            </div>
            <div class="compare-step">
              <span class="step-dot dot-blue"></span>
              <span class="step-text">Edit getTradeOriginList — 凭猜测加了 currency 查询参数</span>
            </div>
            <div class="compare-result">
              <span class="result-icon">😊</span>
              <span>完成！已加上币种筛选下拉和查询参数。</span>
            </div>
            <div class="compare-note">字段名和可选币种我是按常见写法猜的，你确认下对不对。</div>
            <div class="compare-missed">
              <div class="missed-header"><span class="missed-icon">⚠</span> 遗漏了这些</div>
              <div class="missed-item"><span class="x-mark">✕</span> <strong>PRD 验收标准</strong> — 未读 PRD-023，漏了「币种为空时展示全部」等规则</div>
              <div class="missed-item"><span class="x-mark">✕</span> <strong>DB 真实字段</strong> — 猜成 currency，实际是 t_trade_origin.currency_code</div>
              <div class="missed-item"><span class="x-mark">✕</span> <strong>币种下拉数据源</strong> — 没接 useEnum 枚举，选项写死或缺失</div>
              <div class="missed-item"><span class="x-mark">✕</span> <strong>导出底表</strong> — exportLogisticsTrade 未同步加币种筛选</div>
              <div class="missed-item"><span class="x-mark">✕</span> <strong>后端接口参数</strong> — 服务端查询未加 currency_code 过滤</div>
              <div class="missed-item"><span class="x-mark">✕</span> <strong>集成测试</strong> — 用例会因参数结构变化而失败</div>
            </div>
          </div>
        </div>

        <!-- 右：Agent + IGraph -->
        <div class="compare-card compare-right">
          <div class="compare-card-header">
            <span class="terminal-dot red"></span>
            <span class="terminal-dot yellow"></span>
            <span class="terminal-dot green"></span>
            <span class="compare-card-title">Coding Agent</span>
            <span class="mcp-badge">✦ IGraph MCP</span>
          </div>
          <div class="compare-card-body">
            <div class="compare-step">
              <span class="step-dot dot-cyan"></span>
              <span class="step-text"><code>igraph_explore "交易溯源 币种筛选"</code> · 语义级检索（非关键词 grep）</span>
            </div>
            <div class="compare-hit">
              <div class="hit-header"><span class="hit-icon">🎯</span> 已澄清需求：一次命中 PRD-023 + getTradeOriginList + currency_code 字段</div>
              <div class="hit-item"><span class="hit-tag">PRD</span> PRD-023《交易溯源查询》— 币种为空时展示全部等验收规则</div>
              <div class="hit-item"><span class="hit-tag">FN</span> getTradeOriginList — 交易溯源列表查询函数</div>
              <div class="hit-item"><span class="hit-tag">DB</span> t_trade_origin.currency_code — 币种真实字段</div>
              <div class="hit-item"><span class="hit-tag">FN</span> useEnum — 币种下拉枚举来源</div>
              <div class="hit-item"><span class="hit-tag">FN</span> exportLogisticsTrade — 导出物流交易底表</div>
            </div>
            <div class="compare-narrative">
              需求已澄清：按 currency_code 字段筛选，币种取 useEnum 枚举，空值查全部。这是跨模态改动，计划如下：
            </div>
            <div class="compare-plan">
              <div class="plan-header"><span class="plan-icon">🚀</span> 计划 · 6 步</div>
              <div class="plan-item">1. PRD-023 验收规则对齐（空值展示全部）</div>
              <div class="plan-item">2. getTradeOriginList 新增 currency_code 过滤</div>
              <div class="plan-item">3. 后端接口新增 currency_code 参数</div>
              <div class="plan-item">4. useEnum 币种下拉数据源接入</div>
              <div class="plan-item">5. exportLogisticsTrade 同步币种筛选</div>
              <div class="plan-item">6. 更新交易溯源集成测试</div>
            </div>
            <div class="compare-step">
              <span class="step-dot dot-cyan"></span>
              <span class="step-text">Edit 跨模态精准改动共 <strong>6 个文件</strong></span>
            </div>
            <div class="compare-result compare-result-ok">
              <span class="result-icon">😎</span>
              <span>完成。字段名精准、符合 PRD 规则、导出与测试同步更新，完整 diff 已就绪。</span>
            </div>
            <div class="compare-passed">
              <div class="passed-header"><span class="passed-icon">✅</span> 无一遗漏</div>
              <div class="passed-tags">
                <span class="pass-tag">✓ PRD 验收标准</span>
                <span class="pass-tag">✓ DB 真实字段</span>
                <span class="pass-tag">✓ 币种下拉数据源</span>
                <span class="pass-tag">✓ 导出底表</span>
                <span class="pass-tag">✓ 后端接口参数</span>
                <span class="pass-tag">✓ 集成测试</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 图谱可视化 -->
    <section class="graph-section">
      <p class="section-label">可视化探索</p>
      <h2 class="section-title">看见代码库的全貌</h2>
      <p class="section-desc">每个符号是一个节点，每条调用和依赖是一条边。节点越大，连接越多。</p>
      <div class="graph-window">
        <div class="graph-window-header">
          <span class="terminal-dot red"></span>
          <span class="terminal-dot yellow"></span>
          <span class="terminal-dot green"></span>
          <span class="graph-window-title">igraph · graph view</span>
        </div>
        <div class="graph-canvas">
          <img src="/graph.svg" alt="Code knowledge graph visualization" style="width:100%;height:100%;object-fit:contain;" />
        </div>
      </div>
      <div class="graph-legend">
        <span class="legend-item"><span class="legend-dot" style="background:#93c5fd"></span> 代码符号</span>
        <span class="legend-item"><span class="legend-dot" style="background:#f97066"></span> PRD 文档</span>
        <span class="legend-item"><span class="legend-dot" style="background:#fbbf24"></span> DB Schema</span>
        <span class="legend-item"><span class="legend-line" style="background:rgba(255,255,255,0.35)"></span> 调用 &amp; 依赖</span>
      </div>
    </section>

    <!-- Terminal 模拟 -->
    <section class="terminal-section">
      <p class="section-label">工作流程</p>
      <h2 class="section-title">三条命令，从零到可查询</h2>
      <p class="section-desc">初始化、构建、注册。IGraph 自动处理解析、摘要、向量化与 MCP 接入。</p>
      <div class="terminal">
        <div class="terminal-header">
          <span class="terminal-dot red"></span>
          <span class="terminal-dot yellow"></span>
          <span class="terminal-dot green"></span>
          <span class="terminal-title">Terminal</span>
        </div>
        <div class="terminal-body">
          <div><span class="prompt">❯ </span><span class="cmd">igraph init</span></div>
          <div><span class="ok">✓</span> 配置文件已生成：<span class="info">.igraph/config.json</span></div>
          <div>&nbsp;</div>
          <div><span class="prompt">❯ </span><span class="cmd">igraph build</span></div>
          <div><span class="ok">✓</span> 解析完成：<span class="num">142</span> 个文件，<span class="num">856</span> 个符号节点</div>
          <div><span class="ok">✓</span> 语义摘要：<span class="num">856</span> 个符号 + <span class="num">142</span> 个文件</div>
          <div><span class="ok">✓</span> 向量索引：<span class="num">998</span> 条嵌入已写入</div>
          <div><span class="dim">   耗时 12.3s</span></div>
          <div>&nbsp;</div>
          <div><span class="prompt">❯ </span><span class="cmd">igraph register</span></div>
          <div><span class="ok">✓</span> 已注册到 <span class="info">Claude Code</span>：.mcp.json</div>
          <div><span class="ok">✓</span> 已注册到 <span class="info">Cursor</span>：.cursor/mcp.json</div>
        </div>
      </div>
    </section>

    <!-- Feature 卡片 -->
    <section class="features-section">
      <p class="section-label">核心能力</p>
      <h2 class="section-title">为 AI 编码而生的知识图谱</h2>
      <p class="section-desc">从代码解析到语义理解，从向量检索到 MCP 集成，覆盖完整链路。</p>
      <div class="features-grid">
        <div class="feature-card">
          <span class="feature-icon">🌳</span>
          <div class="feature-title">多语言解析</div>
          <div class="feature-desc">tree-sitter 驱动的 5-Pass 流水线，支持 TypeScript / JavaScript / Python，提取函数、类、组件及调用关系</div>
        </div>
        <div class="feature-card">
          <span class="feature-icon">🧠</span>
          <div class="feature-title">语义摘要</div>
          <div class="feature-desc">LLM 为文件与符号生成语义级摘要，无 API Key 时自动走启发式降级方案</div>
        </div>
        <div class="feature-card">
          <span class="feature-icon">🔍</span>
          <div class="feature-title">双通道检索</div>
          <div class="feature-desc">BGE-M3 向量 + FTS5 全文检索经 RRF 融合，精准定位代码符号与逻辑</div>
        </div>
        <div class="feature-card">
          <span class="feature-icon">📎</span>
          <div class="feature-title">多模态挂载</div>
          <div class="feature-desc">挂载 PRD 文档、DB Schema 等外部资源，按语义相似度建立跨模态关联</div>
        </div>
        <div class="feature-card">
          <span class="feature-icon">⚡</span>
          <div class="feature-title">增量构建</div>
          <div class="feature-desc">基于 SHA-256 diff 的级联更新机制，仅重建受影响文件，大幅节省构建时间</div>
        </div>
        <div class="feature-card">
          <span class="feature-icon">🤖</span>
          <div class="feature-title">MCP 集成</div>
          <div class="feature-desc">一条命令接入 Cursor / Claude Code，AI 助手可直接查询知识图谱</div>
        </div>
      </div>
    </section>

    <!-- Pipeline -->
    <section class="pipeline-section">
      <p class="section-label">工作原理</p>
      <h2 class="section-title">从源代码到智能检索</h2>
      <p class="section-desc">IGraph 通过三个阶段将代码仓库转化为 AI 可查询的知识图谱。</p>
      <div class="pipeline">
        <div class="pipeline-step">
          <div class="step-number">01</div>
          <div class="step-content">
            <div class="step-title">解析 — 构建结构图</div>
            <div class="step-desc">tree-sitter 解析源代码，提取函数、类、组件等符号节点，建立调用、继承、导入等关系边。</div>
          </div>
        </div>
        <div class="pipeline-step">
          <div class="step-number">02</div>
          <div class="step-content">
            <div class="step-title">语义化 — 注入理解</div>
            <div class="step-desc">LLM 为每个符号和文件生成语义摘要，BGE-M3 将摘要和源码转化为 1024 维向量。</div>
          </div>
        </div>
        <div class="pipeline-step">
          <div class="step-number">03</div>
          <div class="step-content">
            <div class="step-title">服务 — AI 助手直接查询</div>
            <div class="step-desc">通过 MCP Server 暴露 4 个只读检索 Tool，AI 助手用自然语言提问，返回相关符号和上下文。</div>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="cta-section">
      <h2 class="cta-title">让 AI 助手理解你的整个代码库</h2>
      <p class="cta-desc">三条命令即可完成接入，从此告别上下文丢失。</p>
      <a href="/IGraph/guide/quick-start" class="btn-primary">开始使用 →</a>
    </section>
  </div>
</template>
