<script setup>
import { ref, onMounted, computed } from 'vue'
import { useData } from 'vitepress'

const { lang } = useData()
const isEn = computed(() => lang.value === 'en-US')

const t = computed(() => isEn.value ? {
  heroSubtitle: 'Code Knowledge Graph Builder',
  heroTagline: 'Parse → Summarize → Vectorize — turn your codebase into a queryable knowledge graph so AI assistants truly understand your code',
  quickStart: 'Quick Start →',
  cliRef: 'CLI Reference',
  compareLabel: 'Comparison',
  compareTitle: 'Same task, two outcomes',
  compareDesc: 'When an AI assistant connects to a code knowledge graph, it goes from "guessing" to "precise cross-modal orchestration".',
  comparePrompt: 'Add a payment status filter to the order list.',
  codingAgent: 'Coding Agent',
  agentStep1: 'grep "order" · grep "payment status" — repeatedly searches keywords to find files',
  agentNarrative: 'Looks like I need to add a payment status filter to the order list page. Let me find the page and query function.',
  agentStep2: 'Edit order list component — add payment status dropdown',
  agentStep3: 'Edit getOrderList — guesses a status query param',
  agentResult: 'Done! Added payment status filter dropdown and query param.',
  agentNote: 'I guessed the field name and status values based on common patterns — please verify.',
  missedHeader: 'Missed these',
  missed1: 'PRD acceptance criteria — didn\'t read PRD-012, missed rules like "auto-close unpaid orders after 30 min"',
  missed2: 'Actual DB field — guessed status, but it\'s t_order.pay_status (different enum values)',
  missed3: 'Status dropdown data source — didn\'t use useDict dictionary, options hardcoded or missing',
  missed4: 'Export feature — exportOrderList not updated with payment status filter',
  missed5: 'Backend API params — server query missing pay_status filter',
  missed6: 'Unit tests — test cases will fail due to param structure change',
  igraphStep1: 'igraph_explore "order list payment status filter" · semantic search (not keyword grep)',
  hitHeader: 'Requirements clarified: one query hits PRD-012 + getOrderList + pay_status field',
  hitPRD: 'PRD-012 "Order Management" — unpaid over 30 min not displayed, etc.',
  hitFN1: 'getOrderList — order list query function',
  hitDB: 't_order.pay_status — actual payment status field',
  hitFN2: 'useDict — payment status dropdown dictionary',
  hitFN3: 'exportOrderList — order export function',
  igraphNarrative: 'Requirements clarified: filter by pay_status field, status values from useDict dictionary, unpaid orders over 30 min not displayed. Cross-modal change plan:',
  planHeader: 'Plan · 6 steps',
  plan1: '1. Align with PRD-012 acceptance rules (hide timeout unpaid)',
  plan2: '2. Add pay_status filter to getOrderList',
  plan3: '3. Add pay_status param to backend API',
  plan4: '4. Integrate useDict payment status dictionary',
  plan5: '5. Sync pay_status filter to exportOrderList',
  plan6: '6. Update order list unit tests',
  igraphStep2: 'Edit precise cross-modal changes across 6 files',
  igraphResult: 'Done. Exact field names, PRD-compliant rules, export & tests updated — full diff ready.',
  passedHeader: 'Nothing missed',
  pass1: '✓ PRD acceptance criteria',
  pass2: '✓ Actual DB field',
  pass3: '✓ Status dropdown source',
  pass4: '✓ Export feature',
  pass5: '✓ Backend API params',
  pass6: '✓ Unit tests',
  graphLabel: 'Visual Exploration',
  graphTitle: 'See the full picture of your codebase',
  graphDesc: 'Every symbol is a node, every call and dependency is an edge. Larger nodes have more connections.',
  graphWindowTitle: 'igraph · graph view',
  legendSymbol: 'Code Symbols',
  legendPRD: 'PRD Docs',
  legendDB: 'DB Schema',
  legendEdge: 'Calls & Dependencies',
  terminalLabel: 'Workflow',
  terminalTitle: 'Three commands, zero to queryable',
  terminalDesc: 'Init, build, register. IGraph handles parsing, summarization, vectorization, and MCP integration automatically.',
  terminalInit: 'igraph init',
  terminalInitOk: 'Config file generated:',
  terminalBuild: 'igraph build',
  terminalBuildParse: 'Parsed:',
  terminalBuildParseDetail: ' files,',
  terminalBuildParseNodes: ' symbol nodes',
  terminalBuildSummary: 'Semantic summaries:',
  terminalBuildSummaryDetail: ' symbols + ',
  terminalBuildSummaryFiles: ' files',
  terminalBuildVector: 'Vector index:',
  terminalBuildVectorDetail: ' embeddings written',
  terminalBuildTime: '   took 12.3s',
  terminalRegister: 'igraph register',
  terminalRegisterClaude: 'Registered to',
  terminalRegisterCursor: 'Registered to',
  featuresLabel: 'Core Capabilities',
  featuresTitle: 'A knowledge graph built for AI coding',
  featuresDesc: 'From code parsing to semantic understanding, from vector retrieval to MCP integration — covering the full pipeline.',
  feature1Title: 'Multi-Language Parsing',
  feature1Desc: 'tree-sitter powered 5-pass pipeline, supports TypeScript / JavaScript / Python, extracts functions, classes, components and call relationships',
  feature2Title: 'Semantic Summaries',
  feature2Desc: 'LLM generates semantic summaries for files and symbols; automatically falls back to heuristics without an API Key',
  feature3Title: 'Dual-Channel Retrieval',
  feature3Desc: 'BGE-M3 vectors + FTS5 full-text search fused via RRF for precise code symbol and logic retrieval',
  feature4Title: 'Multimodal Mounting',
  feature4Desc: 'Mount PRD docs, DB schemas and other external resources; build cross-modal associations by semantic similarity',
  feature5Title: 'Incremental Build',
  feature5Desc: 'SHA-256 diff-based cascading update mechanism — only rebuilds affected files, dramatically reducing build time',
  feature6Title: 'MCP Integration',
  feature6Desc: 'One command to connect with Cursor / Claude Code — AI assistants can directly query the knowledge graph',
  pipelineLabel: 'How It Works',
  pipelineTitle: 'From source code to intelligent retrieval',
  pipelineDesc: 'IGraph transforms a codebase into an AI-queryable knowledge graph in three phases.',
  pipeline1Title: 'Parse — Build Structure Graph',
  pipeline1Desc: 'tree-sitter parses source code, extracts symbols like functions, classes, and components, builds call, inheritance, and import relationship edges.',
  pipeline2Title: 'Summarize — Inject Understanding',
  pipeline2Desc: 'LLM generates semantic summaries for each symbol and file; BGE-M3 converts summaries and source into 1024-dim vectors.',
  pipeline3Title: 'Serve — AI Assistants Query Directly',
  pipeline3Desc: 'Exposes 4 read-only retrieval tools via MCP Server. AI assistants ask in natural language, get relevant symbols and context.',
  ctaTitle: 'Let AI assistants understand your entire codebase',
  ctaDesc: 'Three commands to integrate — no more lost context.',
  ctaButton: 'Get Started →',
} : {
  heroSubtitle: '代码知识图谱构建工具',
  heroTagline: '解析 → 语义化 → 向量化，将代码仓库转化为可查询的知识图谱，让 AI 助手真正理解你的代码',
  quickStart: '快速开始 →',
  cliRef: 'CLI 参考',
  compareLabel: '对比效果',
  compareTitle: '同一个需求，两种结果',
  compareDesc: '当 AI 助手接入代码知识图谱后，从「凭猜测修改」变为「精准跨模态编排」。',
  comparePrompt: '给订单列表加一个按支付状态筛选的功能。',
  codingAgent: 'Coding Agent',
  agentStep1: 'grep "订单" · grep "支付状态" — 反复检索关键词定位相关文件',
  agentNarrative: '看起来要在订单列表页加一个支付状态筛选，我先找到相关页面和查询函数改一下。',
  agentStep2: 'Edit 订单列表页组件 — 新增支付状态下拉',
  agentStep3: 'Edit getOrderList — 凭猜测加了 status 查询参数',
  agentResult: '完成！已加上支付状态筛选下拉和查询参数。',
  agentNote: '字段名和可选状态值我是按常见写法猜的，你确认下对不对。',
  missedHeader: '遗漏了这些',
  missed1: 'PRD 验收标准 — 未读 PRD-012，漏了「未支付超 30 分钟自动关闭不展示」等规则',
  missed2: 'DB 真实字段 — 猜成 status，实际是 t_order.pay_status（枚举值不同）',
  missed3: '状态下拉数据源 — 没接 useDict 字典，选项写死或缺失',
  missed4: '导出功能 — exportOrderList 未同步加支付状态筛选',
  missed5: '后端接口参数 — 服务端查询未加 pay_status 过滤',
  missed6: '单元测试 — 用例会因参数结构变化而失败',
  igraphStep1: 'igraph_explore "订单列表 支付状态筛选" · 语义级检索（非关键词 grep）',
  hitHeader: '已澄清需求：一次命中 PRD-012 + getOrderList + pay_status 字段',
  hitPRD: 'PRD-012《订单管理》— 未支付超 30 分钟不展示等验收规则',
  hitFN1: 'getOrderList — 订单列表查询函数',
  hitDB: 't_order.pay_status — 支付状态真实字段',
  hitFN2: 'useDict — 支付状态下拉字典数据源',
  hitFN3: 'exportOrderList — 订单导出函数',
  igraphNarrative: '需求已澄清：按 pay_status 字段筛选，状态取 useDict 字典，未支付超 30 分钟的订单不展示。这是跨模态改动，计划如下：',
  planHeader: '计划 · 6 步',
  plan1: '1. PRD-012 验收规则对齐（超时未支付不展示）',
  plan2: '2. getOrderList 新增 pay_status 过滤',
  plan3: '3. 后端接口新增 pay_status 参数',
  plan4: '4. useDict 支付状态字典接入',
  plan5: '5. exportOrderList 同步支付状态筛选',
  plan6: '6. 更新订单列表单元测试',
  igraphStep2: 'Edit 跨模态精准改动共 6 个文件',
  igraphResult: '完成。字段名精准、符合 PRD 规则、导出与测试同步更新，完整 diff 已就绪。',
  passedHeader: '无一遗漏',
  pass1: '✓ PRD 验收标准',
  pass2: '✓ DB 真实字段',
  pass3: '✓ 状态下拉数据源',
  pass4: '✓ 导出功能',
  pass5: '✓ 后端接口参数',
  pass6: '✓ 单元测试',
  graphLabel: '可视化探索',
  graphTitle: '看见代码库的全貌',
  graphDesc: '每个符号是一个节点，每条调用和依赖是一条边。节点越大，连接越多。',
  graphWindowTitle: 'igraph · graph view',
  legendSymbol: '代码符号',
  legendPRD: 'PRD 文档',
  legendDB: 'DB Schema',
  legendEdge: '调用 & 依赖',
  terminalLabel: '工作流程',
  terminalTitle: '三条命令，从零到可查询',
  terminalDesc: '初始化、构建、注册。IGraph 自动处理解析、摘要、向量化与 MCP 接入。',
  terminalInit: 'igraph init',
  terminalInitOk: '配置文件已生成：',
  terminalBuild: 'igraph build',
  terminalBuildParse: '解析完成：',
  terminalBuildParseDetail: ' 个文件，',
  terminalBuildParseNodes: ' 个符号节点',
  terminalBuildSummary: '语义摘要：',
  terminalBuildSummaryDetail: ' 个符号 + ',
  terminalBuildSummaryFiles: ' 个文件',
  terminalBuildVector: '向量索引：',
  terminalBuildVectorDetail: ' 条嵌入已写入',
  terminalBuildTime: '   耗时 12.3s',
  terminalRegister: 'igraph register',
  terminalRegisterClaude: '已注册到',
  terminalRegisterCursor: '已注册到',
  featuresLabel: '核心能力',
  featuresTitle: '为 AI 编码而生的知识图谱',
  featuresDesc: '从代码解析到语义理解，从向量检索到 MCP 集成，覆盖完整链路。',
  feature1Title: '多语言解析',
  feature1Desc: 'tree-sitter 驱动的 5-Pass 流水线，支持 TypeScript / JavaScript / Python，提取函数、类、组件及调用关系',
  feature2Title: '语义摘要',
  feature2Desc: 'LLM 为文件与符号生成语义级摘要，无 API Key 时自动走启发式降级方案',
  feature3Title: '双通道检索',
  feature3Desc: 'BGE-M3 向量 + FTS5 全文检索经 RRF 融合，精准定位代码符号与逻辑',
  feature4Title: '多模态挂载',
  feature4Desc: '挂载 PRD 文档、DB Schema 等外部资源，按语义相似度建立跨模态关联',
  feature5Title: '增量构建',
  feature5Desc: '基于 SHA-256 diff 的级联更新机制，仅重建受影响文件，大幅节省构建时间',
  feature6Title: 'MCP 集成',
  feature6Desc: '一条命令接入 Cursor / Claude Code，AI 助手可直接查询知识图谱',
  pipelineLabel: '工作原理',
  pipelineTitle: '从源代码到智能检索',
  pipelineDesc: 'IGraph 通过三个阶段将代码仓库转化为 AI 可查询的知识图谱。',
  pipeline1Title: '解析 — 构建结构图',
  pipeline1Desc: 'tree-sitter 解析源代码，提取函数、类、组件等符号节点，建立调用、继承、导入等关系边。',
  pipeline2Title: '语义化 — 注入理解',
  pipeline2Desc: 'LLM 为每个符号和文件生成语义摘要，BGE-M3 将摘要和源码转化为 1024 维向量。',
  pipeline3Title: '服务 — AI 助手直接查询',
  pipeline3Desc: '通过 MCP Server 暴露 4 个只读检索 Tool，AI 助手用自然语言提问，返回相关符号和上下文。',
  ctaTitle: '让 AI 助手理解你的整个代码库',
  ctaDesc: '三条命令即可完成接入，从此告别上下文丢失。',
  ctaButton: '开始使用 →',
})

