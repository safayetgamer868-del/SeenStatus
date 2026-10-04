import { findByProps, findByName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { ReactNative as RN } from "@vendetta/metro/common";

/**
 * Seen Status
 * Adds a small status line below your own messages:
 *   ✓ Sent       message was successfully sent
 *   ✓✓ Seen      a compatible internal read event confirmed the recipient read it
 *   ? Unknown    the message exists but its recipient-read state cannot be determined
 *   ✕ Not sent   the send operation failed
 *
 * IMPORTANT: Discord does not normally expose recipient-side DM read receipts.
 * This plugin never treats opening a channel, typing, or a local read marker as
 * proof that the recipient read a specific message.
 */

const statusByMessage = new Map();
const unpatches = [];
let readEventAvailable = false;

const MessageActions = findByProps("sendMessage") || findByProps("sendMessage", "editMessage");
const Message = findByName("Message", false) || findByName("Message");

function setStatus(id, status) {
    if (!id) return;
    statusByMessage.set(String(id), status);
}

function patchSend() {
    if (!MessageActions?.sendMessage) return;

    unpatches.push(after("sendMessage", MessageActions, (_args, result) => {
        if (result?.then) {
            return result.then((value) => {
                const id = value?.id ?? value?.message?.id;
                if (id) {
                    setStatus(id, "sent");
                    // If no supported read event is available, the send itself is
                    // still known; read state remains unknown until a real event arrives.
                    if (!readEventAvailable) {
                        setTimeout(() => {
                            const key = String(id);
                            if (statusByMessage.get(key) === "sent") setStatus(key, "unknown");
                        }, 2500);
                    }
                }
                return value;
            }).catch((error) => {
                const localId = error?.messageId ?? error?.id;
                if (localId) setStatus(localId, "failed");
                throw error;
            });
        }

        const id = result?.id ?? result?.message?.id;
        if (id) setStatus(id, "sent");
        return result;
    }));
}

function makeStatusNode(status) {
    const labels = {
        sent: "✓ Sent",
        seen: "✓✓ Seen",
        unknown: "? Unknown",
        failed: "✕ Not sent",
    };
    const label = labels[status] || "? Unknown";
    const textColor = status === "failed" ? "#f23f42" : undefined;

    return RN.createElement(RN.Text, {
        style: {
            fontSize: 10,
            lineHeight: 14,
            opacity: 0.7,
            marginTop: 2,
            color: textColor,
        },
    }, label);
}

function appendStatus(ret, status) {
    if (!ret || !status) return ret;

    const node = makeStatusNode(status);

    // React elements are immutable-ish in normal React usage; clone instead of
    // mutating ret.props directly. This also works when the message root has
    // existing children.
    try {
        const children = ret.props?.children;
        if (Array.isArray(children)) {
            return RN.cloneElement(ret, {}, ...children, node);
        }
        if (children != null) {
            return RN.cloneElement(ret, {}, children, node);
        }
        return RN.cloneElement(ret, {}, node);
    } catch (_) {
        return ret;
    }
}

function patchMessageRenderer() {
    if (!Message) return;

    try {
        unpatches.push(after("default", Message, (_args, ret) => {
            const props = ret?.props;
            const message = props?.message;
            const id = message?.id ?? props?.id;
            if (!id) return ret;

            const status = statusByMessage.get(String(id));
            if (!status) return ret;
            return appendStatus(ret, status);
        }));
    } catch (_) {
        // Some client builds expose Message differently; leave the plugin loaded.
    }
}

function tryInstallReadHook() {
    const Dispatcher = findByProps("dispatch", "subscribe") || findByProps("dispatch");
    if (!Dispatcher?.subscribe) return;

    const candidateEvents = [
        "MESSAGE_READ_RECEIPT",
        "MESSAGE_RECIPIENT_READ",
        "MESSAGE_SEEN",
        "MESSAGE_READ",
    ];

    for (const event of candidateEvents) {
        try {
            const unsub = Dispatcher.subscribe(event, (payload) => {
                const id = payload?.messageId ?? payload?.message_id ?? payload?.id;
                const recipientRead = payload?.recipientRead === true || payload?.read === true || payload?.seen === true;
                if (id && recipientRead) {
                    readEventAvailable = true;
                    setStatus(id, "seen");
                }
            });
            if (typeof unsub === "function") {
                readEventAvailable = true;
                unpatches.push(unsub);
            }
        } catch (_) {
            // Event is not present on this client build.
        }
    }
}

export default {
    onLoad() {
        patchSend();
        tryInstallReadHook();
        patchMessageRenderer();
    },
    onUnload() {
        for (const unpatch of unpatches.splice(0)) {
            try { unpatch(); } catch (_) {}
        }
        statusByMessage.clear();
        readEventAvailable = false;
    },
};
