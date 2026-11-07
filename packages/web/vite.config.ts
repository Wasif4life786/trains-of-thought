import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The browser calls /api/* on its own origin and Vite forwards it to the API (`npm run dev` starts both).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 8787}` },
  },
});
