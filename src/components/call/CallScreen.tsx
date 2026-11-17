import { useEffect, useRef, useState } from "react";
import { HangupIcon, LinkIcon, MicIcon, MicOffIcon } from "../common/icons";
import type { CallStatus, ParticipantInfo } from "../../services/webrtc/MeshClient";
import type { useCall } from "../../hooks/call/useCall";
import { useAnalysis } from "../../hooks/analysis/useAnalysis";
import { AnalysisPanel } from "../analysis/AnalysisPanel";
import { TranscriptPanel } from "../analysis/TranscriptPanel";
import { LevelTrace } from "./LevelTrace";
import type { UploaderState } from "../../services/analysis/PcmUploader";

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

type WatchState = "off" | "starting" | "listening" | "degraded" | "SUSPECT" | "WARN";

const WATCH_TEXT: Record<WatchState, string> = {
  off: "이 브라우저에서 탐지 꺼짐",
  starting: "탐지 연결 중…",
  listening: "AI가 함께 듣고 있어요",
  degraded: "분석이 끊겼어요 · 지금은 보호되지 않아요",
  SUSPECT: "의심스러운 통화예요",
  WARN: "사기 위험이 높아요",
};

const TRACK_TEXT: Record<UploaderState, string> = {
  connecting: "분석 연결 중",
  open: "AI 청취 중",
  retrying: "분석 끊김 · 재연결 중",
  stopped: "분석 꺼짐",
  rejected: "분석 거절됨",
};

/** 실제 연결 상태로만 정한다. 음성이 분석 서버에 닿고 있을 때만 listening 이다 */
function watchState(analysis: ReturnType<typeof useAnalysis>): { state: WatchState; degraded: boolean } {
  const { status, tracks, streamDown, alert } = analysis;
  if (status !== "on" && status !== "starting") return { state: "off", degraded: false };
  const states = Object.values(tracks);
  const degraded = streamDown || states.some((s) => s === "retrying" || s === "stopped" || s === "rejected");
  if (alert) return { state: alert.level, degraded };
  if (degraded) return { state: "degraded", degraded };
  return { state: states.includes("open") ? "listening" : "starting", degraded };
}

export function CallScreen({ call }: { call: ReturnType<typeof useCall> }) {
  const { status, joined, peers, muted, error, hangup, toggleMute } = call;
  const seconds = useCallTimer(status === "connected");
  const [copied, setCopied] = useState(false);
  const maxPeople = joined?.maxParticipants ?? 2;
  const analysis = useAnalysis(call.micStream, peers);
  // 전사의 trackId(me, peer-<id>) → 이름. 나간 사람의 말도 이름으로 남도록 지우지 않고 쌓는다
  const names = useRef(new Map<string, string>([["me", "나"], ["USER", "내 입력"]]));
  // 상대마다 들어온 순서로 색을 정해서 참가자 목록과 대화 기록에 같이 쓴다
  const colors = useRef(new Map<string, number>());
  if (joined) names.current.set("me", `${joined.self.name} (나)`);
  for (const p of peers) {
    const track = `peer-${p.info.id}`;
    names.current.set(track, p.info.name);
    if (!colors.current.has(track)) colors.current.set(track, colors.current.size % 3);
  }
  const watch = watchState(analysis);

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
    <div className="call-layout" data-watch={watch.state}>
      <div className="watch-frame" aria-hidden />

      <div className="watch-strip">
        <span className="watch-dot" aria-hidden />
        <div className="watch-text" role="status" data-testid="watch">
          <strong>{WATCH_TEXT[watch.state]}</strong>
          {watch.degraded && watch.state !== "degraded" && <span className="watch-warn">분석이 끊겼어요 · 재연결 중</span>}
        </div>
        <div className="watch-meta">
          <p className="room">{call.room}</p>
          <p className="status" data-status={status} data-testid="status">
            {STATUS_TEXT[status]}
            {status === "connected" && <span className="timer"> · {formatTime(seconds)}</span>}
          </p>
        </div>
      </div>

      <div className="call">
        {status === "failed" && (
          <p className="note">네트워크가 직접 연결을 막고 있을 수 있어요. TURN 서버가 필요할 수 있습니다.</p>
        )}

        <ul className="people" data-testid="people">
          {joined && (
            <PersonRow
              info={joined.self}
              me
              stream={call.micStream}
              state={muted ? "음소거" : ""}
              track={analysis.tracks.me}
            />
          )}
          {peers.map((p) => (
            <PersonRow
              key={p.info.id}
              info={p.info}
              stream={p.stream}
              state={PEER_STATE_TEXT[p.state]}
              tone={p.state === "connected" ? "ok" : p.state === "failed" ? "bad" : "wait"}
              color={colors.current.get(`peer-${p.info.id}`)}
              track={analysis.tracks[`peer-${p.info.id}`]}
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

        <AnalysisPanel analysis={analysis} names={names.current} />

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

      <TranscriptPanel
        active={analysis.status === "on"}
        lines={analysis.lines}
        names={names.current}
        colors={colors.current}
        evidence={analysis.warnings.flatMap((w) => w.evidenceSeqs ?? [])}
        analyzedTo={analysis.judged.analyzedTo}
      />
    </div>
  );
}

function PersonRow({
  info,
  state,
  stream,
  track,
  color,
  me = false,
  tone = "me",
}: {
  info: ParticipantInfo;
  state: string;
  stream: MediaStream | null;
  track?: UploaderState;
  color?: number;
  me?: boolean;
  tone?: string;
}) {
  return (
    <li className="person" data-tone={tone} data-color={color} data-track={track} data-testid={`person-${info.id}`}>
      <span className="initial" aria-hidden>{info.name.slice(0, 1)}</span>
      <span className="who">
        <span className="pname">
          {info.name}
          {me && <span className="me"> (나)</span>}
        </span>
        <span className="pstate">{[state, track && TRACK_TEXT[track]].filter(Boolean).join(" · ")}</span>
      </span>
      <LevelTrace stream={stream} />
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
