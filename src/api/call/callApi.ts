/** 통화 설정 조회: GET /api/calls/config */
import { apiGet } from "../client";

export interface CallConfig {
  iceServers: RTCIceServer[];
  maxParticipants: number;
}

export const getCallConfig = () => apiGet<CallConfig>("/api/calls/config");
