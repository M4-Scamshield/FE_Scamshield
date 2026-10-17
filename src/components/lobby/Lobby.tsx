import { useState } from "react";
import type { useCall } from "../../hooks/call/useCall";

export interface LobbyDefaults {
  room: string;
  name: string;
}

/** URL 의 ?room=&name= 값으로 입력칸을 미리 채운다 */
export function readLobbyDefaults(): LobbyDefaults {
  const params = new URLSearchParams(location.search);
  return {
    room: params.get("room") ?? "demo",
    name: params.get("name") ?? "",
  };
}


export function Lobby({ call, defaults }: { call: ReturnType<typeof useCall>; defaults: LobbyDefaults }) {
  const [room, setRoom] = useState(defaults.room);
  const [name, setName] = useState(defaults.name);

  return (
    <form
      className="lobby"
      onSubmit={(e) => {
        e.preventDefault();
        call.start({ room: room.trim() || "demo", name: name.trim() || "참가자" });
      }}
    >
      <h1>통화 시작하기</h1>
      <p className="sub">같은 방 이름으로 들어온 상대와 1:1로 연결됩니다.</p>
      <label htmlFor="name">내 이름</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="참가자" autoComplete="off" maxLength={20} />
      <label htmlFor="room">방 이름</label>
      <input id="room" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="demo" autoComplete="off" maxLength={64} />
      <button className="primary" type="submit">
        통화 시작
      </button>
      {call.status === "room-full" && (
        <p className="status inline" data-status={call.status} data-testid="status">
          방이 가득 찼어요
        </p>
      )}
      {call.status === "idle" && (
        <span hidden data-testid="status">
          대기
        </span>
      )}
      {call.error && <p className="error">{call.error}</p>}
    </form>
  );
}
