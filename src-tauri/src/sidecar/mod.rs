// 文件名称: mod.rs
// 功能描述: 导出 Sidecar 进程管理模块及相关错误类型。

pub mod manager;

pub use manager::{strip_verbatim_prefix, SidecarError, SidecarManager};
