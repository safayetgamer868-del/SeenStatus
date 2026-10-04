# Seen Status

Shows a status line below your own messages.

- `✓ Sent` — send succeeded.
- `✓✓ Seen` — only when a compatible internal event explicitly identifies a recipient read.
- `? Unknown` — send succeeded but recipient-read state could not be determined.
- `✕ Not sent` — a supported send failure exposes a message id.

Discord normally does not expose per-message recipient read receipts, so the plugin does not fake Seen.
