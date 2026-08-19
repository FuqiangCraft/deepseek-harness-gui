/**
 * @fileoverview 工作区沙箱与路径越界防护 (Workspace Jail)
 * @description 规范化校验文件路径，严格约束 Agent 的文件读写与工具调用范围限定在当前工程工作区根目录内。
 */

import * as path from "node:path";

/**
 * 工作区沙箱安全管理器
 */
export class WorkspaceJail {
  private rootDir: string;

  /**
   * 构造沙箱管理器
   *
   * @param rootDir - 允许访问的工作区根目录绝对路径
   */
  constructor(rootDir: string = process.cwd()) {
    this.rootDir = path.resolve(rootDir);
  }

  /**
   * 获取当前生效的工作区根目录
   */
  public getRootDir(): string {
    return this.rootDir;
  }

  /**
   * 更新工作区根目录
   *
   * @param newRootDir - 新的工作区绝对路径
   */
  public setRootDir(newRootDir: string): void {
    this.rootDir = path.resolve(newRootDir);
  }

  /**
   * 校验目标路径是否处于工作区沙箱之内
   *
   * @param targetPath - 待访问的目标文件或目录路径
   * @returns 规范化后的绝对路径
   * @throws {Error} 当路径越出工作区边界（Path Traversal）时抛出安全异常
   */
  public resolveSafePath(targetPath: string): string {
    const resolved = path.resolve(this.rootDir, targetPath);
    const relative = path.relative(this.rootDir, resolved);

    // 若相对路径以 ".." 开头或为绝对根路径外部，则视为越界
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `[Security Violation] Access denied: Path "${targetPath}" is outside workspace jail "${this.rootDir}"`
      );
    }

    return resolved;
  }

  /**
   * 检查路径是否安全（不抛出异常）
   *
   * @param targetPath - 目标路径
   */
  public isSafe(targetPath: string): boolean {
    try {
      this.resolveSafePath(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
