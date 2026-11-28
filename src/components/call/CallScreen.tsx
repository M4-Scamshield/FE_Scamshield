import { forwardRef, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, MotionConfig, motion, useIsPresent } from "motion/react";
import { flushSync } from "react-dom";
import { CameraIcon, CameraOffIcon, ChatIcon, HangupIcon, LinkIcon, MicIcon, MicOffIcon, PanelIcon, PeopleIcon, ShieldIcon } from "../common/icons";
import type { CallStatus, ParticipantInfo } from "../../services/webrtc/MeshClient";
import type { useCall } from "../../hooks/call/useCall";
import { useAnalysis } from "../../hooks/analysis/useAnalysis";
import { AnalysisPanel } from "../analysis/AnalysisPanel";
import { TranscriptPanel } from "../analysis/TranscriptPanel";
import { useSpeaking } from "../../hooks/call/useSpeaking";
import { useChatConversations } from "../../hooks/call/useChatConversations";
import { AnalysisGuardian } from "../common/AnalysisGuardian";
import { SoundSettings } from "./SoundSettings";
import { ChatPanel } from "./ChatPanel";
import { ParticipantSoundMenu, type SoundMenuTarget } from "./ParticipantSoundMenu";
import { DEFAULT_PEER_SOUND } from "../../hooks/call/useSoundSettings";
import type { UploaderState } from "../../services/analysis/PcmUploader";
import "./CallScreen.css";

