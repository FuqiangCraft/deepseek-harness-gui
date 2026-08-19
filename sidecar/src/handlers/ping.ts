/**
 * @fileoverview 系统级心跳与诊断处理器
 * @description 提供系统存活状态检测与运行时元数据返回。
 */

/**
 * 心跳请求返回负载结构
 */
export interface PingResult {
  /** 响应标识状态 */
  status: "pong";
  /** 当前服务器时间戳 */
  timestamp: number;
  /** Node.js 版本 */
  nodeVersion: string;
  /** 当前平台 */
  platform: string;
}

/**
 * 处理 system.ping 请求
 *
 * @returns 包含系统元数据的心跳结果对象
 */
export function handlePing(): PingResult {
  return {
    status: "pong",
    timestamp: Date.now(),
    nodeVersion: process.version,
    platform: process.platform,
  };
}
