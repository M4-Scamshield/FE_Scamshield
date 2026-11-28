import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { RiskSample } from "../../hooks/analysis/useAnalysis";

export function formatAnalysisTime(elapsedMs: number) {
  const seconds = Math.floor(elapsedMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 수신한 값만 계단선으로 표시하고 조회가 끊긴 구간은 연결하지 않는다. */
export function RiskTimeline({ samples, expanded = false }: { samples: RiskSample[]; expanded?: boolean }) {
  const figureRef = useRef<HTMLElement>(null);
  const [plotSize, setPlotSize] = useState({ width: 960, height: 250 });
  useEffect(() => {
    const figure = figureRef.current;
    if (!figure || !expanded) return;
    const observer = new ResizeObserver(() => {
      const bounds = figure.querySelector("svg")?.getBoundingClientRect();
      if (bounds?.width && bounds.height) {
        const width = Math.max(200, bounds.width);
        const height = Math.max(60, bounds.height);
        setPlotSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
      }
    });
    observer.observe(figure);
    return () => observer.disconnect();
  }, [expanded]);
  const LEFT = expanded ? 38 : 28;
  const RIGHT = expanded ? plotSize.width - 18 : 308;
  const TOP = expanded ? 20 : 12;
  const BOTTOM = expanded ? plotSize.height - 30 : 86;
  const captionId = useId();
  const [selected, setSelected] = useState<number | null>(null);
  const start = samples.length ? Math.floor(samples[0].elapsedMs / 1000) * 1000 : 0;
  const end = Math.max(start + 10000, Math.ceil((samples.at(-1)?.elapsedMs ?? 0) / 10000) * 10000);
  const x = (sample: RiskSample) => LEFT + (sample.elapsedMs - start) / (end - start) * (RIGHT - LEFT);
  const y = (sample: RiskSample) => BOTTOM - sample.score / 100 * (BOTTOM - TOP);
  const index = selected === null ? samples.length - 1 : Math.min(selected, samples.length - 1);
  const point = samples[index];
  const segments: RiskSample[][] = [];
  for (const sample of samples) {
    if (segments.at(-1)?.at(-1)?.segment !== sample.segment) segments.push([]);
    segments.at(-1)!.push(sample);
  }
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    let next: number;
    if (event.key === "ArrowLeft") next = index - 1;
    else if (event.key === "ArrowRight") next = index + 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = samples.length - 1;
    else return;
    event.preventDefault();
    setSelected(Math.max(0, Math.min(samples.length - 1, next)));
  };

  return <figure ref={figureRef} className="risk-timeline" aria-label="시간별 위험도" aria-describedby={captionId}
    tabIndex={samples.length ? 0 : undefined} onKeyDown={keyDown} onBlur={() => setSelected(null)}
    data-testid="risk-timeline" data-samples={samples.length}>
    <div className="risk-timeline-plot">
      <svg viewBox={expanded ? `0 0 ${plotSize.width} ${plotSize.height}` : "0 0 320 110"} preserveAspectRatio="none" aria-hidden="true" onPointerLeave={() => setSelected(null)}
        onPointerMove={(event) => {
          if (!samples.length) return;
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const pointerX = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()).x;
          let closest = 0;
          for (let i = 1; i < samples.length; i++) if (Math.abs(x(samples[i]) - pointerX) < Math.abs(x(samples[closest]) - pointerX)) closest = i;
          setSelected(closest);
        }}>
        {[0, 50, 100].map((score) => {
          const row = BOTTOM - score / 100 * (BOTTOM - TOP);
          return <g key={score} className="risk-chart-grid"><line x1={LEFT} x2={RIGHT} y1={row} y2={row} /><text x={LEFT - 7} y={row + 3} textAnchor="end">{score}</text></g>;
        })}
        {segments.map((segment, i) => {
          const line = segment.map((sample, j) => `${j === 0 ? `M${x(sample)},${y(sample)}` : `H${x(sample)}V${y(sample)}`}`).join(" ");
          return <g key={i} data-testid="risk-chart-segment">
            <path className="risk-chart-area" d={`${line} V${BOTTOM} H${x(segment[0])} Z`} />
            <path className="risk-chart-line" d={line} />
          </g>;
        })}
        {[start, (start + end) / 2, end].map((time, i) => <text key={i} className="risk-chart-time" x={LEFT + i * (RIGHT - LEFT) / 2} y={expanded ? plotSize.height - 6 : 105} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>{formatAnalysisTime(time)}</text>)}
        {point && <g>
          <line className="risk-chart-guide" x1={x(point)} x2={x(point)} y1={TOP} y2={BOTTOM} />
          <circle className="risk-chart-point" cx={x(point)} cy={y(point)} r="3.5" data-testid="risk-chart-point" data-score={point.score} />
        </g>}
      </svg>
      {!samples.length && <p className="risk-chart-empty"><span>분석 결과가 쌓이면 표시돼요</span></p>}
    </div>
    <figcaption id={captionId}><span>분석 시간</span>{point && <span>{formatAnalysisTime(point.elapsedMs)} · {point.score}점</span>}</figcaption>
  </figure>;
}
