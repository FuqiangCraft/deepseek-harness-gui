/**
 * @fileoverview 企业 DeepSeek Harness 插件模板
 * @description 演示如何编写符合官方 dsh 规范的 Cordis 插件：通过 `ctx.tools.register(defineTool(...))`
 * 向引擎注册企业自定义工具。此模板注册一个"内网 HTTP GET"工具（demo），团队可按此结构扩展
 * 模型网关、认证、内网知识库等能力。插件与官方基线完全解耦，基线升级不影响本插件。
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
/** 插件名（用户层 patch 的 id 应与此一致，便于识别） */
export const name = "acme-enterprise";
/** Cordis 依赖声明：使 `ctx.tools` 在 apply 中可访问 */
export const inject = ["tools"];
/**
 * 企业插件主入口（Cordis apply 约定，由 include loader 挂载）
 *
 * @param ctx - Cordis 全局上下文（引擎根）
 * @param config - 插件配置
 */
export function apply(ctx, config = {}) {
    const endpoint = config.apiEndpoint ?? "https://example.com";
    // 注册一个受 exec.signal 取消约束的内网 HTTP GET 工具
    ctx.tools.register(defineTool({
        name: "enterprise_http_get",
        description: "调用企业内部 HTTP GET 接口，返回 JSON 结果",
        parameters: {
            path: { type: "string", required: true, description: "接口路径，如 /api/v1/search" },
            query: { type: "string", description: "可选查询参数串，如 q=foo&n=10" },
        },
        output: {
            schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    status: { type: "number", required: true },
                    body: { type: "object", required: true, additionalProperties: true },
                },
            },
            render: (args, value) => [
                {
                    type: "text",
                    text: `GET ${endpoint}${args.path} → HTTP ${value.status}`,
                },
            ],
        },
        execute: async (args, exec) => {
            const res = await fetch(`${endpoint}${args.path}${args.query ? `?${args.query}` : ""}`, {
                signal: exec.signal,
            });
            return { status: res.status, body: await res.json() };
        },
    }));
}
