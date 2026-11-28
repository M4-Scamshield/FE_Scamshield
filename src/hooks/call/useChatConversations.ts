import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../../types/chat";
import type { PeerView } from "../../services/webrtc/MeshClient";

// The empty ID represents the conversation shared with every participant.
const conversationFor = (message: ChatMessage, selfId?: string) => message.recipientId === undefined
  ? "" : message.senderId === selfId ? message.recipientId : message.senderId;
const messageKey = (message: ChatMessage) => JSON.stringify([message.senderId, message.id]);

export function useChatConversations(messages: ChatMessage[], selfId: string | undefined, peers: PeerView[], open: boolean) {
  const [conversationId, setConversationId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [readMessages, setReadMessages] = useState<Set<string>>(() => new Set());
  const names = useRef(new Map<string, string>());
  const usedConversations = new Set<string>();
  for (const message of messages) {
    const id = conversationFor(message, selfId);
    if (!id) continue;
    usedConversations.add(id);
    names.current.set(id, message.senderId === selfId ? message.recipientName ?? names.current.get(id) ?? "참가자" : message.senderName);
  }
  for (const peer of peers) names.current.set(peer.info.id, peer.info.name);
  const livePeers = new Map(peers.map((peer) => [peer.info.id, peer]));
  const conversations = [...names.current].filter(([id]) => livePeers.has(id) || usedConversations.has(id) || drafts[id] || id === conversationId)
    .map(([id, name]) => ({ id, name, departed: !livePeers.has(id), ready: !!livePeers.get(id)?.chatReady }));
  const recipient = conversations.find((item) => item.id === conversationId);
  const visibleMessages = useMemo(() => messages.filter((message) => conversationFor(message, selfId) === conversationId), [messages, selfId, conversationId]);
  const unreadCounts = new Map<string, number>();
  for (const message of messages) {
    const id = conversationFor(message, selfId);
    if (message.senderId === selfId || readMessages.has(messageKey(message)) || (open && id === conversationId)) continue;
    unreadCounts.set(id, (unreadCounts.get(id) ?? 0) + 1);
  }
  const unreadCount = [...unreadCounts.values()].reduce((sum, count) => sum + count, 0);

  useEffect(() => {
    setReadMessages((previous) => {
      // Keep read markers bounded by the retained message history.
      const next = new Set<string>();
      for (const message of messages) {
        const key = messageKey(message);
        if (previous.has(key) || (open && conversationFor(message, selfId) === conversationId)) next.add(key);
      }
      return next.size === previous.size && [...next].every((key) => previous.has(key)) ? previous : next;
    });
  }, [messages, selfId, open, conversationId]);

  return {
    conversationId, setConversationId, conversations, recipient,
    messages: visibleMessages, unreadCounts, unreadCount,
    draft: drafts[conversationId] ?? "",
    setDraft: (value: string) => setDrafts((previous) => ({ ...previous, [conversationId]: value })),
  };
}
