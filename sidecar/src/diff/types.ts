/**
 * @fileoverview 文件代码差异与暂存区数据契约
 * @description 定义单文件差异记录、左右分栏比对元数据以及暂存变更状态。
 */

/**
 * 单个文件的代码差异记录
 */
export interface FileDiffRecord {
  id: string;
  sessionId: string;
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  language: string;
  status: "pending" | "accepted" | "rejected";
  timestamp: number;
}
