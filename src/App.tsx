import { useEffect, useRef } from "react";
import { CallScreen } from "./components/call/CallScreen";
import { Lobby, readLobbyDefaults } from "./components/lobby/Lobby";
import { useCall } from "./hooks/call/useCall";
import { BrandLogo } from "./components/common/BrandLogo";

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
    <main data-view={inCall ? "call" : "lobby"}>
      <section className={inCall ? "stage" : "card"}>
        {!inCall && <header className="lobby-brand">
          <BrandLogo />
          <span className="brand">ScamShield</span>
          <span className="tag">안심 통화</span>
        </header>}
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
    </main>
  );
}
