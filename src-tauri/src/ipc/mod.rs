// 文件名称: mod.rs
// 功能描述: 导出进程间通信 (IPC) 分帧器与 JSON-RPC 2.0 协议模块。

pub mod framing;
pub mod protocol;

pub use framing::{read_frame, write_frame};
pub use protocol::{RpcError, RpcNotification, RpcRequest, RpcResponse};
