// Configuration Vite / Vitest.
// - Deux pages : index.html (solo) et multi.html (salon privé multijoueur).
// - En développement et en prévisualisation, /ws est relayé vers le serveur de jeu local
//   (PM3D_SERVEUR_WS, par défaut ws://localhost:2567) : le client se connecte toujours à sa propre origine.
// - PM3D_BASE : chemin de base du client (GitHub Pages) ; VITE_SERVEUR_WS : serveur de jeu public par défaut.
// - Build serveur : `vite build --ssr server/index.ts` (isSsrBuild) → dist-serveur/index.js pour Node 22.

import { defineConfig } from 'vitest/config';

const cible = process.env.PM3D_SERVEUR_WS ?? 'ws://localhost:2567';
const proxy = { '/ws': { target: cible, ws: true, changeOrigin: false } };

export default defineConfig(({ isSsrBuild }) => ({
  // Sous-dossier de publication (GitHub Pages : /StoryClip-AI/) ; '/' en local.
  base: process.env.PM3D_BASE ?? '/',
  server: { proxy },
  preview: { proxy },
  build: isSsrBuild
    ? { target: 'node22', sourcemap: true }
    : { rolldownOptions: { input: { main: 'index.html', multi: 'multi.html' } } },
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
}));
