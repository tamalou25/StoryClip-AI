// E2E multijoueur : deux contextes navigateur INDÉPENDANTS (stockage séparé) jouent ensemble
// contre le serveur de production construit (dist-serveur/ qui sert aussi dist/).
// Vérifie les échanges dans les deux sens, la reconnexion (coupure + rechargement), le résultat
// commun, la revanche, le départ, et les erreurs affichées (introuvable, commencée, indisponible).
// Usage : npm run build && npm run serveur:build && npm run test:multi
// Rendu WebGL logiciel (headless) : peu d'images/s, ce n'est pas une mesure de performance.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 4181;
// PM3D_E2E_URL=http://localhost:8080 : teste un serveur déjà lancé (ex. le conteneur Docker) au lieu d'en démarrer un.
const EXTERNE = process.env.PM3D_E2E_URL ?? null;
const BASE = EXTERNE ?? `http://localhost:${PORT}`;
const PAGE = `${BASE}/multi.html?test=1&qualite=basse`;
const CAPTURES = new URL('./captures/', import.meta.url).pathname;
mkdirSync(CAPTURES, { recursive: true });

const serveur = EXTERNE ? null : spawn('node', ['dist-serveur/index.js'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, PM3D_PORT: String(PORT), PM3D_HOTE: '127.0.0.1', PM3D_STATIQUE: 'dist', PM3D_DUREE_PARTIE_S: '300', PM3D_COMPTE_S: '1', PM3D_GRACE_S: '15' },
});
const journalServeur = [];
serveur?.stdout.on('data', (d) => journalServeur.push(...String(d).trim().split('\n')));

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifier = (condition, message, detail = '') => {
  console.log(`${condition ? 'OK  ' : 'ÉCHEC'} ${message}${detail ? ` (${detail})` : ''}`);
  if (!condition) echecs++;
};

