import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base relativo: funziona su GitHub Pages in qualsiasi sotto-cartella
export default defineConfig({ plugins: [react()], base: "./" });
