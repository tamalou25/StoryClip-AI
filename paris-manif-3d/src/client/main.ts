// Point d'entrée du client : écrans (accueil → camp → partie → résultat → revanche), boucle à pas fixe,
// rendu des acteurs, HUD, sons, pause et interruptions. La simulation vit dans src/sim/ ; ici on ne fait
// que lui transmettre l'intention du joueur et afficher son état.

import { CARTE_REPUBLIQUE as carte } from '../sim/carte';
import { normaliserIntention } from '../sim/intention';
import { DT, creerMonde, etape, type Monde } from '../sim/monde';
import { normaliserAngle } from '../sim/math';
import type { Acteur, Evenement } from '../sim/partie';
import { NOM_CAMP, type Camp } from '../sim/regles';
import { creerCamera as creerEtatCamera, distanceCible, directionMonde, DISTANCE, lisserDistance, majCamera, poseCamera } from './camera';
import { Commandes } from './commandes';
import { construireDecor, directionSoleil } from './decor';
import { Ecrans } from './ecrans';
import { Effets } from './effets';
import { Hud } from './hud';
import { passant, Personnage3D } from './personnage';
import { creerApplication, creerCamera, type Qualite } from './rendu';
import { chargerRessources, type Ressources } from './ressources';
import { Son } from './son';
import { SonsJeu } from './sons-jeu';
import { avancerTuto, creerTuto, type MemoireTuto } from './tuto';

const ID_JOUEUR = 'joueur';
const ROTATION_CLAVIER = 2.2; // rad/s
const PAS_MAX_PAR_IMAGE = 8; // couvre dt ≤ 0,25 s ; au-delà (gel), on abandonne le retard

const parametres = new URLSearchParams(location.search);
const modeTest = parametres.get('test') === '1';
const tactile = matchMedia('(pointer: coarse)').matches;
const qualiteDemandee = parametres.get('qualite');
let qualite: Qualite = qualiteDemandee === 'haute' || qualiteDemandee === 'basse' ? qualiteDemandee : tactile ? 'basse' : 'haute';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('scene');
const boutonJouer = el<HTMLButtonElement>('bouton-jouer');
const boutonQualite = el<HTMLButtonElement>('bouton-qualite');
const boutonSon = el<HTMLButtonElement>('bouton-son');
const boutonPause = el<HTMLButtonElement>('bouton-pause');
const affichageFps = el<HTMLSpanElement>('fps');
const bandeauPortrait = el<HTMLParagraphElement>('bandeau-portrait');
const aideClavier = el<HTMLParagraphElement>('aide-clavier');

// ——— Rendu et services ———
const app = creerApplication(canvas, qualite);

// ——— Chargement des ressources (textures, modèles, ciel) avant la construction de la scène ———
boutonJouer.disabled = true;
boutonJouer.textContent = 'Chargement… 0 %';
let res: Ressources;
const debutChargement = performance.now();
let dureeChargement = 0;
try {
  res = await chargerRessources(app, qualite, (p) => { boutonJouer.textContent = `Chargement… ${Math.round(p * 100)} %`; });
} catch (e) {
  boutonJouer.textContent = 'Chargement impossible';
  const avis = document.createElement('p');
  avis.className = 'sous-titre';
  avis.textContent = "Les ressources du jeu n'ont pas pu être chargées. Rechargez la page.";
  el('menu-titre').insertAdjacentElement('afterend', avis);
  throw e;
}
dureeChargement = performance.now() - debutChargement;
boutonJouer.disabled = false;
boutonJouer.textContent = 'Jouer';
boutonJouer.focus();