const quickStartLink = computed(() => isEn.value ? '/IGraph/en/guide/quick-start' : '/IGraph/guide/quick-start')
const cliRefLink = computed(() => isEn.value ? '/IGraph/en/reference/cli' : '/IGraph/reference/cli')

const showComparison = ref(false)

onMounted(() => {
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
      <p class="hero-subtitle">{{ t.heroSubtitle }}</p>
      <p class="hero-tagline">{{ t.heroTagline }}</p>
      <div class="hero-actions">
        <a :href="quickStartLink" class="btn-primary">{{ t.quickStart }}</a>
        <a :href="cliRefLink" class="btn-secondary">{{ t.cliRef }}</a>
      </div>
      <div class="hero-install">
        <span class="prompt">$</span>
        <code>npm install -g igraph-cli</code>
      </div>
    </section>

    <!-- 动态对比 -->
    <section class="compare-section" :class="{ visible: showComparison }">
      <p class="section-label">{{ t.compareLabel }}</p>
      <h2 class="section-title">{{ t.compareTitle }}</h2>
      <p class="section-desc">{{ t.compareDesc }}</p>

      <div class="compare-prompt">
        <span class="compare-prompt-text">{{ t.comparePrompt }}</span>
      </div>
      <div class="compare-grid">
        <!-- 左：普通 Agent -->
        <div class="compare-card compare-left">
          <div class="compare-card-header">
            <span class="terminal-dot red"></span>
            <span class="terminal-dot yellow"></span>
            <span class="terminal-dot green"></span>
            <span class="compare-card-title">{{ t.codingAgent }}</span>
          </div>
          <div class="compare-card-body">
            <div class="compare-step">
              <span class="step-dot dot-blue"></span>
              <span class="step-text"><code>{{ isEn ? 'grep "order"' : 'grep "订单"' }}</code> · <code>{{ isEn ? 'grep "payment status"' : 'grep "支付状态"' }}</code> — {{ isEn ? 'repeatedly searches keywords to find files' : '反复检索关键词定位相关文件' }}</span>
            </div>
            <div class="compare-narrative">{{ t.agentNarrative }}</div>
            <div class="compare-step">
              <span class="step-dot dot-blue"></span>
              <span class="step-text">{{ t.agentStep2 }}</span>
            </div>
            <div class="compare-step">
              <span class="step-dot dot-blue"></span>
              <span class="step-text">{{ t.agentStep3 }}</span>
            </div>
            <div class="compare-result">
              <span class="result-icon">😊</span>
              <span>{{ t.agentResult }}</span>
            </div>
            <div class="compare-note">{{ t.agentNote }}</div>
            <div class="compare-missed">
              <div class="missed-header"><span class="missed-icon">⚠</span> {{ t.missedHeader }}</div>
              <div class="missed-item"><span class="x-mark">✕</span> <strong>{{ isEn ? 'PRD Acceptance Criteria' : 'PRD 验收标准' }}</strong> — {{ t.missed1.split(' — ')[1] || t.missed1 }}</div>
              <div class="missed-item"><span class="x-mark">✕</span> <strong>{{ isEn ? 'Actual DB Field' : 'DB 真实字段' }}</strong> — {{ t.missed2.split(' — ')[1] || t.missed2 }}</div>
              <div class="missed-item"><span class="x-mark">✕</span> <strong>{{ isEn ? 'Status Dropdown Source' : '状态下拉数据源' }}</strong> — {{ t.missed3.split(' — ')[1] || t.missed3 }}</div>
              <div class="missed-item"><span class="x-mark">✕</span> <strong>{{ isEn ? 'Export Feature' : '导出功能' }}</strong> — {{ t.missed4.split(' — ')[1] || t.missed4 }}</div>
              <div class="missed-item"><span class="x-mark">✕</span> <strong>{{ isEn ? 'Backend API Params' : '后端接口参数' }}</strong> — {{ t.missed5.split(' — ')[1] || t.missed5 }}</div>
              <div class="missed-item"><span class="x-mark">✕</span> <strong>{{ isEn ? 'Unit Tests' : '单元测试' }}</strong> — {{ t.missed6.split(' — ')[1] || t.missed6 }}</div>
            </div>
          </div>
        </div>

        <!-- 右：Agent + IGraph -->
        <div class="compare-card compare-right">
          <div class="compare-card-header">
            <span class="terminal-dot red"></span>
            <span class="terminal-dot yellow"></span>
            <span class="terminal-dot green"></span>
            <span class="compare-card-title">{{ t.codingAgent }}</span>
            <span class="mcp-badge">✦ IGraph MCP</span>
          </div>
          <div class="compare-card-body">
            <div class="compare-step">
              <span class="step-dot dot-cyan"></span>
              <span class="step-text"><code>{{ isEn ? 'igraph_explore "order list payment status filter"' : 'igraph_explore "订单列表 支付状态筛选"' }}</code> · {{ isEn ? 'semantic search (not keyword grep)' : '语义级检索（非关键词 grep）' }}</span>
            </div>
            <div class="compare-hit">
              <div class="hit-header"><span class="hit-icon">🎯</span> {{ t.hitHeader }}</div>
              <div class="hit-item"><span class="hit-tag">PRD</span> {{ t.hitPRD }}</div>
              <div class="hit-item"><span class="hit-tag">FN</span> {{ t.hitFN1 }}</div>
              <div class="hit-item"><span class="hit-tag">DB</span> {{ t.hitDB }}</div>
              <div class="hit-item"><span class="hit-tag">FN</span> {{ t.hitFN2 }}</div>
              <div class="hit-item"><span class="hit-tag">FN</span> {{ t.hitFN3 }}</div>
            </div>
            <div class="compare-narrative">{{ t.igraphNarrative }}</div>
            <div class="compare-plan">
              <div class="plan-header"><span class="plan-icon">🚀</span> {{ t.planHeader }}</div>
              <div class="plan-item">{{ t.plan1 }}</div>
              <div class="plan-item">{{ t.plan2 }}</div>
              <div class="plan-item">{{ t.plan3 }}</div>
              <div class="plan-item">{{ t.plan4 }}</div>
              <div class="plan-item">{{ t.plan5 }}</div>
              <div class="plan-item">{{ t.plan6 }}</div>
            </div>
            <div class="compare-step">
              <span class="step-dot dot-cyan"></span>
              <span class="step-text">{{ t.igraphStep2 }}</span>
            </div>
            <div class="compare-result compare-result-ok">
              <span class="result-icon">😎</span>
              <span>{{ t.igraphResult }}</span>
            </div>
            <div class="compare-passed">
              <div class="passed-header"><span class="passed-icon">✅</span> {{ t.passedHeader }}</div>
              <div class="passed-tags">
                <span class="pass-tag">{{ t.pass1 }}</span>
                <span class="pass-tag">{{ t.pass2 }}</span>
                <span class="pass-tag">{{ t.pass3 }}</span>
                <span class="pass-tag">{{ t.pass4 }}</span>
                <span class="pass-tag">{{ t.pass5 }}</span>
                <span class="pass-tag">{{ t.pass6 }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 图谱可视化 -->
    <section class="graph-section">
      <p class="section-label">{{ t.graphLabel }}</p>
      <h2 class="section-title">{{ t.graphTitle }}</h2>
      <p class="section-desc">{{ t.graphDesc }}</p>
      <div class="graph-window">
        <div class="graph-window-header">
          <span class="terminal-dot red"></span>
          <span class="terminal-dot yellow"></span>
          <span class="terminal-dot green"></span>
          <span class="graph-window-title">{{ t.graphWindowTitle }}</span>
        </div>
        <div class="graph-canvas">
          <img src="/graph.svg" alt="Code knowledge graph visualization" style="width:100%;height:100%;object-fit:contain;" />
        </div>
      </div>
      <div class="graph-legend">
        <span class="legend-item"><span class="legend-dot" style="background:#93c5fd"></span> {{ t.legendSymbol }}</span>
        <span class="legend-item"><span class="legend-dot" style="background:#f97066"></span> {{ t.legendPRD }}</span>
        <span class="legend-item"><span class="legend-dot" style="background:#fbbf24"></span> {{ t.legendDB }}</span>
        <span class="legend-item"><span class="legend-line" style="background:rgba(255,255,255,0.35)"></span> {{ t.legendEdge }}</span>
      </div>
    </section>

    <!-- Terminal 模拟 -->
    <section class="terminal-section">
      <p class="section-label">{{ t.terminalLabel }}</p>
      <h2 class="section-title">{{ t.terminalTitle }}</h2>
      <p class="section-desc">{{ t.terminalDesc }}</p>
      <div class="terminal">
        <div class="terminal-header">
          <span class="terminal-dot red"></span>
          <span class="terminal-dot yellow"></span>
          <span class="terminal-dot green"></span>
          <span class="terminal-title">Terminal</span>
        </div>
        <div class="terminal-body">
          <div><span class="prompt">❯ </span><span class="cmd">igraph init</span></div>
          <div><span class="ok">✓</span> {{ t.terminalInitOk }}<span class="info">.igraph/config.json</span></div>
          <div>&nbsp;</div>
          <div><span class="prompt">❯ </span><span class="cmd">igraph build</span></div>
          <div><span class="ok">✓</span> {{ t.terminalBuildParse }}<span class="num">142</span>{{ t.terminalBuildParseDetail }}<span class="num">856</span>{{ t.terminalBuildParseNodes }}</div>
          <div><span class="ok">✓</span> {{ t.terminalBuildSummary }}<span class="num">856</span>{{ t.terminalBuildSummaryDetail }}<span class="num">142</span>{{ t.terminalBuildSummaryFiles }}</div>
          <div><span class="ok">✓</span> {{ t.terminalBuildVector }}<span class="num">998</span>{{ t.terminalBuildVectorDetail }}</div>
          <div><span class="dim">{{ t.terminalBuildTime }}</span></div>
          <div>&nbsp;</div>
          <div><span class="prompt">❯ </span><span class="cmd">igraph register</span></div>
          <div><span class="ok">✓</span> {{ t.terminalRegisterClaude }} <span class="info">Claude Code</span>：.mcp.json</div>
          <div><span class="ok">✓</span> {{ t.terminalRegisterCursor }} <span class="info">Cursor</span>：.cursor/mcp.json</div>
        </div>
      </div>
    </section>

    <!-- Feature 卡片 -->
    <section class="features-section">
      <p class="section-label">{{ t.featuresLabel }}</p>
      <h2 class="section-title">{{ t.featuresTitle }}</h2>
      <p class="section-desc">{{ t.featuresDesc }}</p>
      <div class="features-grid">
        <div class="feature-card">
          <span class="feature-icon">🌳</span>
          <div class="feature-title">{{ t.feature1Title }}</div>
          <div class="feature-desc">{{ t.feature1Desc }}</div>
        </div>
        <div class="feature-card">
          <span class="feature-icon">🧠</span>
          <div class="feature-title">{{ t.feature2Title }}</div>
          <div class="feature-desc">{{ t.feature2Desc }}</div>
        </div>
        <div class="feature-card">
          <span class="feature-icon">🔍</span>
          <div class="feature-title">{{ t.feature3Title }}</div>
          <div class="feature-desc">{{ t.feature3Desc }}</div>
        </div>
        <div class="feature-card">
          <span class="feature-icon">📎</span>
          <div class="feature-title">{{ t.feature4Title }}</div>
          <div class="feature-desc">{{ t.feature4Desc }}</div>
        </div>
        <div class="feature-card">
          <span class="feature-icon">⚡</span>
          <div class="feature-title">{{ t.feature5Title }}</div>
          <div class="feature-desc">{{ t.feature5Desc }}</div>
        </div>
        <div class="feature-card">
          <span class="feature-icon">🤖</span>
          <div class="feature-title">{{ t.feature6Title }}</div>
          <div class="feature-desc">{{ t.feature6Desc }}</div>
        </div>
      </div>
    </section>

    <!-- Pipeline -->
    <section class="pipeline-section">
      <p class="section-label">{{ t.pipelineLabel }}</p>
      <h2 class="section-title">{{ t.pipelineTitle }}</h2>
      <p class="section-desc">{{ t.pipelineDesc }}</p>
      <div class="pipeline">
        <div class="pipeline-step">
          <div class="step-number">01</div>
          <div class="step-content">
            <div class="step-title">{{ t.pipeline1Title }}</div>
            <div class="step-desc">{{ t.pipeline1Desc }}</div>
          </div>
        </div>
        <div class="pipeline-step">
          <div class="step-number">02</div>
          <div class="step-content">
            <div class="step-title">{{ t.pipeline2Title }}</div>
            <div class="step-desc">{{ t.pipeline2Desc }}</div>
          </div>
        </div>
        <div class="pipeline-step">
          <div class="step-number">03</div>
          <div class="step-content">
            <div class="step-title">{{ t.pipeline3Title }}</div>
            <div class="step-desc">{{ t.pipeline3Desc }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="cta-section">
      <h2 class="cta-title">{{ t.ctaTitle }}</h2>
      <p class="cta-desc">{{ t.ctaDesc }}</p>
      <a :href="quickStartLink" class="btn-primary">{{ t.ctaButton }}</a>
    </section>
  </div>
</template>
