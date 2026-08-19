/**
 * @fileoverview 审批门禁 RPC 处理器
 * @description 暴露 approval.list, approval.respond, approval.setAutoApprove 等远程调用方法。
 */

import { ApprovalGate } from "../security/approval-gate.js";

/**
 * 注册审批门禁相关的 RPC 处理函数
 *
 * @param approvalGate - 审批门禁管理器实例
 * @param rpcRegister - RPC 注册函数
 */
export function registerApprovalHandlers(
  approvalGate: ApprovalGate,
  rpcRegister: (method: string, handler: (params: any) => Promise<any> | any) => void
): void {
  // 1. 获取当前挂起待审批的请求列表
  rpcRegister("approval.list", async () => {
    return { requests: approvalGate.listPending() };
  });

  // 2. 响应审批结果 (同意 / 拒绝)
  rpcRegister("approval.respond", async (params: { requestId: string; approved: boolean }) => {
    const success = approvalGate.respond(params.requestId, params.approved);
    return { success };
  });

  // 3. 切换信任开发模式 (免确认)
  rpcRegister("approval.setAutoApprove", async (params: { enabled: boolean }) => {
    approvalGate.setAutoApprove(params.enabled);
    return { autoApprove: params.enabled };
  });
}
