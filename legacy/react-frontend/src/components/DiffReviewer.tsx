/**
 * @fileoverview Monaco Editor 代码差异审查组件 (Diff Reviewer)
 * @description 基于 @monaco-editor/react DiffEditor 构建，提供高保真 Git 风格代码比对、左右/内联分栏切换及一键接受/拒绝变更。
 */

import React, { useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Check, X, SplitSquareVertical, FileCode, CheckCircle2, XCircle, Clock } from "lucide-react";

export interface FileDiffItem {
  id: string;
  sessionId: string;
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  language: string;
  status: "pending" | "accepted" | "rejected";
  timestamp: number;
}

interface DiffReviewerProps {
  diffs: FileDiffItem[];
  onApplyDiff: (diffId: string, accepted: boolean) => Promise<void>;
}

/**
 * 代码差异比对与审查器组件
 */
export function DiffReviewer({ diffs, onApplyDiff }: DiffReviewerProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [renderSideBySide, setRenderSideBySide] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  if (diffs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-500">
        <FileCode className="h-12 w-12 text-slate-600 mb-3" />
        <h3 className="text-base font-semibold text-slate-300">暂无待审查的代码变更</h3>
        <p className="text-xs max-w-sm mt-1">
          当 Agent 在会话中提出修改文件或创建代码时，生成的代码差异快照将在此处呈现。
        </p>
      </div>
    );
  }

  const currentDiff = diffs[selectedIndex] || diffs[0];

  const handleAction = async (accepted: boolean) => {
    if (!currentDiff || isProcessing) return;
    setIsProcessing(true);
    try {
      await onApplyDiff(currentDiff.id, accepted);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-950">
      {/* 顶部工具条 */}
      <div className="flex h-12 items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4">
        {/* 文件列表标签 */}
        <div className="flex items-center space-x-2 overflow-x-auto">
          {diffs.map((diff, idx) => (
            <button
              key={diff.id}
              onClick={() => setSelectedIndex(idx)}
              className={`flex items-center space-x-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors ${
                selectedIndex === idx
                  ? "bg-blue-600/20 text-blue-300 border border-blue-500/30 font-medium"
                  : "text-slate-400 hover:bg-slate-800/60"
              }`}
            >
              <FileCode className="h-3.5 w-3.5" />
              <span className="font-mono">{diff.filePath.split(/[/\\]/).pop()}</span>
              {diff.status === "pending" && <Clock className="h-3 w-3 text-amber-400" />}
              {diff.status === "accepted" && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
              {diff.status === "rejected" && <XCircle className="h-3 w-3 text-rose-400" />}
            </button>
          ))}
        </div>

        {/* 视图切换与审批按钮 */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setRenderSideBySide((prev) => !prev)}
            className={`flex items-center space-x-1 rounded-lg px-2 py-1 text-xs border transition-colors ${
              renderSideBySide
                ? "bg-slate-800 text-slate-200 border-slate-700"
                : "text-slate-400 border-slate-800 hover:bg-slate-850"
            }`}
            title="切换左右分栏 / 内联视图"
          >
            <SplitSquareVertical className="h-3.5 w-3.5" />
            <span>{renderSideBySide ? "左右分栏" : "单栏内联"}</span>
          </button>

          {currentDiff.status === "pending" ? (
            <div className="flex items-center space-x-2">
              <button
                onClick={() => handleAction(false)}
                disabled={isProcessing}
                className="flex items-center space-x-1 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-rose-300 border border-rose-900/40 px-2.5 py-1 text-xs font-medium transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                <span>放弃变更</span>
              </button>
              <button
                onClick={() => handleAction(true)}
                disabled={isProcessing}
                className="flex items-center space-x-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 text-xs font-semibold shadow-sm transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
                <span>采纳变更</span>
              </button>
            </div>
          ) : (
            <div className="text-xs font-mono font-medium">
              {currentDiff.status === "accepted" && (
                <span className="text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
                  已写入磁盘
                </span>
              )}
              {currentDiff.status === "rejected" && (
                <span className="text-rose-400 bg-rose-500/10 px-2 py-1 rounded border border-rose-500/20">
                  已丢弃
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Monaco Diff 编辑器 */}
      <div className="flex-1 overflow-hidden">
        <DiffEditor
          key={`${currentDiff.id}-${renderSideBySide}`}
          original={currentDiff.originalContent}
          modified={currentDiff.modifiedContent}
          language={currentDiff.language}
          theme="vs-dark"
          options={{
            renderSideBySide,
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: "on",
            wordWrap: "on",
            renderWhitespace: "selection",
          }}
          loading={
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              加载 Monaco 差异编辑器...
            </div>
          }
        />
      </div>
    </div>
  );
}
export default DiffReviewer;
