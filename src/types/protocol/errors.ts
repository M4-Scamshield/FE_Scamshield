/**
 * 서버 에러 코드. 서버의 GlobalErrorCode / CallErrorCode 와 맞춘다.
 *
 * WebSocket 에러는 두 단계로 온다:
 *   1) {"type":"error","code":"CALL_001","message":"..."} 메시지
 *   2) 계속할 수 없는 에러면 4000번대 close code 로 연결 종료
 */

export interface ServerError {
  type: "error";
  code: string;
  message: string;
}

/** 서버가 연결을 끊을 때 쓰는 close code */
export const CloseCode = {
  ROOM_FULL: 4001,
  SERVER_ERROR: 1011,
} as const;

/** 화면에 보여줄 문구. 없는 코드는 서버 message 를 그대로 쓴다 */
const USER_MESSAGES: Record<string, string> = {
  CALL_001: "방이 가득 찼어요.",
  CALL_002: "방에 입장하기 전이에요. 다시 시도해 주세요.",
  CALL_003: "상대가 이미 나갔어요.",
  CALL_004: "이미 통화에 들어와 있어요.",
  GLOBAL_500: "서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
};

export function userMessage(error: Pick<ServerError, "code" | "message">): string {
  return USER_MESSAGES[error.code] ?? error.message;
}

export function isServerError(msg: { type: string }): msg is ServerError {
  return msg.type === "error";
}
