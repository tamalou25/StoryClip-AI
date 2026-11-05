// Test de fumée navigateur (Chromium headless, rendu WebGL logiciel).
// Vérifie : chargement sans erreur, menu au clavier seul, déplacement ZQSD, pause/reprise,
// interruption (perte de focus), et en émulation mobile : multitouch joystick + bouton.
// Ce n'est PAS un essai sur appareil réel ; les i/s mesurées ici ne sont pas représentatives.
// Usage : npm run build && npm run test:e2e

import { chromium, devices } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 4174;
// duree=600 : aucune fin de partie pendant la fumée (les règles sont testées dans e2e/partie.mjs).
const URL_JEU = `http://localhost:${PORT}/?test=1&duree=600`;
// Le rendu logiciel de Chromium headless ne tient pas la qualité haute (SSAO, MSAA) en temps réel :
// les vérifications de commandes se font en qualité basse, la qualité haute est contrôlée à part.
const URL_BASSE = `${URL_JEU}&qualite=basse`;
const CAPTURES = new URL('./captures/', import.meta.url).pathname;
mkdirSync(CAPTURES, { recursive: true });

// Vite est lancé directement (pas via npx) : serveur.kill() arrête bien le processus à la fin.
const serveur = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifier = (condition, message, detail = '') => {
  console.log(`${condition ? 'OK  ' : 'ÉCHEC'} ${message}${detail ? ` (${detail})` : ''}`);
  if (!condition) echecs++;
};

async function pret() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return; } catch { /* pas encore prêt */ }
    await attendre(200);
  }
  throw new Error('serveur de prévisualisation injoignable');
}

