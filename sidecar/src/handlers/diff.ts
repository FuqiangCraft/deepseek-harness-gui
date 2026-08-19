/**
 * @fileoverview 代码差异与审查 RPC 处理器
 * @description 注册 diff.list, diff.apply, diff.propose 等远程调用方法。
 */

import { DiffManager } from "../diff/diff-manager.js";

/**
 * 注册代码差异相关的 RPC 处理函数
 *
 * @param diffManager - 差异管理器实例
 * @param rpcRegister - RPC 注册函数
 */
export function registerDiffHandlers(
  diffManager: DiffManager,
  rpcRegister: (method: string, handler: (params: any) => Promise<any> | any) => void
): void {
  // 1. 列出当前差异快照
  rpcRegister("diff.list", async (params?: { sessionId?: string }) => {
    return { diffs: diffManager.listDiffs(params?.sessionId) };
  });

  // 2. 提出文件变更
  rpcRegister(
    "diff.propose",
    async (params: { sessionId: string; filePath: string; modifiedContent: string }) => {
      const diff = await diffManager.proposeChange(
        params.sessionId,
        params.filePath,
        params.modifiedContent
      );
      return { diff };
    }
  );

  // 3. 应用或放弃差异变更
  rpcRegister("diff.apply", async (params: { diffId: string; accepted: boolean }) => {
    const record = await diffManager.applyDiff(params.diffId, params.accepted);
    return { record };
  });
}
