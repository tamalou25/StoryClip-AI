// Test navigateur de la partie complète (Chromium headless, rendu logiciel) :
// accueil → camp → partie → pause/reprise/recommencer → fin → résultat → revanche → changement de camp → menu,
// pour les deux camps, au clavier puis en émulation tactile. Vérifie aussi les entrées répétées, le
// redimensionnement, la perte de focus et quelques points d'accessibilité (focus, aria).
// Ce n'est PAS un essai sur appareil réel. Usage : npm run build && node e2e/partie.mjs

import { chromium, devices } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 4176;
const URL_JEU = `http://localhost:${PORT}/?test=1&qualite=basse`;
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
async function jusqua(page, condition, delai = 20000) {
  const fin = Date.now() + delai;
  let e = await etat(page);
  while (!condition(e) && Date.now() < fin) { await attendre(150); e = await etat(page); }
  return e;
}
const focusId = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const texte = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);

async function ouvrir(navigateur, options = {}) {
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 800 }, ...options });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  await page.goto(`${URL_JEU}&duree=45`);
  await page.waitForFunction(() => window.__pm3d !== undefined);
  await page.waitForFunction(() => window.__pm3d.etat().fps > 2, null, { timeout: 60000 });
  return { page, erreurs };
}

async function manifestantsClavier(navigateur) {
  console.log('— Manifestants, clavier (1280×800) —');
  const { page, erreurs } = await ouvrir(navigateur);
  await page.keyboard.press('Enter'); // Jouer → choix du camp
  await attendre(150);
  verifier((await etat(page)).ecran === 'camp', 'Jouer ouvre le choix du camp');
  await page.click('[data-difficulte="facile"]');
  verifier((await page.getAttribute('[data-difficulte="facile"]', 'aria-pressed')) === 'true', 'le choix de difficulté est marqué (aria-pressed)');
  await page.click('#camp-manif');
  await attendre(400);
  let e = await etat(page);
  verifier(e.enJeu && e.camp === 'manif' && e.acteurs === 11 && e.actifs === 11, 'partie lancée : 6 manifestants + 5 forces de l’ordre', `acteurs=${e.acteurs}`);
  verifier(await page.locator('#objectif').isVisible() && /^\d:\d\d$/.test((await texte(page, '#chrono')).trim()), 'chrono et objectif affichés', await texte(page, '#chrono'));
  verifier((await page.locator('.zone-pastille').count()) === 3, 'trois zones listées dans le HUD');
  // Le rendu logiciel tourne plus lentement que le temps réel : on attend l'état, pas une durée.
  const conseil = await page.waitForSelector('#conseil:not([hidden])', { timeout: 20000 }).then(() => true, () => false);
  verifier(conseil, 'un conseil du tutoriel apparaît', (await texte(page, '#conseil')).slice(0, 50));

  // Course vers le parvis ouest en rassemblant (Espace maintenu).
  await attendre(800);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  e = await jusqua(page, (s) => s.rallie === true, 3000);
  verifier(e.rallie, 'Espace maintenu = rassembler (état rallie)');
  e = await jusqua(page, (s) => s.zones.find((z) => z.id === 'ouest').presents.manif >= 1 && s.x > -28, 25000);
  verifier(s(e), 'le joueur atteint le parvis ouest', `x=${e.x.toFixed(1)}`);
  function s(ee) { return ee.zones.find((z) => z.id === 'ouest').presents.manif >= 1 && ee.x > -28; }
  await page.keyboard.up('KeyW');
  e = await jusqua(page, (s) => s.zones.find((z) => z.id === 'ouest').tenue === 'manif', 20000);
  verifier(e.zones.find((z) => z.id === 'ouest').tenue === 'manif', 'le parvis ouest bascule côté manifestants', `contrôle=${e.zones[0].controle.toFixed(2)}`);
  verifier((await page.locator('#journal li').count()) >= 1, 'le journal annonce l’événement (aria-live)');
  e = await jusqua(page, (s) => s.mobilisation > 0.5, 5000);
  verifier(e.mobilisation > 0.5, 'la mobilisation monte quand une zone est tenue', `mob=${e.mobilisation.toFixed(1)}`);
  await page.keyboard.up('Space');
  const valeur = await page.getAttribute('#jauge', 'aria-valuenow');
  verifier(Number(valeur) >= 1, 'la jauge expose aria-valuenow', valeur);
  await page.screenshot({ path: `${CAPTURES}partie-manif.png`, timeout: 60000 });

  // Spécial : slogan (appui bref) → recharge en cours.
  await page.keyboard.press('KeyF');
  e = await jusqua(page, (s) => s.recharge > 0, 2000);
  verifier(e.recharge > 0, 'F lance un slogan (appui bref retenu même à bas débit d’images)', `recharge=${e.recharge.toFixed(1)}`);

  // Entrées répétées : rafale de touches sans erreur ni état incohérent.
  for (let i = 0; i < 25; i++) { await page.keyboard.press('Space'); await page.keyboard.press('KeyF'); }
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyS'); await page.keyboard.up('KeyW'); await page.keyboard.up('KeyS');
  await attendre(300);
  e = await etat(page);
  verifier(e.enJeu && Number.isFinite(e.x) && Number.isFinite(e.souffle), 'rafale de touches : état sain');

  // Redimensionnement en pleine partie.
  await page.setViewportSize({ width: 800, height: 500 });
  await attendre(300);
  await page.setViewportSize({ width: 1280, height: 800 });
  await attendre(300);
  verifier((await etat(page)).enJeu, 'redimensionnement : la partie continue');

  // Pause → reprise → recommencer.
  await page.keyboard.press('Escape');
  await attendre(150);
  e = await etat(page);
  verifier(!e.enJeu && e.ecran === 'pause' && (await focusId(page)) === 'bouton-reprendre', 'Échap : pause, focus sur Reprendre');
  verifier((await texte(page, '#pause-rappel')).includes('Manifestants'), 'l’écran de pause rappelle le camp et l’objectif');
  const tick = e.tick;
  await attendre(400);
  verifier((await etat(page)).tick === tick, 'simulation figée en pause');
  await page.keyboard.press('Escape');
  await attendre(150);
  verifier((await etat(page)).enJeu, 'Échap en pause : reprise');
  await page.keyboard.press('Escape');
  await attendre(150);
  await page.click('#bouton-recommencer');
  await attendre(300);
  e = await etat(page);
  verifier(e.enJeu && e.temps < 1 && e.mobilisation === 0 && e.actifs === 11, 'Recommencer repart de zéro, sans état résiduel', `temps=${e.temps.toFixed(2)}`);

  // Perte de focus → pause.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await attendre(150);
  verifier(!(await etat(page)).enJeu && (await etat(page)).ecran === 'pause', 'perte de focus → pause');
  await page.click('#bouton-reprendre');
  await attendre(150);

  // Fin de partie (accélérée) → résultat → revanche.
  await page.evaluate(() => window.__pm3d.accelerer(60));
  e = await jusqua(page, (s) => s.ecran === 'resultat', 6000);
  verifier(e.phase === 'terminee' && e.ecran === 'resultat' && e.vainqueur !== null, 'la partie se termine et l’écran de résultat s’ouvre', e.raison);
  verifier((await focusId(page)) === 'bouton-revanche', 'focus sur Revanche');
  const titre = await texte(page, '#resultat-titre');
  verifier(titre === (e.vainqueur === 'manif' ? 'Victoire' : 'Défaite'), 'le titre correspond au vainqueur', titre);
  verifier((await texte(page, '#resultat-conseil')).length > 20 && (await page.locator('#resultat-journal li').count()) >= 1, 'un conseil et des moments clés expliquent le résultat');
  await page.screenshot({ path: `${CAPTURES}resultat.png`, timeout: 60000 });
  await page.keyboard.press('Enter'); // Revanche
  await attendre(300);
  e = await etat(page);
  verifier(e.enJeu && e.phase === 'en-cours' && e.camp === 'manif' && e.temps < 1, 'Revanche : nouvelle partie, même camp');
  await page.evaluate(() => window.__pm3d.accelerer(60));
  await jusqua(page, (s) => s.ecran === 'resultat', 6000);
  await page.click('#bouton-changer-camp');
  await attendre(300);
  e = await etat(page);
  verifier(e.enJeu && e.camp === 'ordre' && e.charges === 3, 'Changer de camp : partie côté forces de l’ordre');
  await page.keyboard.press('Escape');
  await attendre(100);
  await page.click('#bouton-quitter');
  await attendre(200);
  e = await etat(page);
  verifier(!e.partieActive && e.ecran === 'accueil' && (await focusId(page)) === 'bouton-jouer', 'Quitter : retour à l’accueil, focus sur Jouer');
  verifier(erreurs.length === 0, 'aucune erreur console', erreurs.join(' | '));
  console.log(`   i/s (rendu logiciel) : ${e.fps.toFixed(1)} · appels de dessin : ${e.appelsDessin}`);
  await page.close();
}

