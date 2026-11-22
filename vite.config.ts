import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 중에는 브라우저 → Vite(5173) → boostad.site 로 API와 WebSocket 요청을 전달한다
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 터널(cloudflared, ngrok) 도메인으로 들어오는 접속 허용
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok-free.dev"],
    // 구체적인 경로를 먼저 둔다. changeOrigin 으로 원격 서버에 맞는 Host 헤더를 보낸다
    proxy: {
      "/api/analysis": { target: "https://boostad.site", changeOrigin: true },
      "/ws/audio": { target: "wss://boostad.site", ws: true, changeOrigin: true },
      "/api": { target: "https://boostad.site", changeOrigin: true },
      "/ws": { target: "wss://boostad.site", ws: true, changeOrigin: true },
    },
  },
});