const etat = (page) => page.evaluate(() => window.__pm3d.etat());
/** Interroge l'état jusqu'à ce que la condition soit vraie (ou délai écoulé) ; renvoie le dernier état. */
async function jusqua(page, condition, delai = 15000) {
  const fin = Date.now() + delai;
  let e = await etat(page);
  while (!condition(e) && Date.now() < fin) { await attendre(150); e = await etat(page); }
  return e;
}
const ecartAngle = (a, b) => Math.abs(((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

async function ordinateur(navigateur) {
  console.log('— Ordinateur 1280×800, clavier seul (qualité basse) —');
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 800 } });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  await page.goto(URL_BASSE);
  await page.waitForFunction(() => window.__pm3d !== undefined, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__pm3d.etat().fps > 3, null, { timeout: 60000 });

  const focus = await page.evaluate(() => document.activeElement?.id);
  verifier(focus === 'bouton-jouer', 'le bouton Jouer a le focus au chargement', focus);
  const atteints = [];
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); atteints.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)); }
  verifier(!atteints.includes('bouton-pause'), 'Tab reste dans le menu (arrière-plan inerte)', atteints.join(','));
  await page.focus('#bouton-jouer');
  await page.keyboard.press('Enter');
  await attendre(200);
  const focusCamp = await page.evaluate(() => document.activeElement?.id);
  verifier(focusCamp === 'camp-manif', 'Entrée ouvre le choix du camp, focus sur Manifestants', focusCamp);
  await page.keyboard.press('Enter');
  await attendre(300);
  verifier((await etat(page)).enJeu && (await etat(page)).camp === 'manif', 'Entrée sur le camp lance la partie');

  await attendre(1000); // préchauffage : les premières images du rendu logiciel sont très lentes
  // Les durées réelles varient avec le rendu logiciel : on attend des états, pas des durées.
  const e0 = await etat(page);
  await page.keyboard.down('KeyW'); // touche Z sur AZERTY
  const e1 = await jusqua(page, (e) => e.x - e0.x > 3);
  verifier(e1.x - e0.x > 3 && e1.vitesse > 3, 'Z/W fait courir vers le monument (+x)', `Δx=${(e1.x - e0.x).toFixed(2)} v=${e1.vitesse.toFixed(2)}`);

  // On continue tout droit dans le socle du monument : il doit arrêter le personnage.
  const e2 = await jusqua(page, (e) => e.x > -10 && e.vitesse < 0.05, 60000);
  await page.keyboard.up('KeyW');
  verifier(e2.x > -5.05 && e2.x <= -4.5 - 0.4 + 1e-3 && Math.abs(e2.z) < 4.5, 'bloqué contre le socle central, sans le traverser', `x=${e2.x.toFixed(2)} z=${e2.z.toFixed(2)}`);

  // Maj + avancer = marche.
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyS');
  const marche = await jusqua(page, (e) => e2.x - e.x > 1.5);
  await page.keyboard.up('KeyS');
  await page.keyboard.up('ShiftLeft');
  verifier(marche.vitesse > 1 && marche.vitesse < 2.2, 'Maj fait marcher au lieu de courir', `v=${marche.vitesse.toFixed(2)}`);
  verifier(marche.audio === 'running', "l'audio démarre après le geste « Jouer »", marche.audio);
  await attendre(600);

  const avantDroite = await etat(page);
  await page.keyboard.down('ArrowRight');
  const e3 = await jusqua(page, (e) => e.z - avantDroite.z > 1);
  await page.keyboard.up('ArrowRight');
  verifier(e3.z - avantDroite.z > 1, 'flèche droite déplace sur le côté (+z)', `Δz=${(e3.z - avantDroite.z).toFixed(2)}`);

  await page.keyboard.down('KeyE');
  let e4 = await etat(page);
  for (let i = 0; i < 15 && Math.abs(e4.lacetCamera - e3.lacetCamera) <= 0.5; i++) { await attendre(200); e4 = await etat(page); }
  await page.keyboard.up('KeyE');
  verifier(Math.abs(e4.lacetCamera - e3.lacetCamera) > 0.5, 'E tourne la caméra', `Δ=${(e4.lacetCamera - e3.lacetCamera).toFixed(2)}`);
  await page.keyboard.press('KeyC');
  await jusqua(page, (e) => ecartAngle(e.lacetCamera, e.cap) < 0.05, 8000);
  const e5 = await etat(page);
  verifier(ecartAngle(e5.lacetCamera, e5.cap) < 0.05, 'C recentre la caméra derrière le personnage', `écart=${ecartAngle(e5.lacetCamera, e5.cap).toFixed(3)}`);

  await page.screenshot({ path: `${CAPTURES}ordinateur.png`, timeout: 60000 });

  await page.keyboard.press('Escape');
  await attendre(100);
  const enPause = await etat(page);
  verifier(!enPause.enJeu && (await page.evaluate(() => document.activeElement?.id)) === 'bouton-reprendre', 'Échap met en pause, focus sur Reprendre');
  const tickPause = enPause.tick;
  await attendre(500);
  verifier((await etat(page)).tick === tickPause, 'la simulation est gelée pendant la pause');
  await page.keyboard.press('Enter');
  await attendre(200);
  verifier((await etat(page)).enJeu, 'Entrée reprend la partie');

  await page.keyboard.down('KeyW');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await attendre(200);
  await page.keyboard.up('KeyW');
  verifier(!(await etat(page)).enJeu, 'perte de focus (appel, notification) → pause');

  verifier(erreurs.length === 0, 'aucune erreur console', erreurs.join(' | '));
  const fin = await etat(page);
  console.log(`   i/s (Chromium headless, rendu logiciel) : ${fin.fps.toFixed(1)} · appels de dessin : ${fin.appelsDessin}`);
  await page.close();
}

async function qualiteHaute(navigateur) {
  console.log('— Qualité haute : chargement et rendu (pas de mesure de fluidité) —');
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 720 } });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  await page.goto(`${URL_JEU}&qualite=haute`);
  await page.waitForFunction(() => window.__pm3d !== undefined, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__pm3d.etat().fps > 0, null, { timeout: 90000 });
  const e = await etat(page);
  verifier(e.qualite === 'haute', 'qualité haute sélectionnée par paramètre');
  await page.screenshot({ path: `${CAPTURES}haute.png`, timeout: 90000 });
  verifier(erreurs.length === 0, 'aucune erreur console en qualité haute', erreurs.join(' | '));
  const eh = await etat(page);
  console.log(`   haute : appels de dessin ${eh.appelsDessin}`);
  await page.close();
}

