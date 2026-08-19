/**
 * @fileoverview 企业配置同步 RPC 处理器
 * @description 暴露 config.sync 远程调用方法，供 Rust 宿主与前端触发企业配置同步。
 */

import { ConfigSyncManager } from "../sync/config-sync.js";

/**
 * 注册配置同步相关的 RPC 处理函数
 *
 * @param configSync - 配置同步管理器
 * @param rpcRegister - RPC 注册函数
 */
export function registerConfigHandlers(
  configSync: ConfigSyncManager,
  rpcRegister: (method: string, handler: (params: any) => Promise<any> | any) => void
): void {
  rpcRegister("config.sync", async (params?: { remoteUrl?: string }) => {
    return await configSync.syncFromRemote(params?.remoteUrl);
  });
}
