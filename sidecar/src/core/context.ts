/**
 * @fileoverview Cordis 微内核上下文与核心服务注册
 * @description 扩展 Cordis Context，注入全局 ToolRegistry 服务，管理工具与插件生命周期。
 */

import { Context as BaseContext, Service } from "cordis";
import { IToolRegistry, ToolDefinition } from "./types.js";

/**
 * 全局工具注册与查询服务
 */
export class ToolRegistryService extends Service implements IToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /**
   * 构造工具注册表服务
   *
   * @param ctx - Cordis 上下文实例
   */
  constructor(ctx: BaseContext) {
    super(ctx, "toolRegistry", true);
  }

  /**
   * 向注册表注册新工具
   *
   * @param tool - 工具定义
   */
  public registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 根据名称获取工具
   *
   * @param name - 工具名称
   * @returns 工具定义对象或 undefined
   */
  public getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取当前所有已注册工具列表
   *
   * @returns 工具定义数组
   */
  public listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 检查指定工具是否存在
   *
   * @param name - 工具名称
   */
  public hasTool(name: string): boolean {
    return this.tools.has(name);
  }
}

// 声明 Cordis 上下文模块扩展
declare module "cordis" {
  interface Context {
    toolRegistry: ToolRegistryService;
  }
}

/**
 * 创建并初始化配置好的 Cordis 全局上下文实例
 *
 * @returns 初始化后的 Cordis 上下文
 */
export function createAgentContext(): BaseContext {
  const ctx = new BaseContext();
  ctx.plugin(ToolRegistryService);
  return ctx;
}