construireDecor(app, carte, qualite, res);
const ambianceSoleil = directionSoleil();
const TEINTES_PASSANTS: Record<string, string>[] = [
  { Red_Dark: '#6b3a32', LightBrown: '#3b3a3f' },
  { Red_Dark: '#2f4560', LightBrown: '#4a4036' },
  { Red_Dark: '#b9a27a', LightBrown: '#2a2e36' },
  { Red_Dark: '#3e4a3a', LightBrown: '#5a4a3a' },
];
for (const p of carte.passants) passant(app, res.passant, p.x, p.z, p.regard, TEINTES_PASSANTS[p.variante % TEINTES_PASSANTS.length]!, (p.variante * 0.37) % 1);
const { entite: cameraEntite } = creerCamera(app, qualite);
const effets = new Effets(app);
const son = new Son();
try { son.actif = localStorage.getItem('pm3d-son') !== 'coupe'; } catch { /* stockage indisponible */ }
const sonsJeu = new SonsJeu(son);
const hud = new Hud();
const ecrans = new Ecrans([el('hud'), el('commandes')]);
const commandes = new Commandes(el('commandes'));

// Teintes du modèle (matériaux Purple = sweat, LightBlue = pantalon, White = chaussures).
// Manifestants : couleurs variées et chaudes ; forces de l'ordre : uniforme sombre, lisible de loin.
type Teintes = Record<string, string>;
const VARIANTES_MANIF: Teintes[] = [
  { Purple: '#3c4350', LightBlue: '#2a3346', White: '#d9d5cc' },
  { Purple: '#8a3b2f', LightBlue: '#34435c', White: '#d8d4cb' },
  { Purple: '#b08a2f', LightBlue: '#3a3a4a', White: '#e6e2d8' },
  { Purple: '#2f6b5a', LightBlue: '#5a4a3a', White: '#cfcac0' },
  { Purple: '#6b4a7a', LightBlue: '#2b2b2b', White: '#d9d5cc' },
  { Purple: '#9a5a2f', LightBlue: '#2b3550', White: '#e0dcd2' },
  { Purple: '#5d6b4a', LightBlue: '#34435c', White: '#d8d4cb' },
];
const VARIANTES_ORDRE: Teintes[] = [
  { Purple: '#1f2a44', LightBlue: '#161c2b', White: '#111318' },
  { Purple: '#223050', LightBlue: '#161c2b', White: '#111318' },
  { Purple: '#1c2740', LightBlue: '#1a2030', White: '#141720' },
];

/** Modèles 3D par identifiant d'acteur, réutilisés d'une partie à l'autre. */
const modeles = new Map<string, { modele: Personnage3D; camp: Camp }>();
function modelePour(a: Acteur, indexCamp: number): Personnage3D {
  const existant = modeles.get(a.id);
  if (existant && existant.camp === a.camp) return existant.modele;
  if (existant) existant.modele.racine.destroy();
  const variantes = a.camp === 'manif' ? VARIANTES_MANIF : VARIANTES_ORDRE;
  const teintes = a.id === ID_JOUEUR ? variantes[0]! : variantes[(indexCamp + 1) % variantes.length]!;
  const modele = new Personnage3D(app, res.manifestant, teintes);
  if (a.id === ID_JOUEUR) modele.onPas = (intensite) => son.pas(intensite);
  modeles.set(a.id, { modele, camp: a.camp });
  return modele;
}

// ——— État de la partie ———
let campJoueur: Camp = ecrans.reglages.dernierCamp;
let monde: Monde = creerMonde(carte, { campJoueur, reglages: { effectifs: { manif: 1, ordre: 0 } } });
let precedent: Monde = monde;
let camera = creerEtatCamera(monde.acteurs[ID_JOUEUR]!.cap);
let distanceCamera = DISTANCE;
let fov = 55;
let accumulateur = 0;
let enJeu = false; // la simulation avance
let partieActive = false; // une partie est affichée (en cours ou en pause)
let derniereAction = false;
/** Spécial demandé mais pas encore vu par un pas de simulation (image sans pas : rien n'est perdu). */
let specialEnAttente = false;
let tuto: MemoireTuto = creerTuto();
let minuterieResultat: number | null = null;
let dernierDecompte = -1;
/** Point de vue imposé (crochet de test uniquement), pour contrôler le rendu sous plusieurs angles. */
let vueImposee: { position: { x: number; y: number; z: number }; cible: { x: number; y: number; z: number } } | null = null;

function appliquerReglagesClient(): void {
  const r = ecrans.reglages;
  son.reglerVolumes(r.volumeAmbiance, r.volumeEffets);
  effets.opaciteGaz = r.reduireEffets ? 0.14 : 0.28;
}
appliquerReglagesClient();
ecrans.onReglages = appliquerReglagesClient;

