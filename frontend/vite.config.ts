import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: /api is proxied to the FastAPI backend (no CORS needed). Override with VITE_API_BASE.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } } },
});
