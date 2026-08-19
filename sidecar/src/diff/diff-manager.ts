/**
 * @fileoverview 代码差异与变更审查管理器
 * @description 管理 Agent 提出的文件变更快照，支持暂存审查、左右分栏对比元数据生成及一键应用或放弃。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FileDiffRecord } from "./types.js";
import { RpcServer } from "../rpc.js";

/**
 * 代码差异管理器服务
 */
export class DiffManager {
  private server: RpcServer;
  private diffs = new Map<string, FileDiffRecord>();

  /**
   * 构造代码差异管理器
   *
   * @param server - RPC 服务实例
   */
  constructor(server: RpcServer) {
    this.server = server;
  }

  /**
   * 推导文件扩展名对应的 Monaco 语言标识
   */
  public static detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case ".ts":
      case ".tsx":
        return "typescript";
      case ".js":
      case ".mjs":
      case ".jsx":
        return "javascript";
      case ".rs":
        return "rust";
      case ".json":
        return "json";
      case ".py":
        return "python";
      case ".md":
        return "markdown";
      case ".html":
        return "html";
      case ".css":
        return "css";
      case ".yml":
      case ".yaml":
        return "yaml";
      default:
        return "plaintext";
    }
  }

  /**
   * 提出文件变更计划并暂存快照
   *
   * @param sessionId - 所属会话标识符
   * @param filePath - 目标文件路径
   * @param modifiedContent - 拟写入的新内容
   * @returns 生成的差异快照记录
   */
  public async proposeChange(
    sessionId: string,
    filePath: string,
    modifiedContent: string
  ): Promise<FileDiffRecord> {
    let originalContent = "";
    try {
      originalContent = await fs.readFile(filePath, "utf-8");
    } catch {
      // 文件若不存在则视为空初始内容
      originalContent = "";
    }

    const id = "diff_" + Math.random().toString(36).substring(2, 10);
    const diffRecord: FileDiffRecord = {
      id,
      sessionId,
      filePath,
      originalContent,
      modifiedContent,
      language: DiffManager.detectLanguage(filePath),
      status: "pending",
      timestamp: Date.now(),
    };

    this.diffs.set(id, diffRecord);

    // 推送文件变更事件给宿主
    this.server.notify("event.fileChanged", {
      sessionId,
      diff: diffRecord,
    });

    return diffRecord;
  }

  /**
   * 查询指定会话下的所有差异快照
   */
  public listDiffs(sessionId?: string): FileDiffRecord[] {
    const all = Array.from(this.diffs.values());
    if (sessionId) {
      return all.filter((d) => d.sessionId === sessionId);
    }
    return all;
  }

  /**
   * 应用或放弃指定差异变更
   *
   * @param diffId - 差异标识符
   * @param accepted - 是否接受变更
   */
  public async applyDiff(diffId: string, accepted: boolean): Promise<FileDiffRecord> {
    const record = this.diffs.get(diffId);
    if (!record) {
      throw new Error(`Diff record ${diffId} not found`);
    }

    if (accepted) {
      await fs.mkdir(path.dirname(record.filePath), { recursive: true });
      await fs.writeFile(record.filePath, record.modifiedContent, "utf-8");
      record.status = "accepted";
    } else {
      record.status = "rejected";
    }

    this.server.notify("event.diffStatusChanged", {
      diffId,
      status: record.status,
      filePath: record.filePath,
    });

    return record;
  }
}
