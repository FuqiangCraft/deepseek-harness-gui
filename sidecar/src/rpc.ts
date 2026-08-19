/**
 * @fileoverview Sidecar Stdio JSON-RPC 2.0 消息调度器
 * @description 负责监听 process.stdin 的 NDJSON 帧分包流，解析请求并分发至处理器，将响应与事件回写至 process.stdout。
 */

import * as readline from "node:readline";

/**
 * JSON-RPC 2.0 请求格式接口
 */
export interface RpcRequest<T = unknown> {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: T;
}

/**
 * JSON-RPC 2.0 成功响应接口
 */
export interface RpcSuccessResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string;
  result: T;
}

/**
 * JSON-RPC 2.0 错误响应接口
 */
export interface RpcErrorResponse {
  jsonrpc: "2.0";
  id: string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * JSON-RPC 2.0 单向事件通知接口
 */
export interface RpcNotification<T = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: T;
}

export type RpcHandler<P = any, R = any> = (params: P) => Promise<R> | R;

/**
 * JSON-RPC 2.0 消息路由器与通信适配器
 */
export class RpcServer {
  private handlers = new Map<string, RpcHandler>();
  private rl: readline.Interface | null = null;

  /**
   * 注册指定方法的远程调用处理器
   *
   * @param method - 方法名称
   * @param handler - 异步/同步处理函数
   */
  public register<P = any, R = any>(method: string, handler: RpcHandler<P, R>): void {
    this.handlers.set(method, handler);
  }

  /**
   * 启动 Stdio 输入监听循环
   */
  public start(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on("line", async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const message = JSON.parse(trimmed) as RpcRequest;
        if (message.jsonrpc === "2.0" && message.id && message.method) {
          await this.handleRequest(message);
        }
      } catch (err: any) {
        this.sendRaw({
          jsonrpc: "2.0",
          id: "null",
          error: {
            code: -32700,
            message: `Parse error: ${err.message}`,
          },
        });
      }
    });
  }

  /**
   * 发送单向事件通知给 Rust 宿主
   *
   * @param method - 事件名称
   * @param params - 事件负载数据
   */
  public notify<T = unknown>(method: string, params?: T): void {
    this.sendRaw({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  /**
   * 处理单个 RPC 请求并返回结果
   */
  private async handleRequest(req: RpcRequest): Promise<void> {
    const handler = this.handlers.get(req.method);
    if (!handler) {
      this.sendRaw({
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: -32601,
          message: `Method not found: ${req.method}`,
        },
      });
      return;
    }

    try {
      const result = await handler(req.params);
      this.sendRaw({
        jsonrpc: "2.0",
        id: req.id,
        result,
      });
    } catch (err: any) {
      this.sendRaw({
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: -32000,
          message: err.message || "Internal server error",
        },
      });
    }
  }

  /**
   * 将 JSON 对象编码为单行字符串写入 stdout
   */
  private sendRaw(data: RpcSuccessResponse | RpcErrorResponse | RpcNotification): void {
    process.stdout.write(JSON.stringify(data) + "\n");
  }

  /**
   * 停止 Stdio 监听
   */
  public stop(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
