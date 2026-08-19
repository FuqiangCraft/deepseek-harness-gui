// 文件名称: framing.rs
// 功能描述: 基于换行符的 NDJSON 消息分帧器，负责将标准输入输出的字节流与 JSON-RPC 字符串进行相互编解码。

use std::io::{self, BufRead, Write};

/// 将单条 JSON-RPC 消息编码并写入输出流，并在末尾追加换行符。
///
/// # 参数
/// * `writer` - 实现了 [`Write`] trait 的输出流
/// * `message` - 待写入的 JSON 字符串内容
///
/// # 返回值
/// 写入成功返回 `Ok(())`，发生 I/O 错误时返回 [`io::Error`]。
pub fn write_frame<W: Write>(writer: &mut W, message: &str) -> io::Result<()> {
    writer.write_all(message.as_bytes())?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

/// 从输入流中读取下一行完整的 JSON 消息帧。
///
/// # 参数
/// * `reader` - 实现了 [`BufRead`] trait 的输入流缓冲器
///
/// # 返回值
/// 若成功读取到非空行则返回 `Ok(Some(String))`，若到达流末尾 (EOF) 则返回 `Ok(None)`。
pub fn read_frame<R: BufRead>(reader: &mut R) -> io::Result<Option<String>> {
    let mut line = String::new();
    let bytes_read = reader.read_line(&mut line)?;
    if bytes_read == 0 {
        return Ok(None);
    }
    let trimmed = line.trim_end_matches(|c| c == '\r' || c == '\n').to_string();
    if trimmed.is_empty() {
        // 跳过纯空行
        return read_frame(reader);
    }
    Ok(Some(trimmed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_write_and_read_single_frame() {
        let mut buffer = Vec::new();
        let payload = r#"{"jsonrpc":"2.0","method":"system.ping","id":"1"}"#;

        write_frame(&mut buffer, payload).expect("write_frame should succeed");

        let mut reader = Cursor::new(buffer);
        let received = read_frame(&mut reader)
            .expect("read_frame should succeed")
            .expect("frame should exist");

        assert_eq!(received, payload);
    }

    #[test]
    fn test_read_multiple_frames_with_blank_lines() {
        let raw_data = b"{\"id\":1}\n\n\r\n{\"id\":2}\n";
        let mut reader = Cursor::new(raw_data);

        let frame1 = read_frame(&mut reader).unwrap().unwrap();
        assert_eq!(frame1, "{\"id\":1}");

        let frame2 = read_frame(&mut reader).unwrap().unwrap();
        assert_eq!(frame2, "{\"id\":2}");

        let frame3 = read_frame(&mut reader).unwrap();
        assert!(frame3.is_none());
    }
}
