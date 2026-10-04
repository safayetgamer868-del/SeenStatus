# Seen Status

Toggle-safe ShiggyCord/Vendetta-family plugin.

Statuses:
- ✓ Sent — confirmed send result.
- ✓✓ Seen — ONLY an explicit recipient-read event can set this.
- ? Unknown — read state is not available/detectable.
- ✕ Not sent — supported send failure.

No channel-open, typing, online state, local read marker, timeout, or message visibility is treated as proof of Seen.

If the client exposes no genuine recipient-read event, Seen will never appear.
