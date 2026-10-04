import { findByProps, findByName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { ReactNative as RN } from "@vendetta/metro/common";

const statusByMessage = new Map();
const unpatches = [];

const MessageActions =
  findByProps("sendMessage") ||
  findByProps("sendMessage", "editMessage");

const Message =
  findByName("Message", false) ||
  findByName("Message");

function setStatus(id, status) {
  if (!id) return;
  statusByMessage.set(String(id), status);
}

function patchSend() {
  if (!MessageActions || !MessageActions.sendMessage) return;

  unpatches.push(
    after("sendMessage", MessageActions, (args, result) => {
      if (result && typeof result.then === "function") {
        return result
          .then((value) => {
            const id = value && (value.id || (value.message && value.message.id));
            if (id) setStatus(id, "sent");
            return value;
          })
          .catch((error) => {
            const localId = error && (error.messageId || error.id);
            if (localId) setStatus(localId, "failed");
            throw error;
          });
      }

      const id = result && (result.id || (result.message && result.message.id));
      if (id) setStatus(id, "sent");
      return result;
    })
  );
}

function patchMessageRenderer() {
  if (!Message) return;

  unpatches.push(
    after("default", Message, (_args, ret) => {
      const props = ret && ret.props;
      const id = props && props.message ? props.message.id : props && props.id;
      const status = id ? statusByMessage.get(String(id)) : undefined;

      if (!status || !props || !props.children) return ret;

      const label =
        status === "seen"
          ? "✓✓ Seen"
          : status === "sent"
            ? "✓ Sent"
            : "✕ Not sent";

      const statusNode = RN.createElement(
        RN.Text,
        {
          style: {
            fontSize: 10,
            opacity: 0.65,
            marginTop: 2,
            color: status === "failed" ? "#f23f42" : undefined,
          },
        },
        label
      );

      if (Array.isArray(props.children)) {
        props.children = [...props.children, statusNode];
      } else {
        props.children = [props.children, statusNode];
      }

      return ret;
    })
  );
}

function tryInstallReadHook() {
  const Dispatcher =
    findByProps("dispatch", "subscribe") ||
    findByProps("dispatch");

  if (!Dispatcher || !Dispatcher.subscribe) return;

  const candidateEvents = [
    "MESSAGE_READ_RECEIPT",
    "MESSAGE_RECIPIENT_READ",
    "MESSAGE_SEEN",
  ];

  for (const event of candidateEvents) {
    try {
      const unsubscribe = Dispatcher.subscribe(event, (payload) => {
        const id = payload &&
          (payload.messageId || payload.message_id || payload.id);
        const recipientRead = payload &&
          (payload.recipientRead === true ||
            payload.read === true ||
            payload.seen === true);

        if (id && recipientRead) setStatus(id, "seen");
      });

      if (typeof unsubscribe === "function") {
        unpatches.push(unsubscribe);
      }
    } catch (_) {
      // Event not available on this client build.
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
      try {
        unpatch();
      } catch (_) {}
    }
    statusByMessage.clear();
  },
};
