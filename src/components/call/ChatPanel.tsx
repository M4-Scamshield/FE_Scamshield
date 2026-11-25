import { useEffect, useRef, useState } from "react";
import { ChatIcon, CloseIcon } from "../common/icons";
import { CHAT_MAX_LENGTH, type ChatMessage } from "../../types/chat";
import { useChatResize } from "../../hooks/call/useChatResize";
import "./ChatPanel.css";

interface ChatPanelProps {
  open: boolean;
  messages: ChatMessage[];
  selfId?: string;
  ready: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
}

const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });

export function ChatPanel({ open, messages, selfId, ready, onSend, onClose }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newMessages, setNewMessages] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const { height, resizing, separatorProps } = useChatResize(drawerRef);
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
    if (!ready || !draft.trim()) return;
    try {
      onSend(draft);
      setDraft("");
      setError(null);
      inputRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "메시지를 보내지 못했어요. 다시 시도해 주세요.");
    }
  };

  return (
    <div ref={drawerRef} id="call-chat-panel" className="chat-drawer" data-open={open} data-resizing={resizing || undefined} aria-hidden={!open} inert={!open}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "grid-template-rows" && open) {
          if (document.activeElement?.getAttribute("aria-controls") === "call-chat-panel") inputRef.current?.focus({ preventScroll: true });
          if (atBottom.current) scrollToLatest();
        }
      }}>
      <div className="chat-clip">
        <section className="call-chat" style={{ height }} aria-labelledby="call-chat-title" onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing) {
            event.stopPropagation();
            onClose();
          }
        }}>
          <div className="chat-resize-handle" {...separatorProps} title="드래그하거나 위·아래 방향키로 높이 조절"><span aria-hidden="true" /></div>
          <div className="chat-header">
            <h2 id="call-chat-title"><ChatIcon />채팅<span>모든 참가자에게</span></h2>
            <button type="button" className="chat-close" onClick={onClose} aria-label="채팅 닫기" title="채팅 닫기"><CloseIcon /></button>
          </div>
          <div className="chat-log-wrap">
            <div className="chat-log" role="log" aria-label="채팅 메시지" aria-live={open ? "polite" : "off"} aria-relevant="additions" ref={logRef} tabIndex={open ? 0 : -1}
              onScroll={(event) => {
                const log = event.currentTarget;
                atBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
                if (atBottom.current) setNewMessages(false);
              }}>
              {messages.map((message) => (
                <article key={`${message.senderId}-${message.id}`} className="chat-message" data-self={message.senderId === selfId}>
                  <div className="chat-message-meta"><strong>{message.senderName}{message.senderId === selfId ? " (나)" : ""}</strong><time dateTime={new Date(message.receivedAt).toISOString()}>{clock.format(message.receivedAt)}</time></div>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
            {newMessages && <button type="button" className="chat-latest" onClick={scrollToLatest}>새 메시지 보기</button>}
          </div>
          <form className="chat-compose" onSubmit={(event) => { event.preventDefault(); send(); }}>
            <div className="chat-input-row">
              <textarea ref={inputRef} aria-label="채팅 메시지 입력" aria-describedby="chat-input-hint" placeholder="메시지 입력" rows={2} maxLength={CHAT_MAX_LENGTH} value={draft}
                onChange={(event) => { setDraft(event.target.value); setError(null); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                    event.preventDefault();
                    send();
                  }
                }} />
              <button type="submit" className="chat-send" disabled={!ready || !draft.trim()}>전송</button>
            </div>
            <div id="chat-input-hint" className="chat-input-hint"><span>{draft.length.toLocaleString()} / {CHAT_MAX_LENGTH.toLocaleString()}</span></div>
            {error && <p className="chat-error" role="alert">{error}</p>}
          </form>
        </section>
      </div>
    </div>
  );
}