function nouvellePartie(camp: Camp): void {
  campJoueur = camp;
  ecrans.reglages.dernierCamp = camp;
  const dureeTest = modeTest ? Number(parametres.get('duree')) : 0;
  monde = creerMonde(carte, {
    campJoueur: camp,
    idJoueur: ID_JOUEUR,
    nomJoueur: 'Vous',
    reglages: {
      difficulte: ecrans.reglages.difficulte,
      duree: dureeTest > 0 ? dureeTest : ecrans.reglages.duree,
      graine: (Date.now() % 100000) + 1,
    },
  });
  precedent = monde;
  const joueur = monde.acteurs[ID_JOUEUR]!;
  camera = creerEtatCamera(joueur.cap);
  distanceCamera = DISTANCE;
  accumulateur = 0;
  tuto = creerTuto();
  dernierDecompte = -1;
  if (minuterieResultat !== null) { clearTimeout(minuterieResultat); minuterieResultat = null; }
  // Modèles : un par acteur ; ceux d'une partie précédente qui n'existent plus sont retirés.
  for (const [id, m] of modeles) if (!monde.acteurs[id]) { m.modele.racine.destroy(); modeles.delete(id); }
  const index: Record<Camp, number> = { manif: 0, ordre: 0 };
  for (const id of monde.ordre) {
    const a = monde.acteurs[id]!;
    const m = modelePour(a, index[a.camp]++);
    m.racine.enabled = true;
    m.majPose(a.x, a.z, a.cap, 0, false, 0.1);
  }
  effets.reinitialiser(monde);
  hud.demarrer(monde, camp);
  partieActive = true;
  aideClavier.hidden = tactile;
  aideClavier.classList.remove('estompe');
  window.setTimeout(() => aideClavier.classList.add('estompe'), 10000);
  reprendre();
  hud.annoncer(`${NOM_CAMP[camp]} : ${camp === 'manif' ? 'tenez les zones' : 'reprenez les zones'}`, camp, 2500);
}

function reprendre(): void {
  son.demarrer(); // geste utilisateur : l'audio peut démarrer
  appliquerReglagesClient();
  enJeu = true;
  accumulateur = 0;
  specialEnAttente = false;
  precedent = monde; // pas d'interpolation vers un état périmé à la reprise
  ecrans.montrer(null);
  commandes.activer(true);
  (document.activeElement as HTMLElement | null)?.blur(); // le clavier pilote le jeu, pas un bouton
}

function pause(): void {
  if (!enJeu) return;
  enJeu = false;
  commandes.activer(false);
  son.suspendre();
  if (monde.partie.phase === 'terminee') return; // l'écran de résultat arrive de lui-même
  ecrans.remplirPause(campJoueur, monde);
  ecrans.montrer('pause', 'bouton-reprendre');
}

function quitterPartie(): void {
  enJeu = false;
  partieActive = false;
  commandes.activer(false);
  son.suspendre();
  hud.cacher();
  for (const m of modeles.values()) m.modele.racine.enabled = false;
  if (minuterieResultat !== null) { clearTimeout(minuterieResultat); minuterieResultat = null; }
  ecrans.montrer('accueil', 'bouton-jouer');
}

function terminerPartie(): void {
  enJeu = false;
  commandes.activer(false);
  minuterieResultat = window.setTimeout(() => {
    minuterieResultat = null;
    hud.cacher();
    ecrans.remplirResultat(campJoueur, monde, ID_JOUEUR);
    ecrans.montrer('resultat', 'bouton-revanche');
  }, 2600);
}

