/**
 * @fileoverview Agent 会话与消息流数据结构定义
 * @description 定义会话生命周期、消息类型、思考链与工具调用事件的接口契约。
 */

/**
 * 消息角色类型
 */
export type MessageRole = "user" | "assistant" | "system" | "tool";

/**
 * 工具调用状态记录
 */
export interface ToolCallRecord {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "running" | "success" | "error";
  startTime: number;
  endTime?: number;
}

/**
 * 会话历史中的单条消息
 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  thought?: string;
  toolCalls?: ToolCallRecord[];
  timestamp: number;
}

/**
 * 单个 Agent 会话状态概要
 */
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isRunning: boolean;
}
