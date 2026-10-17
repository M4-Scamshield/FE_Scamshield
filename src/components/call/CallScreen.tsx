import { useEffect, useRef, useState } from "react";
import { HangupIcon, LinkIcon, MicIcon, MicOffIcon } from "../common/icons";
import type { CallStatus, ParticipantInfo } from "../../services/webrtc/MeshClient";
import type { useCall } from "../../hooks/call/useCall";

const STATUS_TEXT: Record<CallStatus, string> = {
  idle: "대기",
  starting: "준비 중…",
  waiting: "다른 참가자를 기다리는 중…",
  connecting: "연결 중…",
  connected: "통화 중",
  failed: "연결 실패",
  "room-full": "방이 가득 찼어요",
};

const PEER_STATE_TEXT: Record<RTCPeerConnectionState, string> = {
  new: "연결 준비",
  connecting: "연결 중",
  connected: "연결됨",
  disconnected: "끊김 · 재연결 중",
  failed: "연결 실패",
  closed: "종료",
};

export function CallScreen({ call }: { call: ReturnType<typeof useCall> }) {
  const { status, joined, peers, muted, error, hangup, toggleMute } = call;
  const seconds = useCallTimer(status === "connected");
  const [copied, setCopied] = useState(false);
  const maxPeople = joined?.maxParticipants ?? 2;

  const copyInvite = async () => {
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(call.room)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("이 주소를 복사해서 상대에게 보내세요", url);
    }
  };

  return (
    <div className="call">
      <p className="room">{call.room}</p>
      <p className="status" data-status={status} data-testid="status">
        {STATUS_TEXT[status]}
        {status === "connected" && <span className="timer"> · {formatTime(seconds)}</span>}
      </p>
      {status === "failed" && (
        <p className="note">네트워크가 직접 연결을 막고 있을 수 있어요. TURN 서버가 필요할 수 있습니다.</p>
      )}

      <ul className="people" data-testid="people">
        {joined && <PersonRow info={joined.self} me state={muted ? "음소거" : ""} />}
        {peers.map((p) => (
          <PersonRow
            key={p.info.id}
            info={p.info}
            state={PEER_STATE_TEXT[p.state]}
            tone={p.state === "connected" ? "ok" : p.state === "failed" ? "bad" : "wait"}
          />
        ))}
        {joined &&
          Array.from({ length: Math.max(0, maxPeople - 1 - peers.length) }, (_, i) => (
            <li key={`empty-${i}`} className="empty">
              빈 자리
            </li>
          ))}
      </ul>

      {error && <p className="error">{error}</p>}

      <div className="controls">
        <button className="round" data-active={muted} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "음소거 해제" : "음소거"}>
          {muted ? <MicOffIcon /> : <MicIcon />}
          <span>{muted ? "음소거됨" : "음소거"}</span>
        </button>
        <button className="round hangup" onClick={hangup} aria-label="끊기">
          <HangupIcon />
          <span>끊기</span>
        </button>
        <button className="round" onClick={copyInvite} aria-label="초대 링크 복사">
          <LinkIcon />
          <span>{copied ? "복사됨" : "초대 링크"}</span>
        </button>
      </div>

      {/* 상대마다 소리 내는 요소. 화면에는 안 보인다 */}
      {peers.map((p) => (
        <PeerAudio key={p.info.id} stream={p.stream} />
      ))}
    </div>
  );
}

function PersonRow({
  info,
  state,
  me = false,
  tone = "me",
}: {
  info: ParticipantInfo;
  state: string;
  me?: boolean;
  tone?: string;
}) {
  return (
    <li className="person" data-tone={tone} data-testid={`person-${info.id}`}>
      <span className="initial" aria-hidden>{info.name.slice(0, 1)}</span>
      <span className="who">
        <span className="pname">
          {info.name}
          {me && <span className="me"> (나)</span>}
        </span>
      </span>
      <span className="pstate">{state}</span>
    </li>
  );
}

function PeerAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.srcObject = stream;
    if (stream) audio.play().catch(() => {});
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

/** 통화가 연결된 동안 흐른 시간(초) */
function useCallTimer(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    setSeconds(0);
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [running]);
  return seconds;
}

function formatTime(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
