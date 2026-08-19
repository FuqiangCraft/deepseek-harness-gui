/**
 * @fileoverview 敏感操作审批门禁 (Approval Gate)
 * @description 拦截高危指令与敏感操作，挂起执行循环向宿主与前端弹出授权卡片，等待用户显式批准后放行。
 */

import { RpcServer } from "../rpc.js";

/**
 * 敏感操作类型
 */
export type ActionType = "shell_command" | "file_deletion" | "external_network" | "sensitive_config";

/**
 * 待审批请求数据契约
 */
export interface ApprovalRequest {
  id: string;
  sessionId?: string;
  actionType: ActionType;
  description: string;
  parameters: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected";
  timestamp: number;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * 审批门禁管理器
 */
export class ApprovalGate {
  private server: RpcServer;
  private pendingRequests = new Map<string, PendingApproval>();
  private autoApprove: boolean = false;

  /**
   * 构造审批门禁
   *
   * @param server - RPC 服务实例
   */
  constructor(server: RpcServer) {
    this.server = server;
  }

  /**
   * 设置是否开启免确认信任模式 (Full Auto)
   */
  public setAutoApprove(enabled: boolean): void {
    this.autoApprove = enabled;
  }

  /**
   * 提出敏感操作审批请求，并异步挂起等待用户授权
   *
   * @param actionType - 操作分类
   * @param description - 风险行为描述
   * @param parameters - 操作参数细节
   * @param riskLevel - 风险评级
   * @param sessionId - 所属会话标识符
   * @returns 用户是否批准
   */
  public async requestApproval(
    actionType: ActionType,
    description: string,
    parameters: Record<string, unknown>,
    riskLevel: "low" | "medium" | "high" = "medium",
    sessionId?: string
  ): Promise<boolean> {
    if (this.autoApprove) {
      return true;
    }

    const id = "req_" + Math.random().toString(36).substring(2, 10);
    const request: ApprovalRequest = {
      id,
      sessionId,
      actionType,
      description,
      parameters,
      riskLevel,
      status: "pending",
      timestamp: Date.now(),
    };

    return new Promise<boolean>((resolve, reject) => {
      // 5 分钟超时自动拒绝
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve(false);
      }, 5 * 60 * 1000);

      this.pendingRequests.set(id, {
        request,
        resolve,
        reject,
        timer,
      });

      // 推送审批请求事件给前端
      this.server.notify("event.approvalRequired", { request });
    });
  }

  /**
   * 用户响应审批请求
   *
   * @param requestId - 请求标识符
   * @param approved - 是否允许
   */
  public respond(requestId: string, approved: boolean): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timer);
    pending.request.status = approved ? "approved" : "rejected";
    this.pendingRequests.delete(requestId);

    this.server.notify("event.approvalCompleted", {
      requestId,
      status: pending.request.status,
    });

    pending.resolve(approved);
    return true;
  }

  /**
   * 查询当前所有挂起待审批的请求列表
   */
  public listPending(): ApprovalRequest[] {
    return Array.from(this.pendingRequests.values()).map((p) => p.request);
  }
}
