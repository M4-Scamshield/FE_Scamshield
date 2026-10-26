import { audioSocketUrl, type AnalysisCall } from "../../api/analysis/analysisApi";

/**
 * 오디오 스트림 하나(= 화자 하나)를 PCM16 mono 16kHz 로 바꿔 분석 서버에 올린다.
 * AudioContext 를 16kHz 로 만들면 브라우저가 리샘플링해 준다. 100ms(1600 샘플)씩 묶어 보낸다.
 * 끊기면 epoch 를 올려 다시 붙는다. 끊긴 동안의 음성은 버린다 (실시간 분석이라 늦은 음성은 쓸모가 적다).
 *
 * 원격(상대) 스트림은 Chrome 에서 <audio> 로 재생 중이어야 WebAudio 로 소리가 들어온다.
 */

export type UploaderState = "connecting" | "open" | "retrying" | "stopped" | "rejected";

const SAMPLE_RATE = 16000;
const CHUNK = 1600; // 100ms

// 오디오 스레드에서 128 샘플씩 받아 CHUNK 만큼 모아 Int16 으로 넘긴다
const WORKLET = `
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(${CHUNK}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.buffer, [this.buf.buffer]); this.buf = new Int16Array(${CHUNK}); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("pcm-tap", PcmTap);
`;

export class PcmUploader {
  private ctx: AudioContext | null = null;
  private ws: WebSocket | null = null;
  private epoch = 0;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly call: AnalysisCall,
    readonly trackId: string,
    private readonly stream: MediaStream,
    private readonly onState: (trackId: string, state: UploaderState, detail?: string) => void,
  ) {}

  async start(): Promise<void> {
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.ctx = ctx;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (this.stopped) return;
    const tap = new AudioWorkletNode(ctx, "pcm-tap");
    tap.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(e.data);
    };
    ctx.createMediaStreamSource(this.stream).connect(tap);
    // 출력에 안 이으면 process 가 안 도는 브라우저가 있다. 소리는 0 이라 들리지 않는다
    const mute = ctx.createGain();
    mute.gain.value = 0;
    tap.connect(mute).connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.ws?.close(1000);
    this.ws = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.onState(this.trackId, "stopped");
  }

  private connect(): void {
    if (this.stopped) return;
    this.onState(this.trackId, this.epoch === 0 ? "connecting" : "retrying");
    const ws = new WebSocket(audioSocketUrl(this.call, this.trackId, this.epoch));
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.onState(this.trackId, "open");
    };
    ws.onclose = (e) => {
      if (this.stopped || this.ws !== ws) return;
      // 1008: 통화당 화자 상한, 1013: 서버 STT 자리 없음, 1000 replaced: 같은 화자를 다른 연결이 가져감
      if (e.code === 1008 || e.code === 1013 || (e.code === 1000 && e.reason === "replaced")) {
        this.stopped = true;
        this.onState(this.trackId, "rejected", e.code === 1013 ? "서버가 바빠요" : e.reason || String(e.code));
        return;
      }
      this.epoch++;
      const delay = Math.min(5000, 500 * 2 ** this.retries++);
      this.onState(this.trackId, "retrying");
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }
}
