import { findByProps, findByName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { ReactNative as RN } from "@vendetta/metro/common";

const statusByMessage = new Map();
const unpatches = [];

function safeFindProps(...props) {
    try { return findByProps(...props); } catch (_) { return null; }
}

function safeFindName(name) {
    try { return findByName(name, false) || findByName(name); } catch (_) { return null; }
}

function setStatus(id, status) {
    if (id != null) statusByMessage.set(String(id), status);
}

function patchSend() {
    try {
        const actions = safeFindProps("sendMessage") || safeFindProps("sendMessage", "editMessage");
        if (!actions?.sendMessage) return;

        const patch = after("sendMessage", actions, (_args, result) => {
            try {
                if (result?.then) {
                    return result.then((value) => {
                        const id = value?.id ?? value?.message?.id;
                        if (id != null) setStatus(id, "sent");
                        return value;
                    }).catch((error) => {
                        const id = error?.messageId ?? error?.id;
                        if (id != null) setStatus(id, "failed");
                        throw error;
                    });
                }
                const id = result?.id ?? result?.message?.id;
                if (id != null) setStatus(id, "sent");
            } catch (_) {}
            return result;
        });
        if (typeof patch === "function") unpatches.push(patch);
    } catch (_) {}
}

function patchReadEvents() {
    try {
        const dispatcher = safeFindProps("dispatch", "subscribe") || safeFindProps("dispatch");
        if (!dispatcher?.subscribe) return;

        // IMPORTANT: subscribing is not evidence of a read. Seen is set ONLY
        // when the payload explicitly identifies a recipient-read receipt.
        const events = [
            "MESSAGE_READ_RECEIPT",
            "MESSAGE_RECIPIENT_READ",
            "MESSAGE_SEEN",
            "MESSAGE_READ",
        ];

        for (const event of events) {
            try {
                const unsub = dispatcher.subscribe(event, (payload) => {
                    try {
                        const id = payload?.messageId
                            ?? payload?.message_id
                            ?? payload?.message?.id;
                        const explicitRead = payload?.recipientRead === true
                            || payload?.recipient_read === true
                            || payload?.recipientHasRead === true
                            || payload?.recipient_has_read === true
                            || payload?.readReceipt === true
                            || payload?.read_receipt === true;
                        if (id != null && explicitRead) setStatus(id, "seen");
                    } catch (_) {}
                });
                if (typeof unsub === "function") unpatches.push(unsub);
            } catch (_) {}
        }
    } catch (_) {}
}

function makeStatus(status) {
    const labels = {
        sent: "✓ Sent",
        seen: "✓✓ Seen",
        unknown: "? Unknown",
        failed: "✕ Not sent",
    };
    try {
        return RN.createElement(RN.Text, {
            style: {
                fontSize: 10,
                lineHeight: 14,
                opacity: 0.7,
                marginTop: 2,
                color: status === "failed" ? "#f23f42" : undefined,
            },
        }, labels[status] || "? Unknown");
    } catch (_) {
        return null;
    }
}

function patchMessageRenderer() {
    try {
        const Message = safeFindName("Message");
        if (!Message) return;

        const patch = after("default", Message, (_args, ret) => {
            try {
                const message = ret?.props?.message;
                const id = message?.id ?? ret?.props?.id;
                if (id == null) return ret;

                // Do not show status on other people's messages.
                // Different Discord builds expose different self markers.
                const own = message?.isAuthor === true || message?.isMe === true;
                if (!own) return ret;

                const status = statusByMessage.get(String(id));
                if (!status || !ret?.props) return ret;

                const node = makeStatus(status);
                if (!node || typeof RN.cloneElement !== "function") return ret;

                const children = ret.props.children;
                if (Array.isArray(children)) return RN.cloneElement(ret, {}, ...children, node);
                if (children != null) return RN.cloneElement(ret, {}, children, node);
                return RN.cloneElement(ret, {}, node);
            } catch (_) {
                return ret;
            }
        });
        if (typeof patch === "function") unpatches.push(patch);
    } catch (_) {}
}

export default {
    onLoad() {
        // Every subsystem is isolated so an unsupported internal API cannot
        // make the plugin toggle immediately back off.
        patchSend();
        patchReadEvents();
        patchMessageRenderer();
    },
    onUnload() {
        for (const unpatch of unpatches.splice(0)) {
            try { unpatch(); } catch (_) {}
        }
        statusByMessage.clear();
    },
};
