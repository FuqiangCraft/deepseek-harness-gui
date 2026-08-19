# 项目 Agent 开发规范与指令指南 (AGENT.md)

本文件定义了当前项目中 AI Agent 及开发人员需严格遵循的文件注释与代码规范。

---

## 1. 核心规则概览

1. **文件入口中文头部描述（强制）**：
   - 创建的每个文件（包括源代码、脚本、配置文件等），在文件顶部必须包含**中文头部注释**，清晰说明该文件的核心职责、功能定位及主要模块。
2. **语言专属 API / 文档注释规范（强制）**：
   - **TypeScript / JavaScript**：所有导出函数、类、接口、类型、常量等必须使用标准的 **JSDoc** 格式注释。
   - **其他语言**：严格按照对应语言的官方文档注释标准进行编写（如 Python Docstring、Go Doc、Rustdoc、Javadoc、C# XML Documentation 等）。
3. **代码整洁与可维护性**：
   - 保持注释与代码逻辑同步更新，严禁出现误导性注释或空洞无意义的注释。

---

## 2. 文件头部中文描述规范

每个文件最开头必须包含文件级注释，结构建议包含：
- **文件描述**：该文件的主要作用、职责范围。
- **主要功能/模块**：包含的关键能力或核心方法简介。

### 各语言文件头部示例

#### TypeScript / JavaScript
```typescript
/**
 * @fileoverview 用户认证与权限管理服务
 * @description 负责处理用户注册、登录、Token 签发及权限校验等核心业务逻辑。
 */
```

#### Python
```python
"""
文件说明: 数据清洗与特征提取管道
功能描述: 提供针对原始时序数据的降噪、补齐以及特征工程处理函数。
"""
```

#### Go
```go
// Package auth 提供系统认证与权限控制能力。
// 该文件实现了 JWT Token 的生成、解析与过期刷新逻辑。
package auth
```

#### Rust
```rust
//! 模块说明: 异步任务调度引擎
//! 功能描述: 负责管理后台任务队列、Worker 线程池分发以及执行状态监控。
```

#### C / C++ / Java / C#
```c
/**
 * 文件名称: network_socket.c
 * 功能描述: 底层网络套接字通信封装，提供 TCP 连接管理与非阻塞数据收发能力。
 */
```

#### Shell / PowerShell / Python 脚本
```bash
#!/usr/bin/env bash
# 脚本说明: 项目自动化构建与部署脚本
# 功能描述: 自动化执行依赖安装、静态代码检查、单元测试及容器镜像打包。
```

---

## 3. 函数与类型注释规范

### 3.1 TypeScript / JavaScript (JSDoc)
所有函数、类、方法、接口、属性及类型别名必须使用规范的 JSDoc：

```typescript
/**
 * 计算订单总金额（包含折扣与税费）
 *
 * @param items - 订单商品列表
 * @param discountRate - 折扣率（0 到 1 之间的小数）
 * @param taxRate - 税率（如 0.08 表示 8%）
 * @returns 计算后的最终实付金额
 * @throws {Error} 当折扣率或税率小于 0 时抛出异常
 *
 * @example
 * ```ts
 * const total = calculateOrderTotal(cartItems, 0.1, 0.08);
 * ```
 */
export function calculateOrderTotal(
  items: CartItem[],
  discountRate: number,
  taxRate: number
): number {
  // ...
}

/**
 * 用户基础信息结构
 */
export interface UserProfile {
  /** 唯一用户 ID */
  id: string;
  /** 用户昵称 */
  nickname: string;
  /** 电子邮箱地址 */
  email: string;
  /** 账户激活状态 */
  isActive: boolean;
}
```

---

### 3.2 Python (Docstring)
遵循 PEP 257 及 Google / Sphinx 风格：

```python
def fetch_user_data(user_id: str, timeout: int = 30) -> dict:
    """根据用户 ID 获取详细资料.

    Args:
        user_id: 用户的唯一标识符.
        timeout: 请求超时时间（秒），默认为 30 秒.

    Returns:
        包含用户详细字段的字典对象.

    Raises:
        UserNotFoundError: 当指定 ID 的用户不存在时.
        TimeoutError: 当请求超时时.
    """
    pass
```

---

### 3.3 Go (Go Doc)
遵循标准 Go 命名与注释风格：

```go
// CalculateTax 计算指定金额的适用税费。
// 参数 amount 为应税金额，rate 为税率。
// 返回计算后的税额；若 rate 为负数则返回错误。
func CalculateTax(amount float64, rate float64) (float64, error) {
    // ...
}
```

---

### 3.4 Rust (Rustdoc)
使用 `///` 或 `//!` 语法：

```rust
/// 解析传入的配置字符串并生成 Config 实例。
///
/// # 参数
/// * `raw_config` - JSON 或 YAML 格式的原始配置文本
///
/// # 返回值
/// 成功时返回解析后的 [`Config`] 结构体，失败时返回 [`ConfigError`]。
///
/// # 错误
/// 如果输入格式不合法或缺少必填字段，将返回对应的错误信息。
pub fn parse_config(raw_config: &str) -> Result<Config, ConfigError> {
    // ...
}
```

---

### 3.5 Java / C#
- **Java**: 使用 Javadoc（`/** ... */`，配合 `@param`、`@return`、`@throws`）。
- **C#**: 使用 XML 文档注释（`/// <summary>...</summary>`，配合 `<param>`、`<returns>`、`<exception>`）。

---

## 4. Agent 执行 Checklist

在生成或修改任何代码时，Agent 必须核对：
- [ ] 当前文件的最顶部是否已添加包含中文描述的文件头？
- [ ] 新建/修改的函数与类是否具有完整规范的 Doc 注释（JS/TS 用 JSDoc，其他语言用对应标准）？
- [ ] 注释中的参数名、类型及返回值是否与代码实际实现一致？
