export const CHAT_MAX_LENGTH = 2000;
export const CHAT_HISTORY_LIMIT = 500;

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  receivedAt: number;
  /** 없으면 전체 메시지, 있으면 지정된 참가자에게만 보내는 개인 메시지. */
  recipientId?: string;
  recipientName?: string;
}
