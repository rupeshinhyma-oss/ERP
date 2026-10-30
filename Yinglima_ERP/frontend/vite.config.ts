import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_API_PROXY_TARGET?.trim() || "";
  const port = env.VITE_PORT ? Number(env.VITE_PORT) : undefined;

  return {
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      host: "0.0.0.0",
      ...(port ? { port } : {}),
      ...(proxyTarget
        ? {
            proxy: {
              "/api": {
                target: proxyTarget,
                changeOrigin: true,
                ws: true,
                configure: (proxy) => {
                  proxy.on("error", (err: any) => {
                    const code = err?.code;
                    if (code === "ECONNRESET" || code === "ECONNREFUSED" || err?.message?.includes("socket hang up")) {
                      return;
                    }
                    console.warn("[vite] api proxy error:", err?.message || err);
                  });
                },
              },
              "/static": {
                target: proxyTarget,
                changeOrigin: true,
              },
              "/uploads": {
                target: proxyTarget,
                changeOrigin: true,
              },
            },
          }
        : {}),
    },
  };
});
