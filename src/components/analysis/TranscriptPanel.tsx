import { useLayoutEffect, useRef } from "react";
import type { TranscriptLine } from "../../hooks/analysis/useAnalysis";

function EmptyConversationIcon() {
  return (
    <svg className="transcript-empty-icon" viewBox="0 0 80 72" fill="none" aria-hidden="true" focusable="false">
      <path className="chat-bubble" d="M20 18h34a10 10 0 0 1 10 10v18a10 10 0 0 1-10 10H34L22 66V56h-2a10 10 0 0 1-10-10V28a10 10 0 0 1 10-10Z" />
      <path className="chat-lines" d="M24 32h26M24 43h16" strokeWidth="4.5" strokeLinecap="round" />
      <path d="m66 13 5-6M73 24l5-1M57 9V4" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 통화 전사. 분석 서버가 받은 순서대로 화자 이름과 함께 쌓는다.
 * 경고의 근거가 된 발화(evidence)는 강조한다. 아래쪽을 보고 있을 때만 새 줄을 따라 내려간다.
 */
export function TranscriptPanel({
  selfId,
  selectedSpeaker,
  onSelectFilter,
  active,
  lines,
  names,
  colors,
  evidence,
  analyzedTo,
  liveTracks,
  onSelectSpeaker,
}: {
  selfId: string | undefined;
  selectedSpeaker: string | null;
  onSelectFilter: (id: string | null) => void;
  active: boolean;
  lines: TranscriptLine[];
  names: Map<string, string>;
  colors: Map<string, number>;
  evidence: number[];
  analyzedTo: number;
  liveTracks: Set<string>;
  onSelectSpeaker: (trackId: string) => void;
}) {
  const boxRef = useRef<HTMLOListElement>(null);
  const stickRef = useRef(true);
  // 퇴장한 화자도 기록이 남아 있으면 다시 선택할 수 있다.
  const speakerIds = new Set([...liveTracks, ...lines.filter((line) => line.kind === "SPEECH").map((line) => line.trackId)]);
  const activeSpeaker = selectedSpeaker !== null && speakerIds.has(selectedSpeaker) ? selectedSpeaker : null;
  const visibleLines = activeSpeaker === null ? lines : lines.filter((line) => line.kind === "SPEECH" && line.trackId === activeSpeaker);
  const selectSpeaker = (id: string | null) => {
    stickRef.current = true;
    onSelectFilter(id);
  };

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box && stickRef.current) box.scrollTop = box.scrollHeight;
  }, [visibleLines.length, activeSpeaker]);

  const onScroll = () => {
    const box = boxRef.current;
    if (box) stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  };

  const hot = new Set(evidence);

  return (
    <section className="transcript" data-testid="transcript" data-active={active}>
      <div className="transcript-head">
        <div className="transcript-filters" role="group" aria-label="대화 기록 화자 필터">
          <h2 className="panel-section-title" aria-label="대화 기록"><button type="button" aria-label="대화 기록 전체" aria-pressed={activeSpeaker === null} onClick={() => selectSpeaker(null)}>대화 기록</button></h2>
          {[...speakerIds].map((id) => <button key={id} type="button" aria-pressed={activeSpeaker === id} title={names.get(id) ?? "참가자"} onClick={() => selectSpeaker(id)}><span className="transcript-filter-name">{names.get(id) ?? "참가자"}</span>{!liveTracks.has(id) && <span className="transcript-filter-left">퇴장</span>}</button>)}
        </div>
        <span className="transcript-count">{lines.length > 0 ? `${visibleLines.length}개 발화` : active ? "실시간" : "대기 중"}</span>
      </div>
      {visibleLines.length === 0 ? (
        <p className="transcript-empty"><span><EmptyConversationIcon /><strong>{activeSpeaker === null ? "아직 기록된 대화가 없어요" : "이 참가자의 대화 기록이 없어요"}</strong>{active ? <>대화가 시작되면 화자별로<br />실시간으로 표시됩니다.</> : <>분석을 시작하면 대화 내용이<br />실시간으로 표시됩니다.</>}</span></p>
      ) : (
        <ol ref={boxRef} className="transcript-lines" onScroll={onScroll} aria-live="polite" aria-label={activeSpeaker === null ? "대화 기록" : `${names.get(activeSpeaker) ?? "참가자"} 대화 기록`} tabIndex={0}>
          {visibleLines.map((l) => {
            const selectable = hot.has(l.seq) && l.kind === "SPEECH" && liveTracks.has(l.trackId);
            const warning = hot.has(l.seq);
            const speaker = names.get(l.trackId) ?? "참가자";
            const content = <>
              <span className="speaker">
                <span className="speaker-name">{speaker}</span>
                <span className="judged" data-done={l.seq <= analyzedTo || undefined} data-warning={warning || undefined}>
                  {warning ? <><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m8 2 6 11H2L8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M8 6v3M8 11v.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>위험 신호</> : l.seq <= analyzedTo ? "AI 확인" : "AI 분석 중…"}
                </span>
              </span>
              <span className="text">{l.text}</span>
            </>;
            return (
              <li
                key={l.eventSeq}
                id={`line-${l.seq}`}
                data-speaker={l.kind === "INPUT" ? "input" : l.trackId === selfId ? "me" : "peer"}
                data-color={l.kind === "INPUT" ? undefined : colors.get(l.trackId)}
                data-evidence={hot.has(l.seq) || undefined}
                data-interactive={selectable || undefined}
              >
                {selectable ? <button
                  type="button" className="transcript-evidence"
                  aria-label={`${speaker}의 탐지된 발화: ${l.text}`}
                  onClick={() => onSelectSpeaker(l.trackId)}
                >{content}</button> : content}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
