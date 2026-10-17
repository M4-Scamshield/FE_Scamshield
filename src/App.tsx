import { useEffect, useRef } from "react";
import { CallScreen } from "./components/call/CallScreen";
import { Lobby, readLobbyDefaults } from "./components/lobby/Lobby";
import { useCall } from "./hooks/call/useCall";
import { ShieldIcon } from "./components/common/icons";

const lobbyDefaults = readLobbyDefaults();

export default function App() {
  const call = useCall();
  const logRef = useRef<HTMLOListElement>(null);
  const inCall = call.status !== "idle" && call.status !== "room-full";

  // 로그가 늘면 맨 아래로
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [call.logs]);

  return (
    <main>
      <header>
        <ShieldIcon />
        <span className="brand">ScamShield</span>
        <span className="tag">통화 프로토타입</span>
      </header>

      <section className="card">
        {inCall ? <CallScreen call={call} /> : <Lobby call={call} defaults={lobbyDefaults} />}
      </section>

      {call.logs.length > 0 && (
        <details className="logbox">
          <summary>진행 로그 ({call.logs.length})</summary>
          <ol className="log" ref={logRef}>
            {call.logs.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </details>
      )}

      <p className="hint">같은 기기에서 테스트할 때는 이어폰을 써야 하울링이 나지 않아요.</p>
    </main>
  );
}
