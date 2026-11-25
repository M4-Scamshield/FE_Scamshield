export const CHAT_MAX_LENGTH = 2000;
export const CHAT_HISTORY_LIMIT = 500;

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  receivedAt: number;
}
