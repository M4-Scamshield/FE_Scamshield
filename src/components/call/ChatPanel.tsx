import { useEffect, useRef, useState } from "react";
import { ChatIcon, CloseIcon } from "../common/icons";
import { CHAT_MAX_LENGTH, type ChatMessage } from "../../types/chat";
import { useChatWindow } from "../../hooks/call/useChatWindow";
import type { PeerView } from "../../services/webrtc/MeshClient";
import "./ChatPanel.css";

interface ChatPanelProps {
  open: boolean;
  messages: ChatMessage[];
  selfId?: string;
  peers: PeerView[];
  ready: boolean;
  onSend: (text: string, recipientId?: string) => void;
  onClose: () => void;
}

const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });

export function ChatPanel({ open, messages, selfId, peers, ready, onSend, onClose }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newMessages, setNewMessages] = useState(false);
  const [recipient, setRecipient] = useState<{ id: string; name: string } | null>(null);
  const selectedPeer = recipient ? peers.find((peer) => peer.info.id === recipient.id) : undefined;
  const canSend = recipient ? !!selectedPeer?.chatReady : ready;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { rect, interacting, moveProps, resizeProps } = useChatWindow(panelRef, open);
  const atBottom = useRef(true);

  const scrollToLatest = () => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
    atBottom.current = true;
    setNewMessages(false);
  };

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
        scrollToLatest();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (atBottom.current || messages.at(-1)?.senderId === selfId) scrollToLatest();
    else setNewMessages(true);
  }, [messages, open, selfId]);

  const send = () => {
    if (!draft.trim()) return;
    if (!canSend) {
      setError(recipient && !selectedPeer ? "선택한 참가자가 통화를 나갔어요. 받는 사람을 다시 선택해 주세요." : "참가자와 채팅 연결을 기다리고 있어요. 잠시 후 다시 보내 주세요.");
      return;
    }
    try {
      onSend(draft, recipient?.id);
      setDraft("");
      setError(null);
      inputRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "메시지를 보내지 못했어요. 다시 시도해 주세요.");
    }
  };

  return (
    <div ref={panelRef} id="call-chat-panel" className="chat-window" data-open={open} data-interacting={interacting || undefined}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} aria-hidden={!open} inert={!open}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || event.propertyName !== "opacity" || !open) return;
        if (document.activeElement?.getAttribute("aria-controls") === "call-chat-panel") inputRef.current?.focus({ preventScroll: true });
        if (atBottom.current) scrollToLatest();
      }}>
      <section className="call-chat" role="dialog" aria-modal="false" aria-labelledby="call-chat-title" onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.stopPropagation();
          onClose();
        }
      }}>
        <div className="chat-header">
          <button type="button" className="chat-move" aria-label="채팅창 이동" title="드래그하거나 방향키로 이동" {...moveProps}>
            <ChatIcon /><span id="call-chat-title">채팅</span>
          </button>
          <button type="button" className="chat-close" onClick={onClose} aria-label="채팅 닫기" title="채팅 닫기"><CloseIcon /></button>
        </div>
        <div className="chat-recipient-row">
          <select className="chat-recipient" aria-label="채팅 받는 사람" value={recipient?.id ?? ""}
            onChange={(event) => {
              const peer = peers.find((item) => item.info.id === event.target.value);
              setRecipient(peer ? { id: peer.info.id, name: peer.info.name } : null);
              setError(null);
            }}>
            <option value="">모든 참가자</option>
            {peers.map((peer, index) => <option key={peer.info.id} value={peer.info.id}>{peer.info.name}{peers.filter((item) => item.info.name === peer.info.name).length > 1 ? ` (${peers.slice(0, index + 1).filter((item) => item.info.name === peer.info.name).length})` : ""}</option>)}
            {recipient && !selectedPeer && <option value={recipient.id} disabled>{recipient.name} (퇴장)</option>}
          </select>
        </div>
        <div className="chat-log-wrap">
          <div className="chat-log" role="log" aria-label="채팅 메시지" aria-live={open ? "polite" : "off"} aria-relevant="additions" ref={logRef} tabIndex={open ? 0 : -1}
            onScroll={(event) => {
              const log = event.currentTarget;
              atBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
              if (atBottom.current) setNewMessages(false);
            }}>
            {messages.length === 0 && <div className="chat-empty"><ChatIcon /><p>메시지로 대화를 나눠보세요</p></div>}
            {messages.map((message) => (
              <article key={`${message.senderId}-${message.id}`} className="chat-message" data-self={message.senderId === selfId} data-private={message.recipientId !== undefined || undefined}>
                <div className="chat-message-meta"><strong>{message.senderName}{message.senderId === selfId ? " (나)" : ""}</strong>
                  <span className="chat-audience">{message.recipientId !== undefined ? (message.senderId === selfId ? `${message.recipientName ?? "참가자"}에게` : "나에게") : "전체"}</span>
                  <time dateTime={new Date(message.receivedAt).toISOString()}>{clock.format(message.receivedAt)}</time></div>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
          {newMessages && <button type="button" className="chat-latest" onClick={scrollToLatest}>새 메시지 보기</button>}
        </div>
        <form className="chat-compose" onSubmit={(event) => { event.preventDefault(); send(); }}>
          <div className="chat-input-row">
            <textarea ref={inputRef} aria-label="채팅 메시지 입력" placeholder="메시지 입력" rows={2} maxLength={CHAT_MAX_LENGTH} value={draft}
              onChange={(event) => { setDraft(event.target.value); setError(null); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault();
                  send();
                }
              }} />
            <button type="submit" className="chat-send" disabled={!canSend || !draft.trim()}>전송</button>
          </div>
          {error && <p className="chat-error" role="alert">{error}</p>}
        </form>
        <button type="button" className="chat-resize-corner" data-corner="top-left" aria-label="채팅창 크기 조절 (왼쪽 위)" title="드래그하거나 방향키로 크기 조절" {...resizeProps("top-left")} />
        <button type="button" className="chat-resize-corner" data-corner="bottom-right" aria-label="채팅창 크기 조절 (오른쪽 아래)" title="드래그하거나 방향키로 크기 조절" {...resizeProps("bottom-right")} />
      </section>
    </div>
  );
}
