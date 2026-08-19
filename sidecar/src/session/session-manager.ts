/**
 * @fileoverview Agent 会话管理器与执行调度器
 * @description 管理多会话上下文、调度 Agent 思考与工具执行循环，并支持实时流式事件推流与任务中断。
 */

import { Context } from "cordis";
import { ChatMessage, SessionSummary, ToolCallRecord } from "./types.js";
import { RpcServer } from "../rpc.js";

interface ActiveSession {
  summary: SessionSummary;
  messages: ChatMessage[];
  abortController: AbortController | null;
}

/**
 * 会话管理器服务
 */
export class SessionManager {
  private ctx: Context;
  private server: RpcServer;
  private sessions = new Map<string, ActiveSession>();

  /**
   * 构造会话管理器
   *
   * @param ctx - Cordis 上下文
   * @param server - RPC 服务实例
   */
  constructor(ctx: Context, server: RpcServer) {
    this.ctx = ctx;
    this.server = server;
  }

  /**
   * 创建一个新的会话
   *
   * @param title - 会话标题（可选）
   * @returns 新建会话标识符
   */
  public createSession(title: string = "新编程任务"): string {
    const id = "sess_" + Math.random().toString(36).substring(2, 10);
    const now = Date.now();
    const session: ActiveSession = {
      summary: {
        id,
        title,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        isRunning: false,
      },
      messages: [],
      abortController: null,
    };
    this.sessions.set(id, session);
    return id;
  }

  /**
   * 列出所有会话列表
   */
  public listSessions(): SessionSummary[] {
    return Array.from(this.sessions.values()).map((s) => s.summary);
  }

  /**
   * 获取指定会话的消息历史
   *
   * @param sessionId - 会话标识符
   */
  public getMessages(sessionId: string): ChatMessage[] {
    const session = this.sessions.get(sessionId);
    return session ? session.messages : [];
  }

  /**
   * 发送用户消息并启动 Agent 推理与工具执行流
   *
   * @param sessionId - 会话标识符
   * @param prompt - 用户输入的指令
   */
  public async sendMessage(sessionId: string, prompt: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.summary.isRunning) {
      throw new Error(`Session ${sessionId} is already running a task`);
    }

    const now = Date.now();
    // 1. 添加用户消息
    const userMsg: ChatMessage = {
      id: "msg_" + Math.random().toString(36).substring(2, 10),
      role: "user",
      content: prompt,
      timestamp: now,
    };
    session.messages.push(userMsg);
    session.summary.messageCount = session.messages.length;
    session.summary.updatedAt = now;
    session.summary.isRunning = true;

    // 2. 初始化中断控制器
    session.abortController = new AbortController();
    const signal = session.abortController.signal;

    // 3. 异步启动 Agent 执行循环
    this.runAgentLoop(session, prompt, signal).catch((err) => {
      console.error(`[AgentLoop Error in ${sessionId}]`, err);
    });
  }

  /**
   * 中断正在执行的任务
   *
   * @param sessionId - 会话标识符
   */
  public interruptSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.summary.isRunning || !session.abortController) {
      return false;
    }

    session.abortController.abort();
    session.summary.isRunning = false;
    session.abortController = null;

    // 发送中断事件通知
    this.server.notify("session.interrupted", {
      sessionId,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * Agent 执行循环与流式推流
   */
  private async runAgentLoop(session: ActiveSession, prompt: string, signal: AbortSignal): Promise<void> {
    const sessionId = session.summary.id;
    const assistantMsgId = "msg_" + Math.random().toString(36).substring(2, 10);
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      thought: "",
      toolCalls: [],
      timestamp: Date.now(),
    };
    session.messages.push(assistantMsg);

    try {
      // 步骤 1: 模拟/流式输出思考过程 (CoT Thought)
      const thoughtChunks = [
        "正在分析用户需求与上下文环境...",
        `\n目标指令: "${prompt}"`,
        "\n正在检索已挂载的 Cordis 插件与可用工具注册表...",
      ];

      for (const chunk of thoughtChunks) {
        if (signal.aborted) throw new Error("Task interrupted by user");
        assistantMsg.thought += chunk;
        this.server.notify("event.streamThought", {
          sessionId,
          messageId: assistantMsgId,
          thoughtChunk: chunk,
        });
        await new Promise((r) => setTimeout(r, 40));
      }

      // 步骤 2: 工具调用演示或自主规划
      if (prompt.includes("list") || prompt.includes("文件") || prompt.includes("目录")) {
        const toolCall: ToolCallRecord = {
          id: "call_" + Math.random().toString(36).substring(2, 8),
          toolName: "list_dir",
          parameters: { dir: "." },
          status: "running",
          startTime: Date.now(),
        };
        assistantMsg.toolCalls?.push(toolCall);

        this.server.notify("event.toolStart", {
          sessionId,
          messageId: assistantMsgId,
          toolCall,
        });

        if (signal.aborted) throw new Error("Task interrupted by user");
        await new Promise((r) => setTimeout(r, 80));

        // 执行真实工具调用
        const tool = this.ctx.toolRegistry.getTool("list_dir");
        if (tool) {
          const result = await tool.execute({ dir: "." });
          toolCall.result = result;
          toolCall.status = "success";
          toolCall.endTime = Date.now();

          this.server.notify("event.toolFinish", {
            sessionId,
            messageId: assistantMsgId,
            toolCall,
          });
        }
      }

      // 步骤 3: 流式输出最终回答 Token
      const answerTokens = [
        "已为您处理完当前任务。",
        " 基于 DeepSeek Harness 的 Cordis 微内核架构，所有的执行计划均由插件工具链协同完成。",
        `\n当前响应已成功渲染于客户端界面。`,
      ];

      for (const token of answerTokens) {
        if (signal.aborted) throw new Error("Task interrupted by user");
        assistantMsg.content += token;
        this.server.notify("event.streamToken", {
          sessionId,
          messageId: assistantMsgId,
          token,
        });
        await new Promise((r) => setTimeout(r, 40));
      }

      // 步骤 4: 发送完成事件
      session.summary.isRunning = false;
      session.summary.updatedAt = Date.now();
      session.abortController = null;

      this.server.notify("event.sessionCompleted", {
        sessionId,
        messageId: assistantMsgId,
        totalTokens: assistantMsg.content.length,
      });
    } catch (err: any) {
      session.summary.isRunning = false;
      session.abortController = null;
      if (signal.aborted || err.message?.includes("interrupted")) {
        assistantMsg.content += "\n\n[任务已由用户主动中断]";
        this.server.notify("event.streamToken", {
          sessionId,
          messageId: assistantMsgId,
          token: "\n\n[任务已由用户主动中断]",
        });
      } else {
        assistantMsg.content += `\n\n[执行异常: ${err.message}]`;
        this.server.notify("event.streamToken", {
          sessionId,
          messageId: assistantMsgId,
          token: `\n\n[执行异常: ${err.message}]`,
        });
      }
    }
  }
}
