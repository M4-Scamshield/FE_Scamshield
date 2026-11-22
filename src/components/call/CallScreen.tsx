import { forwardRef, useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, MotionConfig, motion, useIsPresent } from "motion/react";
import { CameraOffIcon, HangupIcon, LinkIcon, MicIcon, MicOffIcon, PanelIcon, PeopleIcon, ShieldIcon } from "../common/icons";
import type { CallStatus, ParticipantInfo } from "../../services/webrtc/MeshClient";
import type { useCall } from "../../hooks/call/useCall";
import { useAnalysis } from "../../hooks/analysis/useAnalysis";
import { AnalysisPanel } from "../analysis/AnalysisPanel";
import { TranscriptPanel } from "../analysis/TranscriptPanel";
import { LevelTrace } from "./LevelTrace";
import { BrandLogo } from "../common/BrandLogo";
import type { UploaderState } from "../../services/analysis/PcmUploader";
import "./CallScreen.css";

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
  off: "분석 중지",
  starting: "연결 중",
  listening: "분석 중",
  degraded: "연결 끊김",
  SUSPECT: "주의 감지",
  WARN: "위험 감지",
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
  const [panelOpen, setPanelOpen] = useState(true);
  const maxPeople = joined?.maxParticipants ?? 4;
  const participantCount = (joined ? 1 : 0) + peers.length;
  const galleryColumns = Math.min(2, Math.max(1, participantCount));
  const galleryStyle = {
    "--gallery-columns": galleryColumns,
    "--gallery-rows": Math.max(1, Math.ceil(participantCount / galleryColumns)),
  } as CSSProperties;
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
    <div className="call-layout" data-watch={watch.state} data-panel-open={panelOpen}>
      <section className="meeting" aria-label="통화 공간">
        <div className="meeting-head">
          <div className="meeting-room">
            <span className="meeting-logo"><BrandLogo /></span>
            <div>
              <p className="meeting-eyebrow">SCAMSHIELD MEETING</p>
              <h1 className="room" title={call.room}>{call.room}</h1>
            </div>
          </div>
          <div className="meeting-meta">
            <span className="status" data-status={status} data-testid="status">
              <span className="connection-dot" aria-hidden />{STATUS_TEXT[status]}
            </span>
            {status === "connected" && <span className="timer">{formatTime(seconds)}</span>}
            <button
              className="panel-toggle"
              onClick={() => setPanelOpen((open) => !open)}
              aria-expanded={panelOpen}
              aria-controls="call-safety-panel"
              aria-label={panelOpen ? "보호 패널 닫기" : "보호 패널 열기"}
              title={panelOpen ? "보호 패널 닫기" : "보호 패널 열기"}
            >
              <PanelIcon />
            </button>
          </div>
        </div>

        <motion.div className="meeting-stage" layoutScroll>
          <div className="gallery-viewport">
            {participantCount > 0 ? (
              <MotionConfig reducedMotion="user" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
                <motion.ul layout className="people" data-testid="people" aria-label={`참가자 ${participantCount}명`} style={galleryStyle}>
                  <AnimatePresence initial={false} mode="popLayout">
                    {joined && (
                      <ParticipantTile
                        key={`self-${joined.self.id}`}
                        info={joined.self}
                        me
                        stream={call.micStream}
                        state={muted ? "음소거" : ""}
                        track={analysis.tracks.me}
                        muted={muted}
                      />
                    )}
                    {peers.map((p) => (
                      <ParticipantTile
                        key={`peer-${p.info.id}`}
                        info={p.info}
                        stream={p.stream}
                        state={PEER_STATE_TEXT[p.state]}
                        tone={p.state === "connected" ? "ok" : p.state === "failed" ? "bad" : "wait"}
                        color={colors.current.get(`peer-${p.info.id}`)}
                        track={analysis.tracks[`peer-${p.info.id}`]}
                      />
                    ))}
                  </AnimatePresence>
                </motion.ul>
              </MotionConfig>
            ) : <p className="meeting-wait" role="status">통화 공간에 연결하고 있어요…</p>}
          </div>
          {status === "failed" && <p className="meeting-notice">통화 연결이 끊겼어요. 네트워크 연결을 확인하고 다시 입장해 주세요.</p>}
          {error && <p className="error meeting-notice" role="alert">{error}</p>}
          {joined && participantCount === 1 && <p className="meeting-caption">아직 나만 있어요. 초대 링크를 공유해 통화를 시작하세요.</p>}
        </motion.div>

        <div className="meeting-toolbar" role="group" aria-label="통화 제어">
          <div className="toolbar-people"><PeopleIcon /><span>참가자 <strong>{participantCount}</strong><span className="capacity"> / {maxPeople}</span></span></div>
          <div className="controls">
            <button className="round" data-active={muted} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "음소거 해제" : "음소거"}>
              {muted ? <MicOffIcon /> : <MicIcon />}
              <span>{muted ? "음소거 해제" : "음소거"}</span>
            </button>
            <button className="round camera-control" disabled title="영상 통화는 준비 중이에요" aria-label="카메라 켜기 · 준비 중">
              <CameraOffIcon /><span>카메라 <small>준비 중</small></span>
            </button>
            <button className="round" onClick={copyInvite} aria-label="초대 링크 복사">
              <LinkIcon /><span aria-live="polite">{copied ? "복사 완료" : "초대하기"}</span>
            </button>
          </div>
          <button className="leave-button" onClick={hangup} aria-label="통화 나가기"><HangupIcon /><span>나가기</span></button>
        </div>
        {/* 상대마다 소리 내는 요소. 화면에는 안 보인다 */}
        {peers.map((p) => (
          <PeerAudio key={p.info.id} stream={p.stream} />
        ))}
      </section>

      <aside id="call-safety-panel" className="safety-sidebar" aria-label="ScamShield 통화 보호" hidden={!panelOpen}>
        <div className="safety-brand">
          <span className="safety-brand-name"><BrandLogo />ScamShield</span>
          <div className="watch-status" role="status" data-testid="watch">
            <span className="watch-dot" aria-hidden /><strong>{WATCH_TEXT[watch.state]}</strong>
          </div>
        </div>
        {watch.degraded && <p className="watch-warn" role="status">분석 연결이 끊겼어요 · 재연결 중</p>}
        <div className="safety-content">
          <AnalysisPanel analysis={analysis} names={names.current} />
          <TranscriptPanel
            active={analysis.status === "on"}
            lines={analysis.lines}
            names={names.current}
            colors={colors.current}
            evidence={analysis.warnings.flatMap((w) => w.evidenceSeqs ?? [])}
            analyzedTo={analysis.judged.analyzedTo}
          />
        </div>
      </aside>
    </div>
  );
}