// ——— Événements de la simulation → HUD, sons, effets ———
function traiterEvenements(evts: Evenement[]): void {
  if (evts.length === 0) return;
  const joueur = monde.acteurs[ID_JOUEUR]!;
  const distance = (x: number, z: number) => Math.hypot(x - joueur.x, z - joueur.z);
  hud.evenements(evts, monde, ID_JOUEUR);
  for (const e of evts) {
    switch (e.type) {
      case 'zone':
        if (e.camp) { sonsJeu.zonePrise(e.camp === campJoueur); effets.eclat(e.x, e.z, e.camp); }
        break;
      case 'disperse':
        sonsJeu.disperse(e.id === ID_JOUEUR);
        break;
      case 'retour':
        if (e.id === ID_JOUEUR) sonsJeu.retour();
        break;
      case 'gaz':
        sonsJeu.gaz(distance(e.x, e.z));
        break;
      case 'slogan':
        sonsJeu.slogan(distance(e.x, e.z));
        effets.eclat(e.x, e.z, 'manif');
        break;
      case 'fin':
        sonsJeu.fin(e.vainqueur === campJoueur);
        terminerPartie();
        break;
      default:
        break;
    }
  }
}

// ——— Boucle ———
app.on('update', (dtBrut: number) => {
  const dt = Math.min(dtBrut, 0.25);
  const c = commandes.lire();

  if (enJeu) {
    // Caméra (à la fréquence d'affichage) d'abord : la direction du joystick en dépend.
    const p = monde.acteurs[ID_JOUEUR]!;
    camera = majCamera(camera, {
      capPerso: p.cap,
      vitessePerso: Math.hypot(p.vx, p.vz),
      rotationManuelle: c.rotationGlisser + c.rotationClavier * ROTATION_CLAVIER * dt,
      recentrer: c.recentrer,
    }, dt);

    const dir = directionMonde(c.jx, c.jy, camera.lacet);
    if (c.special) specialEnAttente = true;
    const intention = normaliserIntention({ dx: dir.dx, dz: dir.dz, action: c.action, special: specialEnAttente });
    derniereAction = c.action;

    accumulateur += dt;
    let pas = 0;
    while (accumulateur >= DT && pas < PAS_MAX_PAR_IMAGE && enJeu) {
      precedent = monde;
      monde = etape(monde, { [ID_JOUEUR]: intention }, carte);
      accumulateur -= DT;
      pas++;
      traiterEvenements(monde.evenements);
    }
    if (pas === PAS_MAX_PAR_IMAGE) accumulateur = 0;
    if (pas > 0) specialEnAttente = false;

    // Décompte sonore des dix dernières secondes.
    const restant = Math.ceil(monde.partie.duree - monde.partie.temps);
    if (restant <= 10 && restant !== dernierDecompte && monde.partie.phase === 'en-cours') { dernierDecompte = restant; sonsJeu.decompte(restant <= 1); }

    if (ecrans.reglages.conseils) {
      const texte = avancerTuto(tuto, monde, monde.acteurs[ID_JOUEUR]!, campJoueur, dt);
      if (texte === 'fin') hud.effacerConseil();
      else if (texte) hud.conseiller(texte, 9000);
    }
  }

  if (partieActive) rendre(dt);
  compterImage(dtBrut);
});

function rendre(dt: number): void {
  const alpha = enJeu ? Math.min(1, accumulateur / DT) : 1;
  const joueurA = precedent.acteurs[ID_JOUEUR] ?? monde.acteurs[ID_JOUEUR]!;
  const joueurB = monde.acteurs[ID_JOUEUR]!;
  let xJ = joueurB.x;
  let zJ = joueurB.z;
  for (const id of monde.ordre) {
    const b = monde.acteurs[id]!;
    const a = precedent.acteurs[id] ?? b;
    const m = modeles.get(id)?.modele;
    if (!m) continue;
    const visible = b.etat === 'actif';
    m.racine.enabled = visible;
    effets.majMarqueur(id, b.x, b.z, visible, b.souffle / 100, id === ID_JOUEUR);
    if (!visible) continue;
    const x = a.x + (b.x - a.x) * alpha;
    const z = a.z + (b.z - a.z) * alpha;
    const cap = a.cap + normaliserAngle(b.cap - a.cap) * alpha;
    const vitesse = Math.hypot(a.vx + (b.vx - a.vx) * alpha, a.vz + (b.vz - a.vz) * alpha);
    const action = id === ID_JOUEUR ? derniereAction && enJeu : b.rallie;
    m.majPose(x, z, cap, enJeu ? vitesse : 0, action, enJeu ? dt : dt * 0.3);
    effets.majMarqueur(id, x, z, true, b.souffle / 100, id === ID_JOUEUR);
    if (id === ID_JOUEUR) { xJ = x; zJ = z; }
  }
  effets.maj(monde, enJeu ? dt : 0);

  const vitesseJ = Math.hypot(joueurA.vx + (joueurB.vx - joueurA.vx) * alpha, joueurA.vz + (joueurB.vz - joueurA.vz) * alpha);
  distanceCamera = lisserDistance(distanceCamera, distanceCible(xJ, zJ, camera.lacet, carte.obstacles), dt);
  const pose = vueImposee ?? poseCamera(xJ, zJ, camera.lacet, carte.obstacles, distanceCamera);
  cameraEntite.setPosition(pose.position.x, pose.position.y, pose.position.z);
  cameraEntite.lookAt(pose.cible.x, pose.cible.y, pose.cible.z);
  // Léger élargissement du champ en course : sensation de vitesse sans secousse.
  fov += (55 + Math.min(enJeu ? vitesseJ : 0, 6) * 0.9 - fov) * Math.min(1, dt * 3);
  cameraEntite.camera!.fov = fov;

  hud.maj(monde, joueurB, camera.lacet);
}

