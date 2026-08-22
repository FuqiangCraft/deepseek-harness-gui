# Security Policy

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

To report a security problem, use one of the private channels:

- **GitHub Security Advisory**: open a [private security advisory](https://github.com/FuqiangCraft/deepseek-harness-gui/security/advisories/new) (recommended).
- **Direct issue**: if GitHub advisories are not available, email the maintainer and include `[SECURITY]` in the subject line. Do not include secrets or exploit details in the title.

You should receive a response within a few business days. Please include:

- the affected version(s) and platform
- a description of the vulnerability and its impact
- a minimal reproduction, if possible

## Supported Versions

The project is pre-1.0 (`v0.1.x`). Security fixes are released in the latest
version; older `v0.1.x` releases are not patched separately.

## Security Baseline

This client ships with a deliberately thin attack surface:

- **Loopback-only engine**: the embedded DSH engine binds to `127.0.0.1` on an
  OS-assigned random port and is never exposed to the network. Note: any local
  process on the same machine can connect to that port, since the web UI is
  served without an auth token.
- **No hardcoded secrets**: the bundle contains no API keys. User credentials
  are stored by the engine under the user's own home directory (`~/.dsh/`).
- **Sidecar lifecycle**: the Node.js sidecar is a child of the desktop host; on
  Windows a Job Object (`KILL_ON_JOB_CLOSE`) plus a stdin/stdout watchdog guard
  against orphaned processes.
- **Runtime integrity**: the extracted engine runtime lives under the user's own
  app-data directory. The bundled archive is SHA-256 checked on each launch
  (re-extracts when content changes), extraction refuses symlink/junction
  targets, and the runtime directory is tightened to `0700` on Unix.

## Security Considerations

- Run the latest release; the embedded engine (`@deepseek-ai/dsh*`) is under
  active development and may ship breaking changes between `0.1.x` builds.
- The loopback web server grants local processes the ability to drive the agent.
  Only run this software on machines you trust.
- Diagnostic logs are local-only, retained for at most 14 days and 100 MiB, and
  are never uploaded automatically. Diagnostic exports exclude `~/.dsh`, user
  sessions, prompts, attachments, and workspace files. Users should still
  inspect an exported archive before sharing it.
- Stable updates are accepted only after Tauri updater-signature verification.
  Platform signing is verified when maintainer certificates are configured;
  otherwise the release is explicitly identified as unsigned and Windows
  SmartScreen or macOS Gatekeeper may display a warning.