async function ordreClavier(navigateur) {
  console.log('— Forces de l’ordre, clavier —');
  const { page, erreurs } = await ouvrir(navigateur);
  await page.keyboard.press('Enter');
  await attendre(150);
  await page.click('#camp-ordre');
  await attendre(500);
  let e = await etat(page);
  verifier(e.enJeu && e.camp === 'ordre' && e.charges === 3, 'partie lancée côté forces de l’ordre, 3 charges de gaz');
  verifier((await texte(page, '#cap-special-nom')) === 'Gaz fictif' && (await texte(page, '#cap-action-nom')) === 'Cordon', 'le HUD nomme les capacités du camp');
  await page.keyboard.down('KeyW');
  e = await jusqua(page, (s) => s.x < 34, 15000);
  verifier(e.x < 34, 'le départ n’est pas bloqué par une barrière', `x=${e.x.toFixed(1)}`);
  await page.keyboard.press('KeyF');
  e = await jusqua(page, (s) => s.nuages >= 1, 2000);
  verifier(e.nuages >= 1 && e.charges === 2, 'F lance un gaz fictif (nuage, charge consommée)', `nuages=${e.nuages} charges=${e.charges}`);
  await page.keyboard.down('Space');
  e = await jusqua(page, (s) => s.rallie, 2000);
  verifier(e.rallie, 'Espace maintenu = cordon');
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${CAPTURES}partie-ordre.png`, timeout: 60000 });
  await page.evaluate(() => window.__pm3d.accelerer(60));
  e = await jusqua(page, (s) => s.ecran === 'resultat', 6000);
  verifier(e.phase === 'terminee' && e.ecran === 'resultat', 'la partie se termine côté forces de l’ordre', e.raison);
  verifier(erreurs.length === 0, 'aucune erreur console', erreurs.join(' | '));
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
  await page.goto(`${URL_JEU}&duree=45`);
  await page.waitForFunction(() => window.__pm3d !== undefined);
  await page.waitForFunction(() => window.__pm3d.etat().fps > 2, null, { timeout: 60000 });
  await page.tap('#bouton-jouer');
  await attendre(200);
  await page.tap('#camp-ordre');
  await attendre(400);
  let e = await etat(page);
  verifier(e.enJeu && e.camp === 'ordre', 'toucher : partie lancée côté forces de l’ordre');
  const special = await page.locator('[data-commande="special"]').boundingBox();
  const action = await page.locator('[data-commande="action"]').boundingBox();
  verifier(special && special.width >= 44 && action && action.width >= 44, 'boutons Action et Spécial ≥ 44 px', `${special?.width}×${special?.height}`);
  verifier(await page.locator('#etat-joueur').isVisible(), 'barre de souffle visible');

  const cdp = await contexte.newCDPSession(page);
  const toucher = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const pouce = (x, y, id = 1) => ({ x, y, id, radiusX: 8, radiusY: 8 });
  // Joystick vers l'avant + bouton Spécial pendant la course (multitouch).
  await toucher('touchStart', [pouce(200, 300)]);
  for (let y = 295; y >= 230; y -= 5) await toucher('touchMove', [pouce(200, y)]);
  await attendre(600);
  await toucher('touchStart', [pouce(200, 230), pouce(special.x + special.width / 2, special.y + special.height / 2, 2)]);
  await attendre(150);
  await toucher('touchEnd', [pouce(200, 230)]);
  e = await jusqua(page, (s) => s.nuages >= 1, 3000);
  verifier(e.nuages >= 1, 'bouton Spécial pendant la course : gaz lancé (multitouch)', `nuages=${e.nuages}`);
  await page.screenshot({ path: `${CAPTURES}mobile-partie.png` });
  await toucher('touchEnd', []);
  await attendre(300);
  e = await etat(page);
  verifier(e.x < 40, 'le joystick a fait avancer le joueur', `x=${e.x.toFixed(1)}`);

  // Pause par le bouton, reprise au toucher.
  await page.tap('#bouton-pause');
  await attendre(150);
  verifier(!(await etat(page)).enJeu && (await etat(page)).ecran === 'pause', 'bouton ❚❚ : pause');
  await page.tap('#bouton-reprendre');
  await attendre(150);
  verifier((await etat(page)).enJeu, 'toucher Reprendre : reprise');

  // Fin accélérée et revanche au toucher.
  await page.evaluate(() => window.__pm3d.accelerer(60));
  e = await jusqua(page, (s) => s.ecran === 'resultat', 6000);
  verifier(e.ecran === 'resultat', 'écran de résultat en tactile');
  await page.screenshot({ path: `${CAPTURES}mobile-resultat.png` });
  await page.tap('#bouton-revanche');
  await attendre(300);
  verifier((await etat(page)).enJeu && (await etat(page)).temps < 1, 'revanche au toucher');
  verifier(erreurs.length === 0, 'aucune erreur page', erreurs.join(' | '));
  await contexte.close();
}

try {
  await pret();
  const navigateur = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await manifestantsClavier(navigateur);
  await ordreClavier(navigateur);
  await mobile(navigateur);
  await navigateur.close();
} catch (e) {
  console.error(e);
  echecs++;
} finally {
  serveur.kill();
}
console.log(echecs === 0 ? '\nPartie : tout est vert.' : `\nPartie : ${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
