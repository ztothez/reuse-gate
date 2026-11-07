// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// STATIC_SPA=1 builds static files into dist/client, with no server, for frontend/Containerfile.
const staticSpa = process.env["STATIC_SPA"] === "1";

export default defineConfig({
  ...(staticSpa && { nitro: false as const }),
  tanstackStart: {
    // Prerender the real page, not Start's empty SPA shell, which fails React hydration on load.
    ...(staticSpa && {
      prerender: { enabled: true, crawlLinks: false, autoStaticPathsDiscovery: false },
      pages: [{ path: "/" }],
    }),
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
