/**
 * WebRTC 음성 통화 클라이언트 (React 와 무관한 순수 TS).
 *
 * - 시그널링: 서버의 /ws/signal 로 받는 사람을 지정해 SDP / ICE 를 주고받는다
 * - 음성: 상대마다 RTCPeerConnection 을 만들어 브라우저끼리 직접 주고받는다
 *   (지금은 1:1 이라 연결 하나. 정원은 서버 설정을 따른다)
 *
 * 누가 offer 를 만들지: 참가자 ID 를 비교해 작은 쪽(impolite)이 처음 offer 를 만든다.
 * 이후 재협상이 겹치면 MDN 의 perfect negotiation 규칙으로 정리한다.
 */

import { getCallConfig } from "../../api/call/callApi";
import { CloseCode, userMessage } from "../../types/protocol/errors";
import type {
  ClientMessage,
  Participant as ParticipantInfo,
  ServerMessage,
  SignalData,
} from "../../types/protocol/signaling";

export type { ParticipantInfo };

export type CallStatus =
  | "idle" // 시작 전 / 종료됨
  | "starting" // 마이크·서버 연결 중
  | "waiting" // 방에 나 혼자
  | "connecting" // 상대와 연결 협상 중
  | "connected" // 통화 중
  | "failed" // 연결 실패
  | "room-full"; // 정원 초과

export interface PeerView {
  info: ParticipantInfo;
  state: RTCPeerConnectionState;
  stream: MediaStream | null;
}

export interface JoinedInfo {
  self: ParticipantInfo;
  callId: string;
  maxParticipants: number;
}

export interface MeshEvents {
  onStatus: (status: CallStatus) => void;
  onJoined: (info: JoinedInfo) => void;
  onPeers: (peers: PeerView[]) => void;
  /** 서버가 보낸 에러 (화면에 보여줄 문구) */
  onError: (message: string) => void;
  onLog: (line: string) => void;
}

interface Peer {
  info: ParticipantInfo;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingAnswer: boolean;
  pendingIce: RTCIceCandidateInit[];
  /** 이 상대의 SDP/ICE 처리를 순서대로 (상대끼리는 독립) */
  chain: Promise<void>;
  remote: MediaStream | null;
  restarts: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
}

const FALLBACK_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const FALLBACK_MAX = 2;

export class MeshClient {
  private ws: WebSocket | null = null;
  private localStream: MediaStream | null = null;
  private iceServers: RTCIceServer[] = FALLBACK_ICE;
  private maxParticipants = FALLBACK_MAX;
  private selfId = "";
  private readonly peers = new Map<string, Peer>();
  private closed = false;

  constructor(
    private readonly room: string,
    private readonly name: string,
    private readonly events: MeshEvents,
  ) {}

