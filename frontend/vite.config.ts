import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Writes dist/sw.js with the exact list of built files, so the installed app
 * (Home Mode + the verified pack) works offline after one online visit. */
function offlineServiceWorker(): Plugin {
  return {
    name: "catch-ai-offline-sw",
    apply: "build",
    generateBundle(_, bundle) {
      const built = Object.keys(bundle).filter((f) => /\.(js|css|woff2|svg|png)$/.test(f)).map((f) => `/${f}`);
      const statics = ["/", "/index.html", "/packs/calculus1.json", "/favicon.svg", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
      const precache = [...new Set([...statics, ...built])];
      const pack = readFileSync("public/packs/calculus1.json");
      const version = createHash("sha256").update(precache.join("|")).update(pack).digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "sw.js", source: swSource(version, precache) });
    },
  };
}

const swSource = (version: string, precache: string[]) => `// Generated at build time. Do not edit.
const CACHE = "catch-ai-${version}";
const RUNTIME = "catch-ai-runtime";
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Pages: network first, cached app shell when offline.
    if (req.mode === "navigate") {
      e.respondWith(fetch(req).catch(() => caches.match("/index.html", { cacheName: CACHE })));
      return;
    }
    // Round pack: network first so updates arrive, cache when offline.
    if (url.pathname.startsWith("/packs/")) {
      e.respondWith(
        fetch(req)
          .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
          .catch(() => caches.match(req, { cacheName: CACHE })),
      );
      return;
    }
    // Hashed build files never change: cache first.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }

  // Google Fonts: cache on first use so text looks the same offline.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.open(RUNTIME).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        try { const res = await fetch(req); c.put(req, res.clone()); return res; } catch { return Response.error(); }
      }),
    );
  }
  // Everything else (the classroom server) always goes to the network.
});
`;

export default defineConfig({
  plugins: [react(), offlineServiceWorker()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: { manualChunks: { katex: ["katex"], vendor: ["react", "react-dom", "react-router-dom", "framer-motion"] } },
    },
  },
});
