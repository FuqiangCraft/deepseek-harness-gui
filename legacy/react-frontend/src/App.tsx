/**
 * @fileoverview 桌面客户端交互主界面 (Agent 会话、流式推流、Monaco 差异审查、审批门禁与插件生态)
 * @description 支持多会话切换、实时 Token 推流、思考链展示、工具卡片、Monaco 代码差异比对、Approval Gate 交互拦截及任务中断。
 */

import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Cpu,
  Layers,
  Wrench,
  Plus,
  Send,
  Square,
  ChevronDown,
  ChevronRight,
  Brain,
  MessageSquare,
  Bot,
  User,
  Sparkles,
  GitCompare,
  ShieldAlert,
} from "lucide-react";
import { DiffReviewer, FileDiffItem } from "./components/DiffReviewer.tsx";
import { ApprovalModal, ApprovalRequestItem } from "./components/ApprovalModal.tsx";

interface PluginMeta {
  name: string;
  version: string;
  description: string;
  source: "builtin" | "global" | "workspace";
  tools: string[];
  enabled: boolean;
}

interface ToolMeta {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

interface SessionItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isRunning: boolean;
}

interface ToolCallItem {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "running" | "success" | "error";
  startTime: number;
  endTime?: number;
}

interface MessageItem {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thought?: string;
  toolCalls?: ToolCallItem[];
  timestamp: number;
}

/**
 * 桌面客户端主应用程序组件
 */
