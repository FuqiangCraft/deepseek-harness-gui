/**
 * @fileoverview 双层 Cordis 插件动态加载与扫描器
 * @description 实现内置基线插件加载与外部动态目录 (~/.harness/plugins, <workspace>/.harness/plugins) 的扫描与挂载。
 */

import { Context } from "cordis";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import { PluginMetadata, PluginSource } from "./types.js";
import { BaseToolsPlugin } from "./builtin/base-tools.js";
import { WorkspaceJail } from "../security/workspace-jail.js";
import { ApprovalGate } from "../security/approval-gate.js";

/**
 * 动态插件加载器
 */
export class PluginLoader {
  private ctx: Context;
  private loadedPlugins: Map<string, PluginMetadata> = new Map();
  private jail?: WorkspaceJail;
  private approvalGate?: ApprovalGate;

  /**
   * 构造插件加载器
   *
   * @param ctx - Cordis 上下文
   * @param jail - 工作区沙箱管理器
   * @param approvalGate - 审批门禁管理器
   */
  constructor(ctx: Context, jail?: WorkspaceJail, approvalGate?: ApprovalGate) {
    this.ctx = ctx;
    this.jail = jail;
    this.approvalGate = approvalGate;
  }

  /**
   * 初始化并加载所有内置插件与外部插件
   *
   * @param workspaceDir - 当前选定的工作区根目录
   */
  public async initialize(workspaceDir: string = process.cwd()): Promise<void> {
    // 1. 加载内置基线插件 (Layer 1)
    await this.loadBuiltinPlugins();

    // 2. 扫描并加载用户全局插件 (~/.harness/plugins)
    const globalPluginsDir = path.join(os.homedir(), ".harness", "plugins");
    await this.scanAndLoadDirectory(globalPluginsDir, "global");

    // 3. 扫描并加载工作区级插件 (<workspace>/.harness/plugins)
    const workspacePluginsDir = path.join(workspaceDir, ".harness", "plugins");
    await this.scanAndLoadDirectory(workspacePluginsDir, "workspace");
  }

  /**
   * 加载官方基线只读插件
   */
  private async loadBuiltinPlugins(): Promise<void> {
    const beforeTools = new Set(this.ctx.toolRegistry.listTools().map((t) => t.name));
    this.ctx.plugin(BaseToolsPlugin, {
      jail: this.jail,
      approvalGate: this.approvalGate,
    });
    const afterTools = this.ctx.toolRegistry.listTools().map((t) => t.name);
    const addedTools = afterTools.filter((name) => !beforeTools.has(name));

    this.loadedPlugins.set("deepseek-harness-base", {
      name: "deepseek-harness-base",
      version: "0.1.0",
      description: "DeepSeek Harness 官方基线核心工具集 (受沙箱与审批门禁约束)",
      source: "builtin",
      tools: addedTools,
      enabled: true,
    });
  }

  /**
   * 扫描指定目录并动态挂载所有符合规范的插件模块
   *
   * @param dirPath - 插件所在目录绝对路径
   * @param source - 插件所属来源
   */
  public async scanAndLoadDirectory(dirPath: string, source: PluginSource): Promise<void> {
    try {
      const exists = await fs
        .access(dirPath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        return;
      }

      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await this.loadPluginPackage(fullPath, entry.name, source);
        } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))) {
          const pluginName = path.basename(entry.name, path.extname(entry.name));
          await this.loadSingleFilePlugin(fullPath, pluginName, source);
        }
      }
    } catch (err: any) {
      console.warn(`[PluginLoader] Failed to scan directory ${dirPath}:`, err.message);
    }
  }

  /**
   * 加载单文件形式的插件模块
   */
  private async loadSingleFilePlugin(filePath: string, name: string, source: PluginSource): Promise<void> {
    try {
      const fileUrl = pathToFileURL(filePath).href;
      const pluginModule = await import(fileUrl);
      const pluginFn = pluginModule.default || pluginModule;

      if (typeof pluginFn === "function") {
        const beforeTools = new Set(this.ctx.toolRegistry.listTools().map((t) => t.name));
        this.ctx.plugin(pluginFn);
        const afterTools = this.ctx.toolRegistry.listTools().map((t) => t.name);
        const addedTools = afterTools.filter((tName) => !beforeTools.has(tName));

        this.loadedPlugins.set(name, {
          name,
          version: "1.0.0",
          description: `动态加载插件: ${name}`,
          source,
          tools: addedTools,
          enabled: true,
        });
      }
    } catch (err: any) {
      console.error(`[PluginLoader] Failed to load plugin file ${filePath}:`, err.message);
    }
  }

  /**
   * 加载目录包形式的插件
   */
  private async loadPluginPackage(dirPath: string, name: string, source: PluginSource): Promise<void> {
    try {
      let entryFile = path.join(dirPath, "index.js");
      let pkgDescription = `动态企业插件包: ${name}`;
      let pkgVersion = "1.0.0";

      const pkgJsonPath = path.join(dirPath, "package.json");
      const pkgExists = await fs
        .access(pkgJsonPath)
        .then(() => true)
        .catch(() => false);

      if (pkgExists) {
        const rawPkg = await fs.readFile(pkgJsonPath, "utf-8");
        const parsed = JSON.parse(rawPkg);
        if (parsed.main) {
          entryFile = path.join(dirPath, parsed.main);
        }
        if (parsed.description) pkgDescription = parsed.description;
        if (parsed.version) pkgVersion = parsed.version;
      }

      const fileUrl = pathToFileURL(entryFile).href;
      const pluginModule = await import(fileUrl);
      const pluginFn = pluginModule.default || pluginModule;

      if (typeof pluginFn === "function") {
        const beforeTools = new Set(this.ctx.toolRegistry.listTools().map((t) => t.name));
        this.ctx.plugin(pluginFn);
        const afterTools = this.ctx.toolRegistry.listTools().map((t) => t.name);
        const addedTools = afterTools.filter((tName) => !beforeTools.has(tName));

        this.loadedPlugins.set(name, {
          name,
          version: pkgVersion,
          description: pkgDescription,
          source,
          tools: addedTools,
          enabled: true,
        });
      }
    } catch (err: any) {
      console.error(`[PluginLoader] Failed to load plugin package ${dirPath}:`, err.message);
    }
  }

  /**
   * 获取当前已加载的所有插件元数据列表
   */
  public listPlugins(): PluginMetadata[] {
    return Array.from(this.loadedPlugins.values());
  }
}
