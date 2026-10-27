import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 중에는 브라우저 → Vite(5173) → Spring(8080) 으로 넘겨서 CORS 없이 같은 주소처럼 쓴다
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 터널(cloudflared, ngrok) 도메인으로 들어오는 접속 허용
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok-free.dev"],
    // 분석(파이프라인, 8081) 경로를 먼저 둔다. 앞에 있는 규칙이 먼저 걸린다
    proxy: {
      "/api/analysis": "http://localhost:8081",
      "/ws/audio": { target: "ws://localhost:8081", ws: true },
      "/api": "http://localhost:8080",
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
});
