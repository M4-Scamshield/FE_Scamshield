import { expect, type BrowserContext, type Page, type WebSocketRoute } from "@playwright/test";

// 실제 마이크·운영 서버 없이 합성 음성과 로컬 WebRTC로 통화를 검증한다.
export async function setup(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async (constraints?: MediaStreamConstraints) => {
      if (constraints?.video) {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        canvas.getContext("2d")!.fillRect(0, 0, canvas.width, canvas.height);
        const stream = canvas.captureStream(15);
        (window as any).__testVideoCapture = stream;
        return stream;
      }
      const context = new AudioContext();
      await context.resume();
      const oscillator = context.createOscillator();
      const level = context.createGain();
      level.gain.value = 0.1;
      const output = context.createMediaStreamDestination();
      oscillator.connect(level).connect(output);
      oscillator.start();
      (window as any).__testCapture = output.stream;
      (window as any).__testCaptureGain = level;
      return output.stream;
    } });
  });
  await context.route("**/api/calls/config", (route) => route.fulfill({ json: {
    success: true, data: { iceServers: [], maxParticipants: 4 },
  } }));

  let sequence = 0;
  const members = new Map<string, { socket: WebSocketRoute; info: { id: string; name: string; joinedAt: number } }>();
  await context.routeWebSocket("**/ws/signal", (socket) => {
    let id = "";
    socket.onMessage((data) => {
      const message = JSON.parse(String(data));
      if (message.type === "join") {
        id = `participant-${++sequence}`;
        const info = { id, name: message.name, joinedAt: Date.now() };
        socket.send(JSON.stringify({ type: "joined", self: info, callId: "test-call", peers: [...members.values()].map((m) => m.info) }));
        for (const member of members.values()) member.socket.send(JSON.stringify({ type: "peer-joined", peer: info }));
        members.set(id, { socket, info });
      } else if (message.type === "signal") {
        members.get(message.to)?.socket.send(JSON.stringify({ type: "signal", from: id, data: message.data }));
      }
    });
    socket.onClose(() => {
      members.delete(id);
      for (const member of members.values()) member.socket.send(JSON.stringify({ type: "peer-left", id }));
    });
  });
}

export async function join(page: Page, name: string) {
  await page.goto(`/?name=${encodeURIComponent(name)}&room=audio-test`);
  await page.getByRole("button", { name: "통화 시작", exact: true }).click();
  await expect(page.getByRole("button", { name: "통화 나가기" })).toBeVisible();
}