// ——— Images par seconde (moyenne sur 1 s) ———
const afficherFps = parametres.has('fps') || modeTest;
affichageFps.hidden = !afficherFps;
let images = 0;
let tempsFps = 0;
let fpsMesure = 0;
function compterImage(dt: number): void {
  images++;
  tempsFps += dt;
  if (tempsFps >= 1) {
    fpsMesure = images / tempsFps;
    if (afficherFps) affichageFps.textContent = `${Math.round(fpsMesure)} i/s · ${qualite}`;
    images = 0;
    tempsFps = 0;
  }
}

// ——— Menus ———
boutonQualite.textContent = `Qualité : ${qualite}`;
function majBoutonSon(): void {
  boutonSon.textContent = `Son : ${son.actif ? 'activé' : 'coupé'}`;
  boutonSon.setAttribute('aria-pressed', String(son.actif));
}
majBoutonSon();
boutonSon.addEventListener('click', () => {
  son.basculer();
  try { localStorage.setItem('pm3d-son', son.actif ? 'actif' : 'coupe'); } catch { /* sans effet */ }
  if (!enJeu) son.suspendre();
  majBoutonSon();
});
boutonQualite.addEventListener('click', () => {
  // Le changement de qualité recharge la page : simple et sans fuite de ressources GPU.
  const suivante: Qualite = qualite === 'haute' ? 'basse' : 'haute';
  parametres.set('qualite', suivante);
  location.search = parametres.toString();
});

boutonJouer.addEventListener('click', () => { sonsJeu.clic(); ecrans.montrer('camp', campJoueur === 'ordre' ? 'camp-ordre' : 'camp-manif'); });
el('bouton-retour-accueil').addEventListener('click', () => ecrans.montrer('accueil', 'bouton-jouer'));
for (const b of document.querySelectorAll<HTMLButtonElement>('.carte-camp')) {
  b.addEventListener('click', () => nouvellePartie(b.dataset.camp as Camp));
}
el('bouton-reprendre').addEventListener('click', reprendre);
el('bouton-recommencer').addEventListener('click', () => nouvellePartie(campJoueur));
el('bouton-quitter').addEventListener('click', quitterPartie);
el('bouton-revanche').addEventListener('click', () => nouvellePartie(campJoueur));
el('bouton-changer-camp').addEventListener('click', () => nouvellePartie(campJoueur === 'manif' ? 'ordre' : 'manif'));
el('bouton-menu-principal').addEventListener('click', quitterPartie);
boutonPause.addEventListener('click', pause);

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (enJeu) { e.preventDefault(); pause(); }
    else if (ecrans.courant === 'pause' && e.code === 'Escape') { e.preventDefault(); reprendre(); }
    else if (ecrans.courant === 'camp' && e.code === 'Escape') { e.preventDefault(); ecrans.montrer('accueil', 'bouton-jouer'); }
  }
});

