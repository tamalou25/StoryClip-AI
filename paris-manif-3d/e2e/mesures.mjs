// Mesures de chargement et de rendu par qualité (Chromium headless, rendu WebGL logiciel SwiftShader).
// Usage : npm run build && node e2e/mesures.mjs
// Mesure ce qui ne dépend pas du GPU (octets téléchargés, requêtes, mémoire déclarée, appels de rendu,
// triangles). Les temps par image NE SONT PAS représentatifs d'un appareil réel : ils sont indiqués
// à titre d'ordre de grandeur relatif entre les deux qualités.

import { chromium, devices } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 4178;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const serveur = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });

async function mesurer(navigateur, qualite, mobile) {
  const contexte = await navigateur.newContext(mobile
    ? { ...devices['Pixel 7'], viewport: { width: 915, height: 412 }, screen: { width: 915, height: 412 } }
    : { viewport: { width: 1280, height: 720 } });
  const page = await contexte.newPage();
  let octets = 0;
  let requetes = 0;
  const parType = {};
  page.on('response', async (r) => {
    try {
      const corps = await r.body();
      octets += corps.length;
      requetes++;
      const ext = (new URL(r.url()).pathname.match(/\.(\w+)$/)?.[1] ?? 'html');
      parType[ext] = (parType[ext] ?? 0) + corps.length;
    } catch { /* redirections, etc. */ }
  });
  await page.goto(`http://localhost:${PORT}/?test=1&qualite=${qualite}`);
  await page.waitForFunction(() => window.__pm3d !== undefined, null, { timeout: 240000 });
  await page.keyboard.press('Enter');
  // Vue de jeu stable puis vue générale (pire cas : toute la place dans le champ).
  await attendre(4000);
  const jeu = await page.evaluate(() => window.__pm3d.mesures());
  await page.evaluate(() => window.__pm3d.vue([-43, 17, -25], [2, 2, 6]));
  await attendre(4000);
  const generale = await page.evaluate(() => window.__pm3d.mesures());
  await contexte.close();
  return { qualite, mobile, octetsMo: +(octets / 1048576).toFixed(2), requetes, parTypeMo: Object.fromEntries(Object.entries(parType).map(([k, v]) => [k, +(v / 1048576).toFixed(2)])), jeu, generale };
}

try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* pas prêt */ }
    await attendre(200);
  }
  const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const resultats = [];
  resultats.push(await mesurer(navigateur, 'basse', true));
  resultats.push(await mesurer(navigateur, 'haute', false));
  await navigateur.close();
  console.log(JSON.stringify(resultats, null, 2));
} finally {
  serveur.kill();
}
