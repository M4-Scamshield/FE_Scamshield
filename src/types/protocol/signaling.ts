/**
 * /ws/signal 메시지 타입. 서버(BE_ScamShield)의 domain/call/dto/message 와 1:1.
 */
import type { ServerError } from "./errors";

export interface Participant {
  id: string;
  name: string;
  joinedAt: number;
}

export type SignalData = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

/** 브라우저 → 서버 */
export type ClientMessage =
  | { type: "join"; room: string; name: string }
  | { type: "signal"; to: string; data: SignalData };

/** 서버 → 브라우저 */
export type ServerMessage =
  | { type: "joined"; self: Participant; callId: string; peers: Participant[] }
  | { type: "peer-joined"; peer: Participant }
  | { type: "peer-left"; id: string }
  | { type: "signal"; from: string; data: SignalData }
  | ServerError;
