import { findByProps, findByName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { ReactNative as RN } from "@vendetta/metro/common";

/**
 * Seen Status
 *
 * Discord does not expose a standard recipient-side per-message read receipt
 * to third-party clients. This plugin never guesses "Seen" from channel-read
 * state. It only upgrades to Seen when a compatible internal event explicitly
 * identifies one of our sent message IDs as read.
 */

const statusByMessage = new Map();
const unpatches = [];

const MessageActions = findByProps("sendMessage") || findByProps("sendMessage", "editMessage");
const Message = findByName("Message", false) || findByName("Message");

function setStatus(id, status) {
    if (!id) return;
    statusByMessage.set(id, status);
}

function patchSend() {
    if (!MessageActions?.sendMessage) return;

    unpatches.push(after("sendMessage", MessageActions, (args, result) => {
        if (result?.then) {
            return result.then((value) => {
                const id = value?.id ?? value?.message?.id;
                if (id) setStatus(String(id), "sent");
                return value;
            }).catch((error) => {
                const localId = error?.messageId ?? error?.id;
                if (localId) setStatus(String(localId), "failed");
                throw error;
            });
        }

        const id = result?.id ?? result?.message?.id;
        if (id) setStatus(String(id), "sent");
        return result;
    }));
}

function patchMessageRenderer() {
    if (!Message) return;

    unpatches.push(after("default", Message, (_args, ret) => {
        const props = ret?.props;
        const id = props?.message?.id ?? props?.id;
        const status = id ? statusByMessage.get(String(id)) : undefined;

        if (!status || !props?.children) return ret;

        const label = status === "seen" ? "✓✓ Seen" : status === "sent" ? "✓ Sent" : "✕ Not sent";
        const color = status === "failed" ? "#f23f42" : undefined;

        const StatusView = RN.Text;
        const statusNode = RN.createElement(StatusView, {
            style: { fontSize: 10, opacity: 0.65, marginTop: 2, color },
        }, label);

        if (Array.isArray(props.children)) {
            props.children = [...props.children, statusNode];
        } else {
            props.children = [props.children, statusNode];
        }

        return ret;
    }));
}

function tryInstallReadHook() {
    const Dispatcher = findByProps("dispatch", "subscribe") || findByProps("dispatch");
    if (!Dispatcher?.subscribe) return;

    const candidateEvents = ["MESSAGE_READ_RECEIPT", "MESSAGE_RECIPIENT_READ", "MESSAGE_SEEN"];
    for (const event of candidateEvents) {
        try {
            const unsub = Dispatcher.subscribe(event, (payload) => {
                const id = payload?.messageId ?? payload?.message_id ?? payload?.id;
                const recipientRead = payload?.recipientRead === true || payload?.read === true || payload?.seen === true;
                if (id && recipientRead) setStatus(String(id), "seen");
            });
            if (typeof unsub === "function") unpatches.push(unsub);
        } catch (_) {
            // Event not present on this client build.
        }
    }
}

export default {
    onLoad() {
        patchSend();
        patchMessageRenderer();
        tryInstallReadHook();
    },
    onUnload() {
        for (const unpatch of unpatches.splice(0)) {
            try { unpatch(); } catch (_) {}
        }
        statusByMessage.clear();
    },
};
                                                                 
