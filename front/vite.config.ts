import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };


export default defineConfig({
  // Build-time constants surfaced in the app (the diagnostics/info page shows them).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
      react(),
      tailwindcss(),
      // Installable PWA (home-screen install + offline app shell). scope/start_url derive from the
      // build `base` (--base=/messenger-ui/). autoUpdate so frequent redeploys don't leave a device
      // stuck on a stale cached bundle.
      VitePWA({
        registerType: "autoUpdate",
        // CDN-cache trap recovery: Cloudflare had cached BOTH the old `sw.js` AND `registerSW.js`
        // (stale precache manifest → chunk-hash mismatch → app crash) and they couldn't be purged.
        // Two changes sidestep the CDN entirely:
        //  - filename: a fresh SW URL the CDN never cached (served no-store so it never gets cached);
        //  - injectRegister "inline": the SW registration lives INLINE in index.html (which the CDN
        //    does not cache — DYNAMIC), so there is no cacheable registerSW.js bootstrap to go stale.
        filename: "app-sw.js",
        injectRegister: "inline",
        includeAssets: ["hormiga.jpeg"],
        manifest: {
          name: "Hormiga Messenger",
          short_name: "Hormiga",
          description: "Hormiga messenger",
          theme_color: "#134e4a",
          background_color: "#134e4a",
          display: "standalone",
          orientation: "portrait",
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
          cleanupOutdatedCaches: true,
          // Pull the Web Push handlers (push / notificationclick) into the generated SW. They live in
          // /public as plain JS (served verbatim, not precached under a hashed name), so notifications
          // work when the app is closed/backgrounded — the one thing the page JS can't do while the OS
          // has suspended the tab. Keeps generateSW (precaching) instead of switching to injectManifest.
          importScripts: ["push-sw.js"],
          // Chat/IDS/Kratos APIs are outside the SW scope (/messenger-ui/) → never intercepted;
          // only the app shell is precached.
          //
          // MUST be set explicitly: vite-plugin-pwa only auto-enables these for injectRegister
          // "auto"/null, and we use "inline" (to dodge CDN-cached registerSW.js). Without them the
          // freshly-deployed SW installs but sits in "waiting" forever while any tab/PWA stays open,
          // the old SW keeps serving the stale precached bundle, and main.tsx's controllerchange
          // reload never fires — devices get stuck on old builds until fully closed. With them the
          // new SW activates + claims immediately → controllerchange → one clean reload to the new build.
          skipWaiting: true,
          clientsClaim: true,
        },
      }),
      visualizer({
        open: true,
        gzipSize: true,
        brotliSize: true
      })
    ],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@ory/client")) return "ory";
            if (id.includes("react")) return "react";
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
