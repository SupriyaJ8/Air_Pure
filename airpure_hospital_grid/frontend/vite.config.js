import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
// Dev: browser calls /api/* on the Vite origin, which proxies to the Flask adapter (no CORS needed).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return { plugins: [react()], server: { port: 5173, proxy: { "/api": env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000" } } };
});
