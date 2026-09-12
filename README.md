# Achieve Music

基于 Kael-Music 改造的完全本地化网页音乐播放器。在线音乐通过本地代理服务器转发（请求走 `localhost`，数据不出境），支持 VIP 歌曲自动跨平台 fallback、歌词解析、本地文件播放、切歌平滑过渡。

## 特性

- 🔒 **数据不出境** — 所有在线请求通过本地 Vite 中间件代理（`localhost:3000/api/music`），使用 `@meting/core` 对接网易云、QQ 音乐、酷狗、酷我、百度官方 API
- 🎵 **在线搜索/播放** — 搜索 → 一键播放 → 自动加载歌词
- 🛡️ **VIP Fallback** — 网易云 CDN 403/不可访问时自动跨平台切换（腾讯 → 酷狗 → 酷我 → 百度），每个候选 URL 先 HEAD 验证
- 📁 **本地文件** — 支持拖拽上传、目录选择，`.mp3/.flac/.wav/.m4a` + `.lrc` 歌词文件
- 💾 **播放列表持久化** — 刷新页面自动恢复在线歌曲播放列表
- 🎼 **歌词渲染** — Canvas 实时滚动高亮，元信息行（作词/作曲/编曲）自动过滤
- ✨ **切歌平滑** — 旧歌 150ms 淡出 + 新歌 300ms 淡入，requestAnimationFrame 驱动
- 📱 **触屏支持** — 长按菜单、滑动切换布局
- 🎨 **纯净 UI** — 全中文、温暖橙黄配色、毛玻璃弹窗风格

## 快速开始

```bash
# 安装依赖
npm install

# 开发（默认 http://localhost:3000）
npm run dev

# 构建
npm run build

# 预览构建产物
npm run preview
```

## 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite 6 |
| 样式 | Tailwind CSS |
| 图标 | Lucide React（自封装 SVG） |
| 音乐 API | @meting/core（本地代理） |
| 音频播放 | HTML5 `<audio>` + Web Audio |
| 歌词渲染 | Canvas 2D |
| 持久化 | localStorage + IndexedDB |

## 架构

```
┌─────────────────────────────────────────────┐
│  浏览器 (React SPA, localhost:3000)          │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │ Search   │  │ Lyrics   │  │ Controls  │ │
│  │ Modal    │  │ View     │  │ (播放控制) │ │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘ │
│       │              │              │        │
│       ▼              ▼              ▼        │
│  ┌─────────────────────────────────────────┐ │
│  │  Vite 中间件: vite-plugin-music-api.ts  │ │
│  │  /api/music?server=netease&type=...     │ │
│  │                                          │ │
│  │  search → @meting/core.search()         │ │
│  │  url  → @meting/core.url()              │ │
│  │          + HEAD 验证 CDN 可访问性       │ │
│  │          + 跨平台 fallback (若 CDN 403) │ │
│  │          → HTTP 流式代理转发（非 302）   │ │
│  │  lrc  → @meting/core.lyric()            │ │
│  └─────────────────────────────────────────┘ │
│                                             │
│  所有请求目标: 网易云/QQ/酷狗/酷我/百度 官方 CDN │
│  数据全程走境内服务器 → 数据不出境            │
└─────────────────────────────────────────────┘
```

## VIP Fallback 机制

`vite-plugin-music-api.ts` 的 URL handler 做了三层保障：

1. **CDN 有效性验证** — 对 meting 返回的 URL 发 HEAD 请求，检查 `status === 200/206` 且 `Content-Length > 2MB`（排除错误页）
2. **跨平台 fallback** — 如果验证失败，自动从 song API 拿到歌名/歌手，依次尝试其他平台（腾讯 → 酷狗 → 酷我 → 百度），每个平台取前 3 个候选 URL，每个候选也先 HEAD 验证
3. **流式代理** — 最终拿到有效 URL 后，用 Node.js `http/https` 流式 pipe 转发给客户端，保留 `Content-Length`、`Accept-Ranges` 等响应头，支持拖动进度条

## 目录结构

```
Kael-Music-main/
├── components/              # UI 组件
│   ├── Controls.tsx         # 底部播放控制
│   ├── LyricsView.tsx       # Canvas 歌词渲染
│   ├── SearchModal.tsx      # 搜索弹窗
│   ├── PlaylistPanel.tsx   # 播放列表面板
│   ├── FluidBackground.tsx # 动态背景
│   └── ...
├── hooks/                   # React Hooks
│   ├── usePlayer.ts         # 播放核心状态机
│   ├── usePlaylist.ts       # 播放列表管理
│   ├── useSearchModal.ts    # 搜索逻辑
│   └── ...
├── services/                # 业务逻辑
│   ├── lyricsService.ts     # 歌词获取 + 元信息过滤
│   └── utils.ts             # 工具函数
├── vite-plugin-music-api.ts # ⭐ 本地音乐 API 代理
└── App.tsx                  # 入口
```

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Space` | 播放/暂停 |
| `←` / `→` | 快退/快进 5 秒 |
| `↑` / `↓` | 上一首 / 下一首 |
| `Ctrl + K` | 打开搜索 |
| `Enter` | 搜索/选择 |
| `Esc` | 关闭弹窗 |

## 许可证

MIT License

## 免责声明

本项目仅供学习交流使用。在线音乐资源来自各音乐平台官方 API，版权归原平台及音乐人所有。请支持正版。
