import { useEffect, useRef } from "react";

let shared: AudioContext | null = null;

/**
 * 스트림의 실제 음성 파형을 모니터처럼 그린다. 소리가 없으면 평평한 선이다.
 * 장식이 아니라 실제 신호라서, 음소거하거나 음성이 끊기면 그대로 멈춘 선으로 보인다.
 */
export function LevelTrace({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;

    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    if (stream && stream.getAudioTracks().length > 0) {
      shared ??= new AudioContext();
      void shared.resume();
      analyser = shared.createAnalyser();
      analyser.fftSize = 1024;
      source = shared.createMediaStreamSource(stream);
      source.connect(analyser);
    }
    const samples = new Float32Array(analyser?.fftSize ?? 1024);

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      analyser?.getFloatTimeDomainData(samples);
      const mid = h / 2;
      g.clearRect(0, 0, w, h);
      g.beginPath();
      for (let i = 0; i < samples.length; i += 4) {
        const x = (i / (samples.length - 1)) * w;
        const y = mid - Math.max(-1, Math.min(1, samples[i] * 3)) * (mid - dpr);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = getComputedStyle(canvas).color;
      g.lineWidth = 1.5 * dpr;
      g.stroke();
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      source?.disconnect();
    };
  }, [stream]);

  return <canvas ref={ref} className="trace" aria-hidden />;
}
