// 文件名称: protocol.rs
// 功能描述: JSON-RPC 2.0 协议数据结构与序列化定义，提供强类型的请求、响应与事件通知封装。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC 2.0 请求对象结构
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcRequest {
    /// 协议版本，固定为 "2.0"
    pub jsonrpc: String,
    /// 调用的远程方法名称
    pub method: String,
    /// 方法参数
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
    /// 请求唯一标识符
    pub id: String,
}

impl RpcRequest {
    /// 创建一个新的 RPC 请求实例。
    ///
    /// # 参数
    /// * `id` - 请求标识符
    /// * `method` - 远程方法名
    /// * `params` - 请求参数
    pub fn new(id: impl Into<String>, method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            method: method.into(),
            params,
            id: id.into(),
        }
    }
}

/// JSON-RPC 2.0 错误对象结构
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcError {
    /// 错误码
    pub code: i32,
    /// 错误消息文本
    pub message: String,
    /// 附加数据
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// JSON-RPC 2.0 响应对象结构
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcResponse {
    /// 协议版本，固定为 "2.0"
    pub jsonrpc: String,
    /// 成功调用结果
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// 错误信息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
    /// 对应请求的唯一标识符
    pub id: String,
}

impl RpcResponse {
    /// 创建一个表示调用成功的 RPC 响应。
    ///
    /// # 参数
    /// * `id` - 对应请求的标识符
    /// * `result` - 返回的结果数据
    pub fn success(id: impl Into<String>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            result: Some(result),
            error: None,
            id: id.into(),
        }
    }

    /// 创建一个表示调用失败的 RPC 错误响应。
    ///
    /// # 参数
    /// * `id` - 对应请求的标识符
    /// * `code` - 错误码
    /// * `message` - 错误消息
    pub fn failure(id: impl Into<String>, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(RpcError {
                code,
                message: message.into(),
                data: None,
            }),
            id: id.into(),
        }
    }
}

/// JSON-RPC 2.0 单向事件通知对象结构（无 id）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcNotification {
    /// 协议版本，固定为 "2.0"
    pub jsonrpc: String,
    /// 事件名称
    pub method: String,
    /// 事件负载数据
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl RpcNotification {
    /// 创建一个新的事件通知。
    ///
    /// # 参数
    /// * `method` - 事件名称
    /// * `params` - 事件参数
    pub fn new(method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            method: method.into(),
            params,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_rpc_request_serialization() {
        let req = RpcRequest::new("req-1", "system.ping", Some(json!({"timestamp": 12345})));
        let json_str = serde_json::to_string(&req).unwrap();
        assert!(json_str.contains(r#""jsonrpc":"2.0""#));
        assert!(json_str.contains(r#""method":"system.ping""#));
        assert!(json_str.contains(r#""id":"req-1""#));

        let deserialized: RpcRequest = serde_json::from_str(&json_str).unwrap();
        assert_eq!(req, deserialized);
    }

    #[test]
    fn test_rpc_response_success_and_failure() {
        let success = RpcResponse::success("req-1", json!({"status": "pong"}));
        let success_json = serde_json::to_string(&success).unwrap();
        assert!(success_json.contains(r#""status":"pong""#));

        let fail = RpcResponse::failure("req-2", -32601, "Method not found");
        let fail_json = serde_json::to_string(&fail).unwrap();
        assert!(fail_json.contains(r#""code":-32601"#));
    }
}
