/**
 * @fileoverview Vite 前端构建配置
 * @description 构建静态启动页（index.html）供 Tauri 窗口在 DSH 引擎就绪前展示。
 * 官方 dsh web UI 由引擎经 loopback 提供，本前端仅作为启动占位页。
 */

import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/sidecar/dist/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2021", "chrome105", "safari13"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