async function mobile(navigateur) {
  console.log('— Émulation Pixel 7 paysage (tactile émulé, pas un appareil réel) —');
  const appareil = devices['Pixel 7'];
  const contexte = await navigateur.newContext({
    ...appareil,
    viewport: { width: appareil.viewport.height, height: appareil.viewport.width },
    screen: { width: appareil.screen.height, height: appareil.screen.width },
  });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto(URL_JEU);
  await page.waitForFunction(() => window.__pm3d !== undefined, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__pm3d.etat().fps > 3, null, { timeout: 60000 });
  verifier((await etat(page)).qualite === 'basse', 'qualité basse par défaut sur écran tactile');
  await page.tap('#bouton-jouer');
  await attendre(200);
  await page.tap('#camp-manif');
  await attendre(300);
  verifier((await etat(page)).enJeu, 'toucher Jouer puis un camp lance la partie');

  const action = await page.locator('[data-commande="action"]').boundingBox();
  verifier(action && action.width >= 44 && action.height >= 44, 'bouton Action ≥ 44 px', action && `${action.width}×${action.height}`);

  const cdp = await contexte.newCDPSession(page);
  const toucher = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const pouce = (x, y) => ({ x, y, id: 1, radiusX: 8, radiusY: 8 });
  const ax = action.x + action.width / 2;
  const ay = action.y + action.height / 2;

  const e0 = await etat(page);
  await toucher('touchStart', [pouce(200, 300)]);
  for (let y = 295; y >= 230; y -= 5) await toucher('touchMove', [pouce(200, y)]); // pousse vers le haut = avant
  // Deuxième doigt sur Action pendant que le joystick est tenu (multitouch).
  await toucher('touchStart', [pouce(200, 230), { x: ax, y: ay, id: 2, radiusX: 8, radiusY: 8 }]);
  await attendre(1200);
  const joystickVisible = await page.locator('.joystick-base').isVisible();
  const actionAppuyee = await page.locator('[data-commande="action"]').evaluate((b) => b.classList.contains('appuye'));
  await page.screenshot({ path: `${CAPTURES}mobile-paysage.png` });
  await toucher('touchEnd', [pouce(200, 230)]); // relâche Action
  await toucher('touchEnd', []);
  await attendre(400);
  const e1 = await etat(page);
  verifier(e1.x - e0.x > 2, 'joystick vers le haut fait avancer', `Δx=${(e1.x - e0.x).toFixed(2)}`);
  verifier(joystickVisible, 'joystick affiché sous le pouce');
  verifier(actionAppuyee, 'bouton Action appuyé en même temps (multitouch)');
  verifier(!(await page.locator('.joystick-base').isVisible()), 'joystick masqué après relâchement');
  verifier(e1.vitesse < 1.5, "le personnage ralentit après relâchement", `v=${e1.vitesse.toFixed(2)}`);

  // Glisser à droite : caméra manuelle facultative.
  const l0 = (await etat(page)).lacetCamera;
  await toucher('touchStart', [pouce(700, 200)]);
  for (let x = 700; x >= 600; x -= 10) await toucher('touchMove', [pouce(x, 200)]);
  await toucher('touchEnd', []);
  await attendre(100);
  verifier(Math.abs((await etat(page)).lacetCamera - l0) > 0.5, 'glisser à droite tourne la caméra');

  // Portrait : bandeau d'invitation à tourner l'écran.
  await page.setViewportSize({ width: appareil.viewport.width, height: appareil.viewport.height });
  await attendre(300);
  verifier(await page.locator('#bandeau-portrait').isVisible(), 'bandeau « tourne le téléphone » en portrait');
  await page.screenshot({ path: `${CAPTURES}mobile-portrait.png` });

  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await attendre(100);
  verifier(!(await etat(page)).enJeu, 'onglet masqué → pause');
  verifier(erreurs.length === 0, 'aucune erreur page', erreurs.join(' | '));
  await contexte.close();
}

try {
  await pret();
  const navigateur = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await ordinateur(navigateur);
  await qualiteHaute(navigateur);
  await mobile(navigateur);
  await navigateur.close();
} catch (e) {
  console.error(e);
  echecs++;
} finally {
  serveur.kill();
}
console.log(echecs === 0 ? '\nFumée : tout est vert.' : `\nFumée : ${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
