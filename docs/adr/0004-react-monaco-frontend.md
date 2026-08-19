<!-- 
文件说明: 架构决策记录 (ADR 0004)
功能描述: 确立以 React + TailwindCSS + Monaco Editor 构建前端界面与代码差异审查能力。
-->

# ADR 0004: React 与 Monaco 驱动的前端技术栈

## 状态
已接受 (Accepted)

## 背景与决策
客户端需要提供专业的代码变更审核、终端输出以及流畅的 Agent 交互体验。为保障代码差异比对（Diff）的高保真还原度，我们决定采用 React 配合 TailwindCSS 构建 UI，并集成 Monaco Editor 作为代码差异与编辑核心。

## 权衡与后果
* **优势**：获得与 VS Code 一致的代码语法高亮与行级 Diff 比对体验，前端组件生态丰富。
* **代价**：Monaco Editor 前端 bundle 相对较大，需在 Vite 构建中配置按需加载与 Web Worker 分离打包。