async function pret() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/sante`)).ok) return; } catch { /* pas encore */ }
    await attendre(200);
  }
  throw new Error('serveur injoignable');
}

const etat = (page) => page.evaluate(() => window.__pm3dMulti.etat());
async function jusqua(page, condition, delai = 20000, message = 'condition') {
  const fin = Date.now() + delai;
  let e = await etat(page);
  while (!condition(e) && Date.now() < fin) { await attendre(100); e = await etat(page); }
  if (!condition(e)) console.log(`   … délai dépassé : ${message}`, JSON.stringify({ phase: e.phase, connexion: e.connexion, erreur: e.erreur, joueurs: e.joueurs }));
  return e;
}

async function ouvrir(contexte, nom, url = PAGE) {
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('crash', () => { console.log(`   ⚠ page ${nom} plantée (processus de rendu)`); erreurs.push('crash'); });
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket')) erreurs.push(m.text()); });
  page.setDefaultTimeout(90000);
  await page.goto(url);
  await page.waitForFunction(() => window.__pm3dMulti !== undefined);
  // Premières images très lentes en rendu logiciel (compilation des shaders, cubemaps du ciel).
  await page.waitForFunction(() => window.__pm3dMulti.etat().fps > 0, null, { timeout: 180000 });
  page.nomJoueur = nom;
  page.erreursJs = erreurs;
  return page;
}

/** Maintient une touche pendant `ms` millisecondes (le jeu lit event.code). */
async function maintenir(page, touche, ms) {
  await page.keyboard.down(touche);
  await attendre(ms);
  await page.keyboard.up(touche);
}

async function principal() {
  await pret();
  // Un processus Chromium par joueur : contextes totalement indépendants (stockage, sessionStorage),
  // et chaque page reste au premier plan (en headless, une page d'arrière-plan ne rend plus d'images).
  const navigateurs = await Promise.all([0, 1, 2].map(() => chromium.launch()));
  const ctxA = await navigateurs[0].newContext({ viewport: { width: 800, height: 500 } });
  const ctxB = await navigateurs[1].newContext({ viewport: { width: 800, height: 500 } });
  const ctxC = await navigateurs[2].newContext({ viewport: { width: 800, height: 500 } });

  console.log('— 1. Création et arrivée dans le même salon —');
  const A = await ouvrir(ctxA, 'Alice');
  await A.fill('#champ-nom', 'Alice');
  await A.click('#bouton-creer');
  const eA0 = await jusqua(A, (e) => e.code !== null, 15000, 'salon créé');
  const code = eA0.code;
  verifier(/^[A-HJ-NP-Z2-9]{5}$/.test(code ?? ''), 'code court affiché', code);
  verifier((await A.textContent('#code-salon')) === code, 'le code est visible à l’écran');

  // B arrive par le lien partagé (?code=…), choisit son nom et son camp.
  const B = await ouvrir(ctxB, 'Bob', `${PAGE}&code=${code}`);
  verifier((await B.inputValue('#champ-code')) === code, 'le lien partagé pré-remplit le code');
  await B.fill('#champ-nom', 'Bob <b>');
  await B.click('label:has(input[value="forces"])');
  await B.click('#bouton-rejoindre');
  await jusqua(A, (e) => e.joueurs.length === 2, 15000, 'A voit B');
  await jusqua(B, (e) => e.joueurs.length === 2, 15000, 'B voit A');
  const listeA = await A.$$eval('#liste-joueurs li', (lis) => lis.map((li) => li.textContent));
  verifier(listeA.length === 2 && listeA[0].includes('Alice') && listeA[1].includes('Bob <b>') && listeA[1].includes("Forces de l'ordre"), 'A voit les participants, noms (texte brut) et camps', listeA.join(' | '));
  verifier(await A.isVisible('#bouton-lancer') && !(await B.isVisible('#bouton-lancer')), 'seul l’hôte voit « Lancer la partie »');
  verifier(await A.isDisabled('#bouton-lancer'), 'lancement impossible tant que personne n’est prêt');

  // Pages des essais d'erreurs chargées dès maintenant : leur démarrage (très lent en rendu
  // logiciel) ne doit pas consommer le temps de la partie.
  const C = await ouvrir(ctxC, 'Chloé');
  const D = await ouvrir(await navigateurs[2].newContext({ viewport: { width: 640, height: 400 } }), 'Hors ligne', `${PAGE}&serveur=ws://127.0.0.1:1/ws`);

  console.log('— 2. Préparation et départ —');
  await B.click('#bouton-pret');
  await jusqua(A, (e) => e.joueurs.find((j) => j.nom.startsWith('Bob'))?.pret === true, 10000, 'A voit B prêt');
  verifier((await A.textContent('#liste-joueurs')).includes('prêt'), 'l’état de préparation de B apparaît chez A');
  await A.click('#bouton-pret');
  await A.waitForFunction(() => !document.querySelector('#bouton-lancer').disabled, null, { timeout: 10000 });
  await A.click('#bouton-lancer');
  const eA1 = await jusqua(A, (e) => e.phase === 'partie' && e.local !== null, 30000, 'partie A');
  const eB1 = await jusqua(B, (e) => e.phase === 'partie' && e.local !== null, 30000, 'partie B');
  verifier(eA1.phase === 'partie' && eB1.phase === 'partie', 'la partie démarre chez les deux');
  verifier(await A.isVisible('#hud') && await B.isVisible('#hud'), 'HUD (scores, minuteur, objectifs) affiché');

  console.log('— 3. Erreurs compréhensibles (pendant la partie) —');
  await C.fill('#champ-code', code);
  await C.click('#bouton-rejoindre');
  const eC1 = await jusqua(C, (e) => e.erreur !== null, 10000, 'erreur partie commencée');
  verifier(/déjà commencé/.test(eC1.erreur ?? ''), 'partie déjà commencée', eC1.erreur);
  await C.fill('#champ-code', 'ZZZZZ');
  await C.click('#bouton-rejoindre');
  const eC2 = await jusqua(C, (e) => /introuvable/.test(e.erreur ?? ''), 10000, 'erreur introuvable');
  verifier(/introuvable/i.test(eC2.erreur ?? ''), 'salon introuvable', eC2.erreur);
  await C.fill('#champ-code', 'AB');
  await C.click('#bouton-rejoindre');
  verifier(/Code invalide/.test(await C.textContent('#erreur')), 'code mal saisi signalé avant tout envoi');
  await D.click('#bouton-creer');
  const eD = await jusqua(D, (e) => e.erreur !== null, 15000, 'serveur indisponible');
  verifier(/Serveur indisponible/.test(eD.erreur ?? ''), 'serveur indisponible', eD.erreur);
  for (const p of [C, D]) verifier(p.erreursJs.length === 0, `aucune erreur JavaScript (${p.nomJoueur})`, p.erreursJs.join(' | '));
  await navigateurs[2].close(); // libère le processeur pour les deux joueurs

  await attendre(1500); // préchauffage du rendu logiciel

  console.log('— 4. Déplacements synchronisés dans les deux sens —');
  const idA = eA1.id;
  const idB = eB1.id;
  console.log(`   (rendu logiciel : A ${(await etat(A)).fps.toFixed(1)} i/s, B ${(await etat(B)).fps.toFixed(1)} i/s)`);
  const a0 = (await etat(A)).local;
  const aVuParB0 = (await etat(B)).distants[idA];
  await maintenir(A, 'KeyW', 2000);
  await attendre(800);
  const a1 = (await etat(A)).local;
  const aVuParB1 = (await etat(B)).distants[idA];
  verifier(a1.x - a0.x > 2, 'A avance chez lui (prédiction locale)', `Δx=${(a1.x - a0.x).toFixed(2)}`);
  verifier(aVuParB1 && aVuParB1.x - aVuParB0.x > 2, 'B voit A avancer', `Δx vu par B=${(aVuParB1.x - aVuParB0.x).toFixed(2)}`);
  verifier(Math.abs(aVuParB1.x - a1.x) < 0.3 && Math.abs(aVuParB1.z - a1.z) < 0.3, 'même position de A chez A et chez B', `A:${a1.x.toFixed(2)},${a1.z.toFixed(2)} B:${aVuParB1.x.toFixed(2)},${aVuParB1.z.toFixed(2)}`);

  const b0 = (await etat(B)).local;
  const bVuParA0 = (await etat(A)).distants[idB];
  await maintenir(B, 'KeyW', 2000);
  await attendre(800);
  const b1 = (await etat(B)).local;
  const bVuParA1 = (await etat(A)).distants[idB];
  verifier(b0.x - b1.x > 2, 'B avance chez lui (vers −x)', `Δx=${(b1.x - b0.x).toFixed(2)}`);
  verifier(bVuParA0.x - bVuParA1.x > 2, 'A voit B avancer', `Δx vu par A=${(bVuParA1.x - bVuParA0.x).toFixed(2)}`);
  verifier(Math.abs(bVuParA1.x - b1.x) < 0.3, 'même position de B chez A et chez B');
  await A.screenshot({ path: `${CAPTURES}multi-A.png` });
  await B.screenshot({ path: `${CAPTURES}multi-B.png` });
  const hudA = await A.textContent('.tableau-score');
  verifier(/\d+\s*\d+:\d\d\s*\d+/.test(hudA.replace(/\s+/g, ' ')), 'scores et minuteur affichés', hudA.replace(/\s+/g, ' ').trim());

  console.log('— 5. Coupure réseau puis rechargement de page —');
  await B.evaluate(() => window.__pm3dMulti.couper());
  const eB2 = await jusqua(B, (e) => e.bandeau !== null || e.connexion === 'reconnexion', 5000, 'bandeau');
  verifier(/interrompue/.test(eB2.bandeau ?? '') || eB2.connexion === 'reconnexion', 'B voit « connexion interrompue »', eB2.bandeau);
  const vuParA = await jusqua(A, (e) => e.joueurs.find((j) => j.id === idB)?.presence !== 'connecte', 5000, 'A voit B absent');
  verifier(vuParA.joueurs.find((j) => j.id === idB)?.presence === 'reconnexion', 'A voit B « reconnexion… »');
  const eB3 = await jusqua(B, (e) => e.connexion === 'en_ligne' && e.bandeau === null && e.local !== null, 15000, 'B reconnecté');
  verifier(eB3.connexion === 'en_ligne' && eB3.id === idB, 'B reconnecté automatiquement à sa place');
  await jusqua(A, (e) => e.joueurs.find((j) => j.id === idB)?.presence === 'connecte', 5000, 'A voit B revenu');

  await B.reload();
  await B.waitForFunction(() => window.__pm3dMulti !== undefined);
  await B.waitForFunction(() => window.__pm3dMulti.etat().fps > 0, null, { timeout: 180000 });
  const eB4 = await jusqua(B, (e) => e.phase === 'partie' && e.id === idB && e.local !== null, 45000, 'B revient après rechargement');
  verifier(eB4.id === idB && eB4.phase === 'partie', 'après rechargement, B reprend sa place dans la partie');
  const avant = (await etat(A)).distants[idB];
  await maintenir(B, 'KeyD', 1200);
  await attendre(800);
  const apres = (await etat(A)).distants[idB];
  verifier(Math.hypot(apres.x - avant.x, apres.z - avant.z) > 2, 'B pilote de nouveau son personnage (vu par A)');

  console.log('— 6. Même résultat chez les deux —');
  console.log(`   (temps restant : ${(await etat(A)).restant / 30 | 0} s — attente de la fin)`);
  const finA = await jusqua(A, (e) => e.phase === 'resultats' && e.resultat !== null, 320000, 'fin A');
  const finB = await jusqua(B, (e) => e.phase === 'resultats' && e.resultat !== null, 10000, 'fin B');
  verifier(JSON.stringify(finA.resultat) === JSON.stringify(finB.resultat), 'résultat identique chez A et B', JSON.stringify(finA.resultat?.scores));
  verifier(await A.isVisible('#ecran-resultats') && await B.isVisible('#ecran-resultats'), 'écran de résultats affiché');
  const titreA = await A.textContent('#titre-resultat');
  const titreB = await B.textContent('#titre-resultat');
  verifier(finA.resultat.gagnant === 'egalite' ? titreA === titreB : titreA !== titreB, 'titres cohérents (victoire/défaite)', `${titreA} / ${titreB}`);
  await A.screenshot({ path: `${CAPTURES}multi-resultats.png` });

  console.log('— 7. Revanche ensemble —');
  await A.click('#bouton-revanche');
  await jusqua(B, (e) => e.joueurs.find((j) => j.id === idA)?.pret === true, 5000, 'B voit le vote de A');
  verifier(/vote manquant/.test(await B.textContent('#attente-revanche')), 'B voit qu’il manque son vote');
  await B.click('#bouton-revanche');
  const r2A = await jusqua(A, (e) => e.phase === 'partie' && e.resultat === null && e.scores?.[0] === 0, 20000, 'revanche A');
  const r2B = await jusqua(B, (e) => e.phase === 'partie' && e.resultat === null, 20000, 'revanche B');
  verifier(r2A.phase === 'partie' && r2B.phase === 'partie', 'la revanche démarre chez les deux');
  verifier(JSON.stringify(r2A.scores) === '[0,0]' && JSON.stringify(r2A.objectifs) === '[0,0,0]', 'aucun état résiduel (scores, objectifs)');
  verifier(Math.abs(r2A.local.x - -36) < 0.5, 'A repart de son point de départ', r2A.local.x.toFixed(2));

  console.log('— 8. Départ d’un participant —');
  await B.keyboard.press('Escape');
  await B.click('#bouton-quitter-partie');
  const eA9 = await jusqua(A, (e) => e.joueurs.find((j) => j.id === idB)?.presence === 'parti', 10000, 'A voit B parti');
  verifier(eA9.joueurs.find((j) => j.id === idB)?.presence === 'parti', 'A voit B parti (remplacé par un bot)');
  const k = (await etat(A)).tick;
  await attendre(1000);
  verifier((await etat(A)).tick > k, 'la partie continue pour A');
  verifier(await B.isVisible('#ecran-accueil'), 'B revient à l’accueil');

  for (const p of [A, B]) verifier(p.erreursJs.length === 0, `aucune erreur JavaScript (${p.nomJoueur})`, p.erreursJs.join(' | '));
  if (!EXTERNE) verifier(journalServeur.some((l) => l.includes('"reprise"')), 'le serveur a journalisé les reprises');
  await Promise.all(navigateurs.slice(0, 2).map((n) => n.close()));
}

try {
  await principal();
} catch (e) {
  console.error(e);
  echecs++;
} finally {
  serveur?.kill('SIGTERM');
}
console.log(echecs === 0 ? '\nE2E multijoueur : tout est OK' : `\nE2E multijoueur : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
