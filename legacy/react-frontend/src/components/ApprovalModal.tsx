/**
 * @fileoverview 敏感操作审批交互弹窗 (Approval Modal)
 * @description 当 Agent 拟执行系统 Shell 指令或高危工具时弹出交互确认卡片，展示风险详情并等待用户批准或拒绝。
 */

import React from "react";
import { ShieldAlert, Check, X, Terminal, AlertTriangle } from "lucide-react";

export interface ApprovalRequestItem {
  id: string;
  sessionId?: string;
  actionType: "shell_command" | "file_deletion" | "external_network" | "sensitive_config";
  description: string;
  parameters: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected";
  timestamp: number;
}

interface ApprovalModalProps {
  request: ApprovalRequestItem | null;
  onRespond: (requestId: string, approved: boolean) => Promise<void>;
}

/**
 * 敏感操作安全审批模态框组件
 */
export function ApprovalModal({ request, onRespond }: ApprovalModalProps): React.JSX.Element | null {
  if (!request) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl border border-amber-500/40 bg-slate-900 shadow-2xl overflow-hidden">
        {/* 顶部标题区 */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-amber-500/10 px-5 py-3.5">
          <div className="flex items-center space-x-2.5 text-amber-400">
            <ShieldAlert className="h-5 w-5" />
            <span className="font-semibold text-sm">高危操作审批门禁 (Approval Gate)</span>
          </div>
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
            {request.riskLevel} 风险
          </span>
        </div>

        {/* 描述与内容 */}
        <div className="p-5 space-y-4">
          <div className="flex items-start space-x-3 text-slate-300 text-xs leading-relaxed">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{request.description}</span>
          </div>

          {/* 命令与参数细节卡片 */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs font-mono">
            <div className="flex items-center space-x-1.5 text-slate-400 text-[11px] mb-1.5">
              <Terminal className="h-3.5 w-3.5 text-blue-400" />
              <span>拟执行参数细节:</span>
            </div>
            <pre className="text-slate-200 overflow-x-auto p-2 bg-slate-900/80 rounded border border-slate-800/80 max-h-40">
              {JSON.stringify(request.parameters, null, 2)}
            </pre>
          </div>

          <p className="text-[11px] text-slate-500">
            提示：该操作由 Agent 规划触发，在您点击「允许执行」之前，Agent 将保持安全挂起状态。
          </p>
        </div>

        {/* 底部操作按钮 */}
        <div className="flex items-center justify-end space-x-3 border-t border-slate-800 bg-slate-900/60 px-5 py-3.5">
          <button
            onClick={() => onRespond(request.id, false)}
            className="flex items-center space-x-1.5 rounded-xl border border-rose-900/50 bg-rose-950/20 hover:bg-rose-950/40 text-rose-300 px-4 py-2 text-xs font-medium transition-colors"
          >
            <X className="h-4 w-4" />
            <span>拒绝执行</span>
          </button>
          <button
            onClick={() => onRespond(request.id, true)}
            className="flex items-center space-x-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 text-xs font-semibold shadow-lg shadow-amber-600/20 transition-colors"
          >
            <Check className="h-4 w-4" />
            <span>允许执行</span>
          </button>
        </div>
      </div>
    </div>
  );
}
export default ApprovalModal;
