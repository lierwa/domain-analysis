import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiHost = process.env.API_HOST ?? "127.0.0.1";
const apiPort = process.env.API_PORT ?? "4000";
const apiTarget = `http://${apiHost}:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 6173),
    proxy: {
      "/api": apiTarget,
      "/health": apiTarget
    }
  }
});
