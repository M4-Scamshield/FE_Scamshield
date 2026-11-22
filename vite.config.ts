import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 브라우저는 Vite로 요청하고, Vite가 작업자별 .env.local에 지정한 서버로 전달한다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.API_PROXY_TARGET?.trim() || "http://localhost:8080";
  const analysisTarget = env.ANALYSIS_PROXY_TARGET?.trim() || "http://localhost:8081";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // 터널(cloudflared, ngrok) 도메인으로 들어오는 접속 허용
      allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok-free.dev"],
      // 분석 경로를 먼저 둔다. 앞에 있는 규칙이 먼저 걸린다.
      proxy: {
        "/api/analysis": { target: analysisTarget, changeOrigin: true },
        "/ws/audio": { target: analysisTarget.replace(/^http/, "ws"), ws: true, changeOrigin: true },
        "/api": { target: apiTarget, changeOrigin: true },
        "/ws": { target: apiTarget.replace(/^http/, "ws"), ws: true, changeOrigin: true },
      },
    },
  };
});
