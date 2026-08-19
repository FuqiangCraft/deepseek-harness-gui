/**
 * @fileoverview Cordis 插件与工具服务类型契约
 * @description 定义微内核上下文中的服务接口、插件元数据结构与工具注册规范。
 */

/**
 * 工具定义接口
 */
export interface ToolDefinition<P = any, R = any> {
  /** 工具唯一名称 (例如 read_file, execute_sql) */
  name: string;
  /** 工具中文/英文功能描述 */
  description: string;
  /** JSON Schema 参数描述 */
  parameters?: Record<string, unknown>;
  /** 工具执行函数 */
  execute: (params: P, context?: unknown) => Promise<R> | R;
}

/**
 * 插件来源类型
 */
export type PluginSource = "builtin" | "global" | "workspace";

/**
 * 已加载插件的详细元数据
 */
export interface PluginMetadata {
  /** 插件唯一标识名 */
  name: string;
  /** 语义化版本号 */
  version: string;
  /** 插件简要描述 */
  description: string;
  /** 插件加载来源 */
  source: PluginSource;
  /** 插件提供的工具列表 */
  tools: string[];
  /** 插件是否激活 */
  enabled: boolean;
}

/**
 * 工具注册表服务接口
 */
export interface IToolRegistry {
  registerTool(tool: ToolDefinition): void;
  getTool(name: string): ToolDefinition | undefined;
  listTools(): ToolDefinition[];
  hasTool(name: string): boolean;
}