const STATUS_TEXT: Record<CallStatus, string> = {
  idle: "대기",
  starting: "준비 중…",
  waiting: "다른 참가자를 기다리는 중",
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
  const { status, joined, peers, muted, camera, error, hangup, toggleMute, toggleCamera } = call;
  const seconds = useCallTimer(status === "connected");
  const [copied, setCopied] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [transcriptSpeaker, setTranscriptSpeaker] = useState<string | null>(null);
  const revealTranscript = () => flushSync(() => setTranscriptSpeaker(null));
  const [chatOpen, setChatOpen] = useState(false);
  const chatButtonRef = useRef<HTMLButtonElement>(null);
  const chat = useChatConversations(call.messages, joined?.self.id, peers, chatOpen);
  const unreadChatCount = chat.unreadCount;
  const closeChat = () => {
    setChatOpen(false);
    chatButtonRef.current?.focus({ preventScroll: true });
  };
  const [speakerHighlight, setSpeakerHighlight] = useState<{ trackId: string; pulse: number; scrollToTile: boolean } | null>(null);
  const [soundMenuTarget, setSoundMenuTarget] = useState<SoundMenuTarget | null>(null);
  const closeSoundMenu = useCallback(() => setSoundMenuTarget(null), []);
  const soundMenuIsMe = soundMenuTarget?.participantId === joined?.self.id;
  const soundMenuPeer = peers.find((peer) => peer.info.id === soundMenuTarget?.participantId);
  const soundMenuSetting = soundMenuPeer ? call.sound.peerSounds[soundMenuPeer.info.id] ?? DEFAULT_PEER_SOUND : DEFAULT_PEER_SOUND;

  useEffect(() => {
    if (soundMenuTarget && !soundMenuIsMe && !soundMenuPeer) closeSoundMenu();
  }, [soundMenuTarget, soundMenuIsMe, soundMenuPeer, closeSoundMenu]);
  const maxPeople = joined?.maxParticipants ?? 4;
  const participantCount = (joined ? 1 : 0) + peers.length;
  const galleryColumns = Math.min(2, Math.max(1, participantCount));
  const galleryStyle = {
    "--gallery-columns": galleryColumns,
    "--gallery-rows": Math.max(1, Math.ceil(participantCount / galleryColumns)),
  } as CSSProperties;
  const analysis = useAnalysis(call.micStream, joined);
  // 전사의 trackId = 참가자 id. 지금 방에 있는 사람만 타일 강조 대상
  const liveTracks = new Set([...(joined ? [joined.self.id] : []), ...peers.map((peer) => peer.info.id)]);
  const highlightedSpeakerIsLive = speakerHighlight !== null && liveTracks.has(speakerHighlight.trackId);

  useEffect(() => {
    if (!speakerHighlight) return;
    if (analysis.status !== "on" || !highlightedSpeakerIsLive) {
      setSpeakerHighlight(null);
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (speakerHighlight.scrollToTile) {
        document.getElementById(`participant-${speakerHighlight.trackId}`)?.scrollIntoView({
          block: "nearest", inline: "nearest",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        });
      }
    });
    const timer = setTimeout(() => setSpeakerHighlight(null), 10000);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [speakerHighlight, analysis.status, highlightedSpeakerIsLive]);

  const highlightSpeaker = (trackId: string, scrollToTile = true) => {
    if (!liveTracks.has(trackId) || analysis.status !== "on") {
      setSpeakerHighlight(null);
      return;
    }
    setSpeakerHighlight((previous) => ({ trackId, pulse: (previous?.pulse ?? 0) + 1, scrollToTile }));
  };
  // 전사의 trackId(= 참가자 id) → 이름. 나간 사람의 말도 이름으로 남도록 지우지 않고 쌓는다
  const names = useRef(new Map<string, string>([["USER", "내 입력"]]));
  // 상대마다 들어온 순서로 색을 정해서 참가자 목록과 대화 기록에 같이 쓴다
  const colors = useRef(new Map<string, number>());
  if (joined) names.current.set(joined.self.id, `${joined.self.name} (나)`);
  for (const p of peers) {
    names.current.set(p.info.id, p.info.name);
    if (!colors.current.has(p.info.id)) colors.current.set(p.info.id, colors.current.size % 3);
  }
  const watch = watchState(analysis);
  const collapsedProtectionText = watch.state === "listening" ? "ScamShield 보호 중"
    : watch.state === "WARN" ? "ScamShield 위험 감지"
    : watch.state === "SUSPECT" ? "ScamShield 주의 감지"
    : watch.state === "degraded" ? "ScamShield 재연결 중"
    : "ScamShield 연결 중";
  const showCollapsedProtection = !panelOpen && (analysis.status === "on" || analysis.status === "starting");

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
        <div className="meeting-head" data-protection-visible={showCollapsedProtection || undefined}>
          <div className="meeting-room">
            <span className="room-label" aria-hidden>회의룸</span>
            <h1 className="room" title={call.room} aria-label={`회의룸: ${call.room}`}>{call.room}</h1>
          </div>
          {showCollapsedProtection && <button
            type="button" className="protection-indicator" data-state={watch.state}
            data-testid="header-protection" aria-controls="call-safety-panel"
            aria-label={`${collapsedProtectionText} · 보호 패널 열기`}
            onClick={() => setPanelOpen(true)}
          >
            <ShieldIcon /><span role="status">{collapsedProtectionText}</span>
          </button>}
          <div className="meeting-meta">
            <span className="status" data-status={status} data-testid="status">
              <span className="connection-dot" aria-hidden />
              <span className="status-message">{STATUS_TEXT[status]}{status === "waiting" && <span className="waiting-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>}</span>
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

        <div className="meeting-stage-area">
          <motion.div className="meeting-stage" layoutScroll>
            <div className="gallery-viewport">
              {participantCount > 0 ? (
                <MotionConfig reducedMotion="user" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
                  <motion.ul layout className="people" data-speaker-warning={highlightedSpeakerIsLive || undefined} data-testid="people" aria-label={`참가자 ${participantCount}명`} style={galleryStyle}>
                    <AnimatePresence initial={false} mode="popLayout">
                      {joined && (
                        <ParticipantTile
                          key={`self-${joined.self.id}`}
                          info={joined.self}
                          me
                          stream={call.micStream}
                          track={analysis.tracks[joined.self.id]}
                          muted={muted}
                          soundMenuOpen={soundMenuIsMe && soundMenuTarget !== null}
                          onSoundMenu={setSoundMenuTarget}
                          evidencePulse={speakerHighlight?.trackId === joined.self.id ? speakerHighlight.pulse : undefined}
                          video={camera}
                        />
                      )}
                      {peers.map((p) => (
                        <ParticipantTile
                          key={`peer-${p.info.id}`}
                          info={p.info}
                          stream={p.stream}
                          state={PEER_STATE_TEXT[p.state]}
                          tone={p.state === "connected" ? "ok" : p.state === "failed" ? "bad" : "wait"}
                          color={colors.current.get(p.info.id)}
                          soundMenuOpen={soundMenuTarget?.participantId === p.info.id}
                          onSoundMenu={setSoundMenuTarget}
                          evidencePulse={speakerHighlight?.trackId === p.info.id ? speakerHighlight.pulse : undefined}
                          video={p.video}
                          muted={p.muted}
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

          <ChatPanel open={chatOpen} chat={chat} selfId={joined?.self.id} ready={call.chatReady}
            onSend={call.sendChat} onClose={closeChat} />
        </div>

        <div className="meeting-toolbar" role="group" aria-label="통화 제어">
          <div className="toolbar-people"><PeopleIcon /><span><span className="toolbar-people-label">참가자 </span><strong>{participantCount}</strong><span className="capacity"> / {maxPeople}</span></span></div>
          <div className="controls">
            <button className="round" data-active={muted} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "음소거 해제" : "음소거"} title={muted ? "음소거 해제" : "음소거"}>
              {muted ? <MicOffIcon /> : <MicIcon />}
            </button>
            <SoundSettings call={call} />
            <button className="round camera-control" onClick={toggleCamera} data-active={!!camera} aria-pressed={!!camera} aria-label={camera ? "카메라 끄기" : "카메라 켜기"} title={camera ? "카메라 끄기" : "카메라 켜기"}>
              {camera ? <CameraIcon /> : <CameraOffIcon />}
            </button>
            <button ref={chatButtonRef} type="button" className="round chat-toggle" data-active={chatOpen}
              onClick={() => setChatOpen((open) => !open)} aria-expanded={chatOpen} aria-controls="call-chat-panel"
              aria-label={chatOpen ? "채팅 닫기" : "채팅 열기"} title={chatOpen ? "채팅 닫기" : "채팅 열기"}>
              <ChatIcon />{unreadChatCount > 0 && <span className="chat-unread" aria-hidden="true">{unreadChatCount > 99 ? "99+" : unreadChatCount}</span>}
              <span className="chat-unread-announcement" role="status">{unreadChatCount > 0 ? `읽지 않은 채팅 ${unreadChatCount}개` : ""}</span>
            </button>
            <button className="round" onClick={copyInvite} data-active={copied} aria-label="초대 링크 복사" title={copied ? "복사 완료" : "초대 링크 복사"}>
              <LinkIcon /><span className="invite-feedback" role="status">{copied ? "초대 링크가 복사되었습니다" : ""}</span>
            </button>
          </div>
          <button className="leave-button" onClick={hangup} aria-label="통화 나가기"><HangupIcon /><span>나가기</span></button>
        </div>
        {/* 상대마다 소리 내는 요소. 화면에는 안 보인다 */}
        {peers.map((p) => {
          const setting = call.sound.peerSounds[p.info.id] ?? DEFAULT_PEER_SOUND;
          return <PeerAudio
            key={p.info.id} stream={p.stream}
            volume={setting.volume}
            muted={setting.muted}
          />;
        })}
      </section>

      <aside id="call-safety-panel" className="safety-sidebar" aria-label="ScamShield 통화 보호" hidden={!panelOpen}>
        {watch.degraded && <p className="watch-warn" role="status">분석 연결이 끊겼어요 · 재연결 중</p>}
        <div className="safety-content">
          <div className="analysis-scroll" role="region" aria-label="통화 분석" tabIndex={0}>
            <AnalysisPanel analysis={analysis} names={names.current} onSelectSpeaker={(trackId) => highlightSpeaker(trackId, false)} onRevealTranscript={revealTranscript}
              statusIndicator={<div className="watch-status" role="status" data-testid="watch">
                <span className="watch-dot" aria-hidden /><strong>{WATCH_TEXT[watch.state]}</strong>
              </div>}
            />
          </div>
          <TranscriptPanel
            selfId={joined?.self.id}
            selectedSpeaker={transcriptSpeaker}
            onSelectFilter={setTranscriptSpeaker}
            active={analysis.status === "on"}
            lines={analysis.lines}
            names={names.current}
            colors={colors.current}
            evidence={analysis.warnings.flatMap((w) => w.evidenceSeqs ?? [])}
            analyzedTo={analysis.judged.analyzedTo}
            liveTracks={liveTracks}
            onSelectSpeaker={highlightSpeaker}
          />
        </div>
      </aside>
      {soundMenuTarget && (soundMenuIsMe || soundMenuPeer) && <ParticipantSoundMenu
        target={soundMenuTarget} onClose={closeSoundMenu}
        label={soundMenuIsMe ? "내 마이크" : soundMenuPeer!.info.name}
        value={soundMenuIsMe ? call.sound.microphoneVolume : soundMenuSetting.volume}
        max={soundMenuIsMe ? 2 : 1}
        muted={soundMenuIsMe ? muted : soundMenuSetting.muted}
        microphone={soundMenuIsMe}
        onChange={soundMenuIsMe ? call.sound.setMicrophoneVolume : (volume) => call.sound.setPeerVolume(soundMenuPeer!.info.id, volume)}
        onToggleMute={soundMenuIsMe ? toggleMute : () => call.sound.togglePeerMute(soundMenuPeer!.info.id)}
      />}
    </div>
  );
}

interface ParticipantTileProps {
  info: ParticipantInfo;
  state?: string;
  stream: MediaStream | null;
  track?: UploaderState;
  color?: number;
  me?: boolean;
  tone?: string;
  muted?: boolean;
  soundMenuOpen: boolean;
  onSoundMenu: (target: SoundMenuTarget) => void;
  evidencePulse?: number;
  video?: MediaStream | null;
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
  soundMenuOpen,
  onSoundMenu,
  evidencePulse,
  video = null,
}, ref) {
  const present = useIsPresent();
  const voice = useSpeaking(present && !muted ? stream : null);
  return (
    <motion.li
      ref={ref}
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
      className="person"
      id={`participant-${info.id}`}
      data-tone={tone}
      data-color={color}
      data-track={track}
      data-speaking={voice.speaking || undefined}
      data-evidence-active={evidencePulse !== undefined || undefined}
      data-testid={`person-${info.id}`}
      data-video={video ? "on" : undefined}
      data-muted={muted || undefined}
      aria-hidden={!present || undefined}
      tabIndex={present ? 0 : -1}
      aria-label={`${info.name}${me ? " (나)" : ""} 사운드 설정`}
      aria-haspopup="dialog"
      aria-expanded={soundMenuOpen}
      aria-controls={soundMenuOpen ? "participant-sound-menu" : undefined}
      onContextMenu={(event) => {
        if (!present) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        onSoundMenu({
          participantId: info.id,
          x: Number.isFinite(event.clientX) ? event.clientX : bounds.left + bounds.width / 2,
          y: Number.isFinite(event.clientY) ? event.clientY : bounds.top + bounds.height / 2,
          trigger: event.currentTarget,
        });
      }}
      onKeyDown={(event) => {
        if (!present || (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        onSoundMenu({ participantId: info.id, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, trigger: event.currentTarget });
      }}
      style={{ pointerEvents: present ? undefined : "none", "--voice-level": voice.level } as CSSProperties}
    >
      <div className="participant-surface">
        {video && <TileVideo stream={video} mirror={me} />}
        {evidencePulse !== undefined && <span key={evidencePulse} className="speaker-warning-highlight" aria-hidden />}
        {track && <span className="participant-badge"><ShieldIcon />{TRACK_TEXT[track]}</span>}
        <motion.div layout="position" className="participant-placeholder"><span className="initial" aria-hidden>{Array.from(info.name)[0]}</span><span className="camera-caption">카메라 꺼짐</span></motion.div>
        <motion.div layout="position" className="participant-bottom">
          <span className="pname">{muted ? <MicOffIcon /> : <MicIcon />}<span className="participant-name" title={info.name}>{info.name}</span>{me && <span className="me">(나)</span>}</span>
        </motion.div>
        {state && <span className="pstate">{state}</span>}
      </div>
      {evidencePulse !== undefined && <div key={`warning-${evidencePulse}`} className="speaker-warning-guide" role="status" aria-atomic="true">
        <AnalysisGuardian state="warning" />
        <div className="speaker-warning-speech">
          <span className="speaker-warning-name" title={info.name}>{info.name}{me ? " (나)" : ""}</span>
          <strong>위험 인물입니다.</strong>
          <span>주의하세요!</span>
        </div>
      </div>}
    </motion.li>
  );
});

/** 타일을 꽉 채우는 영상. 소리는 PeerAudio 가 내므로 여기선 끈다. 내 화면은 거울처럼 좌우 반전 */
function TileVideo({ stream, mirror }: { stream: MediaStream; mirror: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
  }, [stream]);
  return <video ref={ref} className="participant-video" data-mirror={mirror || undefined} autoPlay playsInline muted />;
}

function PeerAudio({ stream, volume, muted }: { stream: MediaStream | null; volume: number; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.srcObject = stream;
    if (stream) audio.play().catch(() => {});
    return () => {
      audio.pause();
      audio.srcObject = null;
    };
  }, [stream]);
  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);
  return <audio ref={ref} autoPlay muted={muted} />;
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
