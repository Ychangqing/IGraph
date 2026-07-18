import { defineConfig } from 'vitepress'

const guideSidebar = [
  {
    text: '指南',
    items: [
      { text: '安装', link: '/guide/installation' },
      { text: '快速开始', link: '/guide/quick-start' },
      { text: '配置说明', link: '/guide/configuration' },
    ],
  },
  {
    text: '核心功能',
    items: [
      { text: '多语言解析', link: '/features/parsing' },
      { text: '语义摘要', link: '/features/semantic' },
      { text: '向量检索', link: '/features/retrieval' },
      { text: '多模态挂载', link: '/features/multimodal' },
      { text: '增量构建', link: '/features/incremental' },
      { text: 'MCP 集成', link: '/features/mcp' },
    ],
  },
  {
    text: '参考',
    items: [
      { text: 'CLI 命令', link: '/reference/cli' },
      { text: 'MCP Tool 详解', link: '/reference/mcp-tools' },
      { text: '配置 Schema', link: '/reference/config-schema' },
      { text: '环境变量', link: '/reference/env-variables' },
    ],
  },
]

const guideSidebarEn = [
  {
    text: 'Guide',
    items: [
      { text: 'Installation', link: '/en/guide/installation' },
      { text: 'Quick Start', link: '/en/guide/quick-start' },
      { text: 'Configuration', link: '/en/guide/configuration' },
    ],
  },
  {
    text: 'Core Features',
    items: [
      { text: 'Multi-Language Parsing', link: '/en/features/parsing' },
      { text: 'Semantic Summaries', link: '/en/features/semantic' },
      { text: 'Vector Retrieval', link: '/en/features/retrieval' },
      { text: 'Multimodal Mounting', link: '/en/features/multimodal' },
      { text: 'Incremental Build', link: '/en/features/incremental' },
      { text: 'MCP Integration', link: '/en/features/mcp' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'CLI Commands', link: '/en/reference/cli' },
      { text: 'MCP Tools', link: '/en/reference/mcp-tools' },
      { text: 'Config Schema', link: '/en/reference/config-schema' },
      { text: 'Environment Variables', link: '/en/reference/env-variables' },
    ],
  },
]

export default defineConfig({
  title: 'IGraph',
  description: '代码知识图谱构建工具 — 解析 → 语义化 → 向量化',
  appearance: 'dark',

  base: '/IGraph/',

  head: [
    ['link', { rel: 'icon', href: '/IGraph/logo.svg' }],
  ],

  vite: {
    server: {
      host: '127.0.0.1',
    },
  },

  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '指南', link: '/guide/installation' },
          { text: '核心功能', link: '/features/parsing' },
          { text: '参考', link: '/reference/cli' },
        ],
        sidebar: {
          '/guide/': guideSidebar,
          '/features/': guideSidebar,
          '/reference/': guideSidebar,
        },
        docFooter: {
          prev: '上一页',
          next: '下一页',
        },
        outline: {
          label: '页面导航',
        },
        lastUpdated: {
          text: '最后更新于',
        },
        returnToTopLabel: '回到顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '主题',
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      description: 'Code knowledge graph builder — Parse → Summarize → Vectorize',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/en/guide/installation' },
          { text: 'Features', link: '/en/features/parsing' },
          { text: 'Reference', link: '/en/reference/cli' },
        ],
        sidebar: {
          '/en/guide/': guideSidebarEn,
          '/en/features/': guideSidebarEn,
          '/en/reference/': guideSidebarEn,
        },
        docFooter: {
          prev: 'Previous',
          next: 'Next',
        },
        outline: {
          label: 'On this page',
        },
        lastUpdated: {
          text: 'Last updated',
        },
        returnToTopLabel: 'Back to top',
        sidebarMenuLabel: 'Menu',
        darkModeSwitchLabel: 'Theme',
      },
    },
  },

  themeConfig: {
    logo: '/logo.svg',

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Ychangqing/IGraph' },
    ],

    footer: {
      message: 'Released under the MIT License',
      copyright: 'Copyright © 2024-present IGraph',
    },

    search: {
      provider: 'local',
    },
  },
})