interface ParticipantTileProps {
  info: ParticipantInfo;
  state: string;
  stream: MediaStream | null;
  track?: UploaderState;
  color?: number;
  me?: boolean;
  tone?: string;
  muted?: boolean;
}

// popLayout 이 퇴장할 카드의 위치를 보존할 수 있도록 실제 li 에 ref 를 전달한다.
const ParticipantTile = forwardRef<HTMLLIElement, ParticipantTileProps>(function ParticipantTile({
  info,
  state,
  stream,
  track,
  color,
  me = false,
  tone = "me",
  muted = false,
}, ref) {
  const present = useIsPresent();
  return (
    <motion.li
      ref={ref}
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
      className="person"
      data-tone={tone}
      data-color={color}
      data-track={track}
      data-testid={`person-${info.id}`}
      aria-hidden={!present || undefined}
      style={{ pointerEvents: present ? undefined : "none" }}
    >
      {track && <span className="participant-badge"><ShieldIcon />{TRACK_TEXT[track]}</span>}
      <motion.div layout="position" className="participant-placeholder"><span className="initial" aria-hidden>{Array.from(info.name)[0]}</span><span className="camera-caption">카메라 꺼짐</span></motion.div>
      <motion.div layout="position" className="participant-bottom">
        <span className="pname">{muted ? <MicOffIcon /> : <MicIcon />}{info.name}{me && <span className="me">(나)</span>}</span>
        <LevelTrace stream={muted ? null : stream} />
      </motion.div>
      {state && <span className="pstate">{state}</span>}
    </motion.li>
  );
});

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
