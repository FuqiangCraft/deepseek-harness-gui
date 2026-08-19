/**
 * @fileoverview 企业 DeepSeek Harness 插件模板
 * @description 演示如何编写符合官方 dsh 规范的 Cordis 插件：通过 `ctx.tools.register(defineTool(...))`
 * 向引擎注册企业自定义工具。此模板注册一个"内网 HTTP GET"工具（demo），团队可按此结构扩展
 * 模型网关、认证、内网知识库等能力。插件与官方基线完全解耦，基线升级不影响本插件。
 */
import type { Context } from "@deepseek-ai/cordis";
/**
 * 插件配置（来自 profile 用户层 cordis.patch.yml 中本插件的 config 段）
 */
export interface Config {
    /** 企业内网 API 网关地址 */
    apiEndpoint?: string;
}
/** 插件名（用户层 patch 的 id 应与此一致，便于识别） */
export declare const name = "acme-enterprise";
/** Cordis 依赖声明：使 `ctx.tools` 在 apply 中可访问 */
export declare const inject: readonly ["tools"];
/**
 * 企业插件主入口（Cordis apply 约定，由 include loader 挂载）
 *
 * @param ctx - Cordis 全局上下文（引擎根）
 * @param config - 插件配置
 */
export declare function apply(ctx: Context, config?: Config): void;
