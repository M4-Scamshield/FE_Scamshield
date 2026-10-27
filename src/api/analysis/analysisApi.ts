/**
 * 분석 서버(파이프라인, 8081) 호출. 팀 BE 와 달리 ApiResponse 로 감싸지 않은 JSON 을 준다.
 * 통화마다 POST /api/analysis/calls 로 callId·토큰을 받고, 이후 요청은 그 토큰으로 한다.
 */

export interface AnalysisCall {
  callId: string;
  token: string;
  expiresInSeconds: number;
}

export type InputType = "LINK" | "TEXT";

export async function createAnalysisCall(): Promise<AnalysisCall> {
  const res = await fetch("/api/analysis/calls", { method: "POST" });
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

/** 음성 업로드 WebSocket 주소. 화자(trackId)마다 하나, 다시 붙을 때 epoch 를 올린다 */
export function audioSocketUrl(call: AnalysisCall, trackId: string, epoch: number): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const q = new URLSearchParams({ callId: call.callId, token: call.token, trackId, epoch: String(epoch) });
  return `${proto}://${location.host}/ws/audio?${q}`;
}
