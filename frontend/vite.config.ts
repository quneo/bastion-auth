import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.BASTION_DEV_BACKEND ?? "http://127.0.0.1:8800";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": backend,
      "/oidc": backend,
      "/.well-known": backend,
    },
  },
  build: {
    assetsInlineLimit: 0,
  },
});