  /** 반드시 버튼 클릭 같은 사용자 동작 안에서 호출 (마이크 권한·자동재생 정책) */
  async start(): Promise<void> {
    this.events.onStatus("starting");

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.log("마이크 켜짐");
    if (this.closed) return this.releaseMic();

    try {
      const config = await getCallConfig();
      this.iceServers = config.iceServers;
      this.maxParticipants = config.maxParticipants;
    } catch (e) {
      this.log(`서버 설정을 못 받아 기본값 사용: ${e instanceof Error ? e.message : e}`);
    }
    if (this.closed) return this.releaseMic();

    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws/signal`);
    this.ws = ws;
    ws.onopen = () => {
      this.sendToServer({ type: "join", room: this.room, name: this.name });
    };
    ws.onmessage = (e) => this.onServer(JSON.parse(e.data));
    ws.onclose = (e) => {
      if (this.closed) return;
      if (e.code === CloseCode.ROOM_FULL) {
        this.events.onStatus("room-full");
        this.hangup(true);
        return;
      }
      this.log(`시그널링 연결 끊김 (code ${e.code})`);
      this.hangup();
    };
  }

  hangup(keepStatus = false): void {
    if (this.closed) return;
    this.closed = true;
    this.ws?.close();
    for (const id of [...this.peers.keys()]) this.removePeer(id, false);
    this.releaseMic();
    if (!keepStatus) this.events.onStatus("idle");
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  /** 디버깅용: 콘솔에서 __call.connections 로 상대별 연결을 볼 수 있다 */
  get connections(): Record<string, RTCPeerConnection> {
    return Object.fromEntries([...this.peers].map(([id, p]) => [id, p.pc]));
  }

  // ------------------------------------------------------------ signaling

  private onServer(msg: ServerMessage): void {
    switch (msg.type) {
      case "joined":
        this.selfId = msg.self.id;
        this.log(`방 "${this.room}" 입장 (나: ${msg.self.id}, 기존 ${msg.peers.length}명)`);
        this.events.onJoined({ self: msg.self, callId: msg.callId, maxParticipants: this.maxParticipants });
        msg.peers.forEach((p) => this.addPeer(p));
        this.emitPeers();
        break;
      case "peer-joined":
        this.log(`${msg.peer.name} 입장`);
        this.addPeer(msg.peer);
        this.emitPeers();
        break;
      case "peer-left": {
        const name = this.peers.get(msg.id)?.info.name ?? msg.id;
        this.log(`${name} 퇴장`);
        this.removePeer(msg.id, true);
        break;
      }
      case "signal":
        this.receive(msg.from, msg.data);
        break;
      case "error":
        // 계속할 수 없는 에러(정원 초과 등)는 서버가 이어서 연결을 끊는다 → onclose 에서 처리
        this.log(`서버 오류 ${msg.code}: ${msg.message}`);
        if (msg.code !== "CALL_001") this.events.onError(userMessage(msg));
        break;
    }
  }

  private sendToServer(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private send(to: string, data: SignalData): void {
    this.sendToServer({ type: "signal", to, data });
  }

  // --------------------------------------------------------------- WebRTC

  private addPeer(info: ParticipantInfo): void {
    if (this.peers.has(info.id)) return;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = {
      info,
      pc,
      // ID 가 큰 쪽이 polite(양보), 작은 쪽이 처음 offer 를 만든다
      polite: this.selfId > info.id,
      makingOffer: false,
      ignoreOffer: false,
      settingAnswer: false,
      pendingIce: [],
      chain: Promise.resolve(),
      remote: null,
      restarts: 0,
      restartTimer: null,
    };
    this.peers.set(info.id, peer);

    // 내 마이크를 이 연결에 싣는다
    this.localStream!.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send(info.id, { candidate: candidate.toJSON() });
    };

    pc.ontrack = ({ track, streams }) => {
      peer.remote = streams[0] ?? new MediaStream([track]);
      this.log(`${info.name} 음성 수신`);
      this.emitPeers();
    };

    pc.onnegotiationneeded = async () => {
      // 첫 offer 는 impolite 쪽만. 이후 재협상(ICE restart 등)은 양쪽 모두 가능
      if (!pc.localDescription && !pc.remoteDescription && peer.polite) return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.send(info.id, { description: pc.localDescription!.toJSON() });
      } catch (e) {
        if (pc.signalingState !== "closed") this.log(`${info.name} offer 실패: ${e}`);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.peers.get(info.id) !== peer) return;
      this.log(`${info.name}: ${pc.connectionState}`);
      if (pc.connectionState === "connected") {
        peer.restarts = 0;
        if (peer.restartTimer) clearTimeout(peer.restartTimer);
        peer.restartTimer = null;
      }
      // 끊기면 ICE restart 로 최대 3번 다시 시도
      if ((pc.connectionState === "disconnected" || pc.connectionState === "failed") && !peer.restartTimer) {
        peer.restartTimer = setTimeout(
          () => {
            peer.restartTimer = null;
            if (!["connected", "closed"].includes(pc.connectionState) && peer.restarts < 3) {
              peer.restarts++;
              this.log(`${info.name}: 재연결 시도 ${peer.restarts}`);
              pc.restartIce();
            }
          },
          pc.connectionState === "failed" ? 500 : 4000,
        );
      }
      this.emitPeers();
    };
  }

  private receive(from: string, data: SignalData): void {
    const peer = this.peers.get(from);
    if (!peer) return;
    peer.chain = peer.chain
      .then(async () => {
        const { pc } = peer;
        if (pc.signalingState === "closed") return;
        if (data.description) {
          const desc = data.description;
          const ready = !peer.makingOffer && (pc.signalingState === "stable" || peer.settingAnswer);
          const collision = desc.type === "offer" && !ready;
          peer.ignoreOffer = !peer.polite && collision;
          if (peer.ignoreOffer) return;
          peer.settingAnswer = desc.type === "answer";
          try {
            await pc.setRemoteDescription(desc);
          } finally {
            peer.settingAnswer = false;
          }
          // remoteDescription 전에 도착한 ICE 후보 처리
          for (const c of peer.pendingIce.splice(0)) await pc.addIceCandidate(c);
          if (desc.type === "offer") {
            await pc.setLocalDescription();
            this.send(from, { description: pc.localDescription!.toJSON() });
          }
        } else if (data.candidate && !peer.ignoreOffer) {
          if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
          else peer.pendingIce.push(data.candidate);
        }
      })
      .catch((e) => {
        if (peer.pc.signalingState !== "closed" && !peer.ignoreOffer) this.log(`${peer.info.name} 협상 오류: ${e}`);
      });
  }

  private removePeer(id: string, emit: boolean): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (peer.restartTimer) clearTimeout(peer.restartTimer);
    peer.pc.onicecandidate = peer.pc.ontrack = peer.pc.onnegotiationneeded = peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    this.peers.delete(id);
    if (emit) this.emitPeers();
  }

  private emitPeers(): void {
    const list = [...this.peers.values()].map<PeerView>((p) => ({
      info: p.info,
      state: p.pc.connectionState,
      stream: p.remote,
    }));
    this.events.onPeers(list);
    this.events.onStatus(overallStatus(list));
  }

  private releaseMic(): void {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }

  private log(line: string): void {
    this.events.onLog(line);
  }
}

function overallStatus(peers: PeerView[]): CallStatus {
  if (peers.length === 0) return "waiting";
  if (peers.some((p) => p.state === "connected")) return "connected";
  if (peers.every((p) => p.state === "failed")) return "failed";
  return "connecting";
}