// Interruptions : onglet masqué, perte de focus (appel, notification), fermeture.
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);
window.addEventListener('pagehide', pause);

// Rotation ou redimensionnement : on efface les contacts en cours (positions écran devenues fausses).
const portrait = matchMedia('(orientation: portrait)');
function majOrientation(): void {
  bandeauPortrait.hidden = !(tactile && portrait.matches);
  commandes.reinitialiser();
}
portrait.addEventListener('change', majOrientation);
window.addEventListener('resize', () => commandes.reinitialiser());
majOrientation();

ecrans.montrer('accueil', 'bouton-jouer');
app.start();

/** Triangles de toute la scène (couche World, sans élimination hors champ) : mesure de budget. */
function trianglesScene(): number {
  let t = 0;
  const monde = app.scene.layers.getLayerByName('World');
  for (const mi of monde?.meshInstances ?? []) t += (mi.mesh?.primitive[0]?.count ?? 0) / 3;
  return Math.round(t);
}

// Crochet de test (uniquement avec ?test=1) : lecture de l'état et accélération de la simulation.
if (modeTest) {
  (window as unknown as Record<string, unknown>).__pm3d = {
    app, // inspection de la scène dans les tests uniquement
    /** Mesures de rendu (moteur en version de production : certaines valeurs peuvent rester à 0). */
    mesures: () => {
      const st = app.stats as unknown as { drawCalls: Record<string, number>; frame: Record<string, number>; vram: { tex: number; vb: number; ib: number; texShadow: number } };
      return {
        chargementMs: Math.round(dureeChargement),
        appels: st.drawCalls.total, appelsOmbres: st.drawCalls.shadow, appelsSkinnes: st.drawCalls.skinned,
        primitives: st.frame.primitives, majMs: st.frame.updateTime, rendusMs: st.frame.renderTime,
        vramTexturesMo: +(st.vram.tex / 1048576).toFixed(1), vramGeometrieMo: +((st.vram.vb + st.vram.ib) / 1048576).toFixed(1),
        vramOmbresMo: +(st.vram.texShadow / 1048576).toFixed(1),
        trianglesScene: trianglesScene(),
      };
    },
    vue: (position: [number, number, number] | null, cible?: [number, number, number]) => {
      vueImposee = position && cible ? { position: { x: position[0], y: position[1], z: position[2] }, cible: { x: cible[0], y: cible[1], z: cible[2] } } : null;
    },
    etat: () => {
      const p = monde.acteurs[ID_JOUEUR]!;
      return {
        x: p.x, z: p.z, cap: p.cap, soleil: [ambianceSoleil.x, ambianceSoleil.y, ambianceSoleil.z], vitesse: Math.hypot(p.vx, p.vz), souffle: p.souffle, etatJoueur: p.etat, charges: p.charges, recharge: p.recharge, rallie: p.rallie,
        lacetCamera: camera.lacet, tick: monde.tick, enJeu, partieActive, ecran: ecrans.courant, camp: campJoueur,
        phase: monde.partie.phase, vainqueur: monde.partie.vainqueur, raison: monde.partie.raison, temps: monde.partie.temps,
        mobilisation: monde.partie.mobilisation, cible: monde.partie.cibleMobilisation,
        zones: monde.zones.map((z) => ({ id: z.id, tenue: z.tenue, controle: z.controle, presents: z.presents })),
        nuages: monde.nuages.length, acteurs: monde.ordre.length,
        actifs: monde.ordre.filter((id) => monde.acteurs[id]!.etat === 'actif').length,
        qualite, fps: fpsMesure, audio: son.etat(), appelsDessin: (app.stats as unknown as { drawCalls: { total: number } }).drawCalls.total,
      };
    },
    /** Avance la simulation de `secondes` d'un coup (joueur immobile) : pour tester une fin de partie. */
    accelerer: (secondes: number) => {
      if (!enJeu) return;
      const pas = Math.round(secondes / DT);
      for (let i = 0; i < pas && enJeu; i++) {
        precedent = monde;
        monde = etape(monde, {}, carte);
        traiterEvenements(monde.evenements);
      }
    },
  };
}
