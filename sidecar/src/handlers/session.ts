/**
 * @fileoverview 会话管理 RPC 处理器
 * @description 注册 session.create, session.list, session.sendMessage, session.interrupt 等远程调用方法。
 */

import { SessionManager } from "../session/session-manager.js";

/**
 * 注册会话相关的 RPC 处理函数
 *
 * @param sessionManager - 会话管理器实例
 * @param rpcRegister - RPC 注册函数
 */
export function registerSessionHandlers(
  sessionManager: SessionManager,
  rpcRegister: (method: string, handler: (params: any) => Promise<any> | any) => void
): void {
  // 1. 创建新会话
  rpcRegister("session.create", async (params?: { title?: string }) => {
    const sessionId = sessionManager.createSession(params?.title);
    return { sessionId };
  });

  // 2. 查询会话列表
  rpcRegister("session.list", async () => {
    return { sessions: sessionManager.listSessions() };
  });

  // 3. 获取指定会话的消息历史
  rpcRegister("session.getMessages", async (params: { sessionId: string }) => {
    return { messages: sessionManager.getMessages(params.sessionId) };
  });

  // 4. 发送消息启动 Agent 任务
  rpcRegister("session.sendMessage", async (params: { sessionId: string; prompt: string }) => {
    await sessionManager.sendMessage(params.sessionId, params.prompt);
    return { status: "started" };
  });

  // 5. 中断当前任务
  rpcRegister("session.interrupt", async (params: { sessionId: string }) => {
    const interrupted = sessionManager.interruptSession(params.sessionId);
    return { interrupted };
  });
}
