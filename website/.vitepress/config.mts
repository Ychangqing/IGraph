import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'IGraph',
  description: '代码知识图谱构建工具 — 解析 → 语义化 → 向量化',
  appearance: 'dark',

  // 项目页部署到 https://ychangqing.github.io/IGraph/，需设置仓库名作为 base
  base: '/IGraph/',

  head: [
    ['link', { rel: 'icon', href: '/logo.svg' }],
  ],

  vite: {
    server: {
      host: '127.0.0.1',
    },
  },

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '指南', link: '/guide/installation' },
      { text: '核心功能', link: '/features/parsing' },
      { text: '参考', link: '/reference/cli' },
    ],

    sidebar: {
      '/guide/': [
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
      ],
      '/features/': [
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
      ],
      '/reference/': [
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
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Ychangqing/IGraph' },
    ],

    footer: {
      message: '基于 MIT 许可发布',
      copyright: 'Copyright © 2024-present IGraph',
    },

    search: {
      provider: 'local',
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
})
