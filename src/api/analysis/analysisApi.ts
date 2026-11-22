/**
 * 분석 서버(파이프라인, 8081) 호출. 팀 BE 와 달리 ApiResponse 로 감싸지 않은 JSON 을 준다.
 * 참가자마다 POST /api/analysis/calls 로 토큰을 받는다. 같은 room 이면 같은 callId(분석 하나)에 붙는다.
 */

export interface AnalysisCall {
  callId: string;
  token: string;
  expiresInSeconds: number;
}

export type InputType = "LINK" | "TEXT";

/** room = 시그널링 서버가 준 통화 id. 방이 열릴 때마다 새로 발급돼서 방 이름 재사용과 섞이지 않는다 */
export async function createAnalysisCall(room: string): Promise<AnalysisCall> {
  const res = await fetch("/api/analysis/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room }),
  });
  if (res.status === 429) throw new Error("잠시 뒤 다시 시도하세요 (통화 생성이 너무 잦음)");
  if (!res.ok) throw new Error(`분석 서버 연결 실패 (HTTP ${res.status})`);
  return res.json();
}

/** 사용자가 안내(ACQUIRE)에 답한 값. replyToEvent 는 그 안내의 eventSeq */
export async function sendAnalysisInput(call: AnalysisCall, inputType: InputType, value: string, replyToEvent?: number) {
  const res = await fetch(`/api/analysis/calls/${call.callId}/inputs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${call.token}` },
    body: JSON.stringify({ inputType, value, replyToEvent }),
  });
  if (!res.ok) throw new Error(`입력 전송 실패 (HTTP ${res.status})`);
}

/** SSE 주소. EventSource 는 헤더를 못 붙여서 토큰을 쿼리로 넘긴다 */
export const analysisEventsUrl = (call: AnalysisCall) =>
  `/api/analysis/calls/${call.callId}/events?token=${encodeURIComponent(call.token)}`;

/** 음성 업로드 WebSocket 주소. 참가자(trackId)마다 하나, 다시 붙을 때 epoch 를 올린다 */
export function audioSocketUrl(call: AnalysisCall, trackId: string, epoch: number): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const q = new URLSearchParams({ callId: call.callId, token: call.token, trackId, epoch: String(epoch) });
  return `${proto}://${location.host}/ws/audio?${q}`;
}

/** AI 판단 진행 상황. analyzed_to = 판단이 끝난 마지막 발화 seq, current_score = 가장 최근 판단의 위험도(0~100) */
export interface AnalysisState {
  current_score?: number | null;
  analyzed_to?: number | null;
  /** 가장 최근 판단의 action 과 AI 근거. OBSERVE 인데 reason 이 있으면 AI 가 의심을 다시 확인해 오탐으로 본 것 */
  action?: string | null;
  reason?: string | null;
}

export async function getAnalysisState(call: AnalysisCall): Promise<AnalysisState> {
  const res = await fetch(`/api/analysis/calls/${call.callId}`, { headers: { Authorization: `Bearer ${call.token}` } });
  if (!res.ok) throw new Error(`상태 조회 실패 (HTTP ${res.status})`);
  return res.json();
}
