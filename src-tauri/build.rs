// 文件名称: build.rs
// 功能描述: Tauri 构建脚本，负责执行构建期的元数据生成与代码注入。

fn main() {
    tauri_build::build()
}
