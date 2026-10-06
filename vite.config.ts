import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  root: ".", // Points to your current flattened folder
  plugins: [react(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@shared': '/shared',
    },
  },
  optimizeDeps: {
    exclude: ["lucide-react"],
    include: ["tesseract.js"],
  },
});