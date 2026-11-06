// Captures de référence à cadrage fixe, pour comparer le rendu avant/après une modification.
// Usage : npm run build && node e2e/vues.mjs <dossier-sortie> [basse|haute]
// Chromium headless avec rendu WebGL logiciel (SwiftShader) : utile pour juger cadrage, matières et lumière,
// pas pour mesurer la fluidité.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const SORTIE = process.argv[2] ?? 'e2e/captures/vues';
const QUALITE = process.argv[3] ?? 'basse';
// 4e argument facultatif : liste de vues séparées par des virgules (ex. « facade-est,monument »).
const FILTRE = process.argv[4]?.split(',') ?? null;
const PORT = 4177;
mkdirSync(SORTIE, { recursive: true });

// [position caméra, point visé] en mètres, repère du jeu.
export const VUES = {
  'place-generale': [[-43, 17, -25], [2, 2, 6]],
  'facade-est': [[44, 1.8, 2], [58, 7, 7]],
  'facade-gros-plan': [[53.5, 1.7, -2], [58, 3, 1]],
  'arbres-bancs': [[-24, 1.8, 11.5], [-16, 3.5, 17]],
  monument: [[-15, 3, -5], [0, 6.5, 0]],
  'sol-gros-plan': [[-30, 1.5, 2], [-28.8, 0, 3.4]],
};

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const serveur = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* pas prêt */ }
    await attendre(200);
  }
  const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 720 } });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/?test=1&qualite=${QUALITE}`);
  await page.waitForFunction(() => window.__pm3d !== undefined, null, { timeout: 180000 });
  await page.keyboard.press('Enter');
  await attendre(1500);
  // Vue de jeu : quelques pas vers le monument, caméra automatique.
  await page.keyboard.down('KeyW');
  await attendre(1800);
  await page.keyboard.up('KeyW');
  await attendre(1500);
  if (!FILTRE || FILTRE.includes('jeu')) await page.screenshot({ path: `${SORTIE}/${QUALITE}-jeu.png`, timeout: 180000 });
  // Vue rapprochée du personnage (trois quarts avant), relative à sa position réelle.
  if (!FILTRE || FILTRE.includes('personnage')) {
    const j = await page.evaluate(() => window.__pm3d.etat());
    const ax = -Math.sin(j.cap);
    const az = -Math.cos(j.cap);
    await page.evaluate(([a, c]) => window.__pm3d.vue(a, c), [[j.x + ax * 2.6 + az * 1.2, 1.55, j.z + az * 2.6 - ax * 1.2], [j.x, 1.0, j.z]]);
    await attendre(2500);
    await page.screenshot({ path: `${SORTIE}/${QUALITE}-personnage.png`, timeout: 180000 });
  }
  for (const [nom, [pos, cible]] of Object.entries(VUES)) {
    if (FILTRE && !FILTRE.includes(nom)) continue;
    await page.evaluate(([a, c]) => window.__pm3d.vue(a, c), [pos, cible]);
    await attendre(2500);
    await page.screenshot({ path: `${SORTIE}/${QUALITE}-${nom}.png`, timeout: 180000 });
  }
  const etat = await page.evaluate(() => window.__pm3d.etat());
  console.log(`${QUALITE} : ${Object.keys(VUES).length + 1} captures dans ${SORTIE} · appels de dessin ${etat.appelsDessin}`);
  if (erreurs.length) console.log('Erreurs console :', erreurs.slice(0, 8).join(' | '));
  await navigateur.close();
} finally {
  serveur.kill();
}
