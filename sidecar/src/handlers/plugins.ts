/**
 * @fileoverview 插件与工具查询 RPC 处理器
 * @description 暴露 plugins.list 与 tools.list 远程调用接口，供 Rust 宿主与前端获取当前微内核已激活的扩展能力。
 */

import { Context } from "cordis";
import { PluginLoader } from "../core/plugin-loader.js";
import { PluginMetadata, ToolDefinition } from "../core/types.js";

/**
 * 注册插件与工具相关的 RPC 处理函数
 *
 * @param ctx - Cordis 上下文
 * @param pluginLoader - 插件加载器实例
 * @param rpcRegister - RPC 注册函数
 */
export function registerPluginHandlers(
  ctx: Context,
  pluginLoader: PluginLoader,
  rpcRegister: (method: string, handler: (params: any) => Promise<any> | any) => void
): void {
  // 1. 获取已加载插件列表
  rpcRegister("plugins.list", async (): Promise<{ plugins: PluginMetadata[] }> => {
    return {
      plugins: pluginLoader.listPlugins(),
    };
  });

  // 2. 获取所有已注册工具详情
  rpcRegister("tools.list", async (): Promise<{ tools: Array<Omit<ToolDefinition, "execute">> }> => {
    const rawTools = ctx.toolRegistry.listTools();
    return {
      tools: rawTools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    };
  });
}
