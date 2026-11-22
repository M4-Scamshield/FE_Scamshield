import { useEffect, useState } from "react";

let sharedContext: AudioContext | null = null;
let monitors = 0;

/** 실제 입력 음량으로 발화를 감지하고, 짧은 말 사이의 공백은 이어서 표시한다. */
export function useSpeaking(stream: MediaStream | null): { speaking: boolean; level: number } {
  const [voice, setVoice] = useState({ speaking: false, level: 0 });

  useEffect(() => {
    setVoice({ speaking: false, level: 0 });
    if (!stream || !stream.getAudioTracks().some((track) => track.readyState === "live")) return;

    const context = sharedContext ??= new AudioContext();
    monitors += 1;
    void context.resume().catch(() => {});
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let active = false;
    let displayedLevel = 0;
    let lastVoiceAt = -Infinity;
    let lastSampleAt = -Infinity;
    let frame = 0;

    const sample = (now: number) => {
      frame = requestAnimationFrame(sample);
      if (now - lastSampleAt < 50) return;
      lastSampleAt = now;
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const value of samples) energy += value * value;
      const level = Math.sqrt(energy / samples.length);
      const hasLiveAudio = stream.getAudioTracks().some((track) => track.readyState === "live" && track.enabled && !track.muted);
      if (hasLiveAudio && level >= (active ? 0.012 : 0.02)) lastVoiceAt = now;
      const next = hasLiveAudio && now - lastVoiceAt < 250;
      // 작은 목소리도 보이도록 증폭하되, 밝기는 매번 측정한 음량에 맞춘다.
      const strength = next ? Math.round(Math.min(1, Math.sqrt(Math.max(0, level - 0.006) / 0.1)) * 20) / 20 : 0;
      if (next !== active || strength !== displayedLevel) {
        active = next;
        displayedLevel = strength;
        setVoice({ speaking: next, level: strength });
      }
    };
    frame = requestAnimationFrame(sample);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      monitors -= 1;
      if (monitors === 0) {
        sharedContext = null;
        void context.close().catch(() => {});
      }
    };
  }, [stream]);

  return stream !== null ? voice : { speaking: false, level: 0 };
}