export function App(): React.JSX.Element {
  const [healthStatus, setHealthStatus] = useState<"checking" | "healthy" | "unhealthy">("checking");
  const [lastPingTime, setLastPingTime] = useState<string>("");
  const [plugins, setPlugins] = useState<PluginMeta[]>([]);
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [activeTab, setActiveTab] = useState<"chat" | "diff" | "plugins" | "tools">("chat");

  // 会话状态
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>("");
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputPrompt, setInputPrompt] = useState<string>("");
  const [isTaskRunning, setIsTaskRunning] = useState<boolean>(false);
  const [collapsedThoughts, setCollapsedThoughts] = useState<Record<string, boolean>>({});

  // 差异审查与安全审批状态
  const [diffs, setDiffs] = useState<FileDiffItem[]>([]);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequestItem | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  /**
   * 初始化并拉取数据
   */
  const refreshState = async () => {
    try {
      if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") {
        setHealthStatus("healthy");
        setLastPingTime(new Date().toLocaleTimeString());
        if (sessions.length === 0) {
          const mockSess: SessionItem = {
            id: "sess_demo",
            title: "示例编程会话",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 0,
            isRunning: false,
          };
          setSessions([mockSess]);
          setCurrentSessionId(mockSess.id);
        }
        return;
      }

      const isAlive = await invoke<boolean>("check_sidecar_health");
      if (isAlive) {
        setHealthStatus("healthy");
        setLastPingTime(new Date().toLocaleTimeString());

        const pluginRes = await invoke<{ plugins: PluginMeta[] }>("get_active_plugins");
        if (pluginRes?.plugins) setPlugins(pluginRes.plugins);

        const toolRes = await invoke<{ tools: ToolMeta[] }>("get_registered_tools");
        if (toolRes?.tools) setTools(toolRes.tools);

        const sessionRes = await invoke<{ sessions: SessionItem[] }>("list_sessions");
        if (sessionRes?.sessions) {
          setSessions(sessionRes.sessions);
          if (!currentSessionId && sessionRes.sessions.length > 0) {
            setCurrentSessionId(sessionRes.sessions[0].id);
          }
        }

        const diffRes = await invoke<{ diffs: FileDiffItem[] }>("list_diffs", {
          sessionId: currentSessionId || undefined,
        });
        if (diffRes?.diffs) {
          setDiffs(diffRes.diffs);
        }

        const approvalRes = await invoke<{ requests: ApprovalRequestItem[] }>("list_pending_approvals");
        if (approvalRes?.requests && approvalRes.requests.length > 0) {
          setPendingApproval(approvalRes.requests[0]);
        }
      } else {
        setHealthStatus("unhealthy");
      }
    } catch (err) {
      console.error("Refresh state error:", err);
      setHealthStatus("unhealthy");
    }
  };

  /**
   * 监听 Sidecar 推送的全局事件流
   */
  useEffect(() => {
    refreshState();

    if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") return;

    const unlistenPromise = listen<{
      method: string;
      params: any;
    }>("agent-event", (event) => {
      const { method, params } = event.payload;

      if (method === "event.streamThought") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === params.messageId) {
            return [
              ...prev.slice(0, -1),
              { ...last, thought: (last.thought || "") + params.thoughtChunk },
            ];
          }
          return [
            ...prev,
            {
              id: params.messageId,
              role: "assistant",
              content: "",
              thought: params.thoughtChunk,
              toolCalls: [],
              timestamp: Date.now(),
            },
          ];
        });
      } else if (method === "event.streamToken") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === params.messageId) {
            return [...prev.slice(0, -1), { ...last, content: last.content + params.token }];
          }
          return [
            ...prev,
            {
              id: params.messageId,
              role: "assistant",
              content: params.token,
              timestamp: Date.now(),
            },
          ];
        });
      } else if (method === "event.toolStart") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === params.messageId) {
            const existingCalls = last.toolCalls || [];
            return [
              ...prev.slice(0, -1),
              { ...last, toolCalls: [...existingCalls, params.toolCall] },
            ];
          }
          return prev;
        });
      } else if (method === "event.toolFinish") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === params.messageId && last.toolCalls) {
            const updatedCalls = last.toolCalls.map((call) =>
              call.id === params.toolCall.id ? params.toolCall : call
            );
            return [...prev.slice(0, -1), { ...last, toolCalls: updatedCalls }];
          }
          return prev;
        });
      } else if (method === "event.fileChanged") {
        setDiffs((prev) => {
          const filtered = prev.filter((d) => d.id !== params.diff.id);
          return [params.diff, ...filtered];
        });
      } else if (method === "event.diffStatusChanged") {
        setDiffs((prev) =>
          prev.map((d) => (d.id === params.diffId ? { ...d, status: params.status } : d))
        );
      } else if (method === "event.approvalRequired") {
        setPendingApproval(params.request);
      } else if (method === "event.approvalCompleted") {
        setPendingApproval(null);
      } else if (method === "event.sessionCompleted" || method === "session.interrupted") {
        setIsTaskRunning(false);
      }
    });

    return () => {
      unlistenPromise.then((unsub) => unsub());
    };
  }, [currentSessionId]);

  /**
   * 响应审批操作 (同意/拒绝)
   */
  const handleRespondApproval = async (requestId: string, approved: boolean) => {
    try {
      if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") {
        setPendingApproval(null);
        return;
      }
      await invoke("respond_approval", { requestId, approved });
      setPendingApproval(null);
    } catch (err) {
      console.error("Respond approval error:", err);
    }
  };

  /**
   * 应用或放弃代码差异
   */
  const handleApplyDiff = async (diffId: string, accepted: boolean) => {
    try {
      if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") {
        setDiffs((prev) =>
          prev.map((d) => (d.id === diffId ? { ...d, status: accepted ? "accepted" : "rejected" } : d))
        );
        return;
      }
      await invoke("apply_diff", { diffId, accepted });
      setDiffs((prev) =>
        prev.map((d) => (d.id === diffId ? { ...d, status: accepted ? "accepted" : "rejected" } : d))
      );
    } catch (err) {
      console.error("Apply diff error:", err);
    }
  };

  /**
   * 创建新会话
   */
  const handleCreateSession = async () => {
    try {
      if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") {
        const newSess: SessionItem = {
          id: "sess_" + Date.now(),
          title: `任务 ${sessions.length + 1}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
          isRunning: false,
        };
        setSessions((prev) => [newSess, ...prev]);
        setCurrentSessionId(newSess.id);
        setMessages([]);
        return;
      }

      const res = await invoke<{ sessionId: string }>("create_session", {
        title: `任务 ${sessions.length + 1}`,
      });
      if (res?.sessionId) {
        setCurrentSessionId(res.sessionId);
        setMessages([]);
        refreshState();
      }
    } catch (err) {
      console.error("Create session error:", err);
    }
  };

  /**
   * 发送指令
   */
  const handleSendMessage = async () => {
    if (!inputPrompt.trim() || isTaskRunning) return;

    let targetSessId = currentSessionId;
    if (!targetSessId) {
      const newSessId = "sess_" + Date.now();
      setCurrentSessionId(newSessId);
      targetSessId = newSessId;
    }

    const promptText = inputPrompt.trim();
    setInputPrompt("");
    setIsTaskRunning(true);

    const userMsg: MessageItem = {
      id: "msg_u_" + Date.now(),
      role: "user",
      content: promptText,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") {
        setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            {
              id: "msg_a_" + Date.now(),
              role: "assistant",
              content: "已收到您的指令（浏览器调试模式模拟响应）。",
              thought: "正在分析项目代码差异与沙箱配置...",
              timestamp: Date.now(),
            },
          ]);
          setIsTaskRunning(false);
        }, 600);
        return;
      }

      await invoke("send_session_message", {
        sessionId: targetSessId,
        prompt: promptText,
      });
    } catch (err) {
      console.error("Send message error:", err);
      setIsTaskRunning(false);
    }
  };

  /**
   * 中断任务
   */
  const handleInterrupt = async () => {
    if (!currentSessionId) return;
    try {
      if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") {
        setIsTaskRunning(false);
        return;
      }
      await invoke("interrupt_session", { sessionId: currentSessionId });
      setIsTaskRunning(false);
    } catch (err) {
      console.error("Interrupt error:", err);
    }
  };

  const toggleThought = (msgId: string) => {
    setCollapsedThoughts((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const pendingDiffsCount = diffs.filter((d) => d.status === "pending").length;

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 text-slate-100 font-sans">
      {/* 敏感操作安全审批模态框 */}
      <ApprovalModal request={pendingApproval} onRespond={handleRespondApproval} />

      {/* 顶部导航 */}
      <header className="flex h-12 items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 backdrop-blur">
        <div className="flex items-center space-x-3">
          <Cpu className="h-5 w-5 text-blue-400" />
          <span className="font-semibold text-sm tracking-wide text-slate-200">
            DeepSeek Harness <span className="text-xs text-blue-400 font-mono">Desktop</span>
          </span>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1.5 text-xs">
            <span className="text-slate-400">微内核状态:</span>
            {healthStatus === "healthy" ? (
              <span className="flex items-center text-emerald-400">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> 正常 ({lastPingTime})
              </span>
            ) : (
              <span className="flex items-center text-rose-400">
                <XCircle className="mr-1 h-3.5 w-3.5" /> 未连接
              </span>
            )}
          </div>
          <button
            onClick={refreshState}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* 主界面 */}
      <main className="flex flex-1 overflow-hidden">
        {/* 左侧侧边栏 */}
        <aside className="w-64 border-r border-slate-800 bg-slate-900/40 p-3 flex flex-col justify-between">
          <div className="space-y-4 overflow-y-auto">
            {/* 会话列表 */}
            <div>
              <div className="flex items-center justify-between px-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Agent 会话
                </span>
                <button
                  onClick={handleCreateSession}
                  className="flex items-center text-xs text-blue-400 hover:text-blue-300 font-medium space-x-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>新建</span>
                </button>
              </div>

              <div className="space-y-1">
                {sessions.map((sess) => (
                  <button
                    key={sess.id}
                    onClick={() => {
                      setCurrentSessionId(sess.id);
                      setActiveTab("chat");
                    }}
                    className={`w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors ${
                      currentSessionId === sess.id && activeTab === "chat"
                        ? "bg-blue-600/20 text-blue-300 border border-blue-500/30 font-medium"
                        : "text-slate-400 hover:bg-slate-800/60"
                    }`}
                  >
                    <span className="flex items-center space-x-2 truncate">
                      <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{sess.title}</span>
                    </span>
                    {sess.isRunning && (
                      <span className="h-2 w-2 rounded-full bg-blue-400 animate-ping shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* 差异审查与微内核视图 */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-2 mb-2">
                工作台功能
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => setActiveTab("diff")}
                  className={`w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                    activeTab === "diff"
                      ? "bg-slate-800 text-slate-100 font-medium"
                      : "text-slate-400 hover:bg-slate-800/50"
                  }`}
                >
                  <span className="flex items-center space-x-2">
                    <GitCompare className="h-3.5 w-3.5 text-cyan-400" />
                    <span>代码差异审查</span>
                  </span>
                  {pendingDiffsCount > 0 && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-mono font-bold">
                      {pendingDiffsCount} 待审查
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab("plugins")}
                  className={`w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                    activeTab === "plugins"
                      ? "bg-slate-800 text-slate-100 font-medium"
                      : "text-slate-400 hover:bg-slate-800/50"
                  }`}
                >
                  <span className="flex items-center space-x-2">
                    <Layers className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Cordis 插件 ({plugins.length})</span>
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab("tools")}
                  className={`w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                    activeTab === "tools"
                      ? "bg-slate-800 text-slate-100 font-medium"
                      : "text-slate-400 hover:bg-slate-800/50"
                  }`}
                >
                  <span className="flex items-center space-x-2">
                    <Wrench className="h-3.5 w-3.5 text-emerald-400" />
                    <span>已注册工具 ({tools.length})</span>
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 text-[11px] text-slate-400">
            <div className="font-medium text-slate-300 mb-0.5 flex items-center gap-1.5 text-emerald-400">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>沙箱与门禁已激活</span>
            </div>
            <div>路径约束防护与高危指令审批已就绪。</div>
          </div>
        </aside>

        {/* 右侧主工作区 */}
        <section className="flex flex-1 flex-col overflow-hidden bg-slate-950">
          {activeTab === "chat" ? (
            <div className="flex flex-1 flex-col h-full overflow-hidden">
              {/* 消息滚动流 */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center text-center p-6 text-slate-500">
                    <Sparkles className="h-10 w-10 text-blue-400/50 mb-3" />
                    <h3 className="text-base font-semibold text-slate-300">DeepSeek Harness 对话就绪</h3>
                    <p className="text-xs max-w-sm mt-1">
                      输入编程指令，Agent 将在 Workspace Jail 沙箱内执行规划与工具调用，敏感指令自动触发审批。
                    </p>
                  </div>
                )}

                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex space-x-3 max-w-4xl mx-auto ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {msg.role === "assistant" && (
                      <div className="h-7 w-7 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="h-4 w-4" />
                      </div>
                    )}

                    <div
                      className={`space-y-2 max-w-[85%] rounded-xl p-3.5 text-sm ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white rounded-br-none"
                          : "bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none"
                      }`}
                    >
                      {/* 思考过程折叠块 */}
                      {msg.thought && (
                        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 text-xs text-slate-400 overflow-hidden mb-2">
                          <button
                            onClick={() => toggleThought(msg.id)}
                            className="flex w-full items-center justify-between px-2.5 py-1.5 bg-slate-800/30 hover:bg-slate-800/60 font-mono text-[11px] text-slate-300"
                          >
                            <span className="flex items-center space-x-1.5 text-indigo-300">
                              <Brain className="h-3.5 w-3.5" />
                              <span>深度思考过程 (Thought Chain)</span>
                            </span>
                            {collapsedThoughts[msg.id] ? (
                              <ChevronRight className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {!collapsedThoughts[msg.id] && (
                            <div className="p-2.5 whitespace-pre-wrap font-mono text-[11px] text-slate-400 leading-relaxed border-t border-slate-800/50">
                              {msg.thought}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 工具调用卡片 */}
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div className="space-y-1.5 my-2">
                          {msg.toolCalls.map((call) => (
                            <div
                              key={call.id}
                              className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 text-xs"
                            >
                              <div className="flex items-center justify-between text-[11px] font-mono">
                                <span className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
                                  <Wrench className="h-3.5 w-3.5" />
                                  <span>工具调用: {call.toolName}</span>
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                                    call.status === "running"
                                      ? "bg-amber-500/20 text-amber-300 animate-pulse"
                                      : "bg-emerald-500/20 text-emerald-300"
                                  }`}
                                >
                                  {call.status}
                                </span>
                              </div>
                              {call.result !== undefined && (
                                <div className="mt-1.5 p-1.5 bg-slate-900/90 rounded text-[11px] font-mono text-slate-400 max-h-24 overflow-y-auto">
                                  {typeof call.result === "string"
                                    ? call.result
                                    : JSON.stringify(call.result, null, 2)}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 正文内容 */}
                      <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                    </div>

                    {msg.role === "user" && (
                      <div className="h-7 w-7 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
                        <User className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* 底部输入框 */}
              <div className="border-t border-slate-800 bg-slate-900/60 p-3 backdrop-blur">
                <div className="max-w-4xl mx-auto flex items-end space-x-2">
                  <textarea
                    value={inputPrompt}
                    onChange={(e) => setInputPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="输入编程指令或需求... (Enter 发送, Shift+Enter 换行)"
                    rows={2}
                    className="flex-1 resize-none rounded-xl border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />

                  {isTaskRunning ? (
                    <button
                      onClick={handleInterrupt}
                      className="flex items-center space-x-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-2.5 text-xs font-semibold shadow-lg shadow-rose-600/20 transition-all"
                      title="中断任务"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      <span>中断</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleSendMessage}
                      disabled={!inputPrompt.trim()}
                      className="flex items-center space-x-1 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-3.5 py-2.5 text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>发送</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : activeTab === "diff" ? (
            /* Monaco 代码差异审查面板 */
            <DiffReviewer diffs={diffs} onApplyDiff={handleApplyDiff} />
          ) : activeTab === "plugins" ? (
            /* 插件面板 */
            <div className="overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-4">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Layers className="h-5 w-5 text-indigo-400" /> Cordis 微内核已激活插件
              </h2>
              <div className="grid grid-cols-1 gap-3">
                {plugins.map((p) => (
                  <div key={p.name} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-slate-200">{p.name}</span>
                      <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-blue-400 uppercase font-mono">
                        {p.source}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{p.description}</p>
                    <div className="mt-2 text-xs text-slate-500">工具: {p.tools.join(", ")}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* 工具面板 */
            <div className="overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-4">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Wrench className="h-5 w-5 text-emerald-400" /> 全局注册工具 (Tool Registry)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {tools.map((t) => (
                  <div key={t.name} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                    <div className="font-semibold text-emerald-400 font-mono text-xs">{t.name}</div>
                    <p className="text-xs text-slate-400 mt-1">{t.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
export default App;
