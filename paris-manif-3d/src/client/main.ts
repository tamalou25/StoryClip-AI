// Point d'entrée du client : boucle à pas fixe, menu, pause et interruptions.

import * as pc from 'playcanvas';
import { CARTE_REPUBLIQUE as carte } from '../sim/carte';
import { normaliserIntention } from '../sim/intention';
import { DT, creerMonde, etape, type Monde } from '../sim/monde';
import { normaliserAngle } from '../sim/math';
import { creerCamera, directionMonde, majCamera, poseCamera } from './camera';
import { Commandes } from './commandes';
import { construireDecor, creerApplication, ModelePersonnage, type Qualite } from './rendu';

const ID_JOUEUR = 'joueur';
const ROTATION_CLAVIER = 2.2; // rad/s
const PAS_MAX_PAR_IMAGE = 8; // couvre dt ≤ 0,25 s ; au-delà (gel), on abandonne le retard

const parametres = new URLSearchParams(location.search);
const tactile = matchMedia('(pointer: coarse)').matches;
const qualiteDemandee = parametres.get('qualite');
let qualite: Qualite = qualiteDemandee === 'haute' || qualiteDemandee === 'basse' ? qualiteDemandee : tactile ? 'basse' : 'haute';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('scene');
const menu = el<HTMLDivElement>('menu');
const boutonJouer = el<HTMLButtonElement>('bouton-jouer');
const boutonQualite = el<HTMLButtonElement>('bouton-qualite');
const boutonPause = el<HTMLButtonElement>('bouton-pause');
const affichageFps = el<HTMLSpanElement>('fps');
const bandeauPortrait = el<HTMLParagraphElement>('bandeau-portrait');

const app = creerApplication(canvas, qualite);
construireDecor(app, carte, qualite);
const modele = new ModelePersonnage(app, '#d8572a', qualite === 'haute');

const cameraEntite = new pc.Entity('camera');
cameraEntite.addComponent('camera', { clearColor: new pc.Color(0.62, 0.74, 0.86), fov: 60, nearClip: 0.1, farClip: 250 });
app.root.addChild(cameraEntite);

const commandes = new Commandes(el('commandes'));

let monde: Monde = creerMonde(carte, [ID_JOUEUR]);
let precedent: Monde = monde;
let camera = creerCamera(monde.personnages[ID_JOUEUR]!.cap);
let accumulateur = 0;
let enJeu = false;
let derniereAction = false;

// ——— Boucle ———
app.on('update', (dtBrut: number) => {
  const dt = Math.min(dtBrut, 0.25);
  const c = commandes.lire();

  if (enJeu) {
    // Caméra (à la fréquence d'affichage) d'abord : la direction du joystick en dépend.
    const p = monde.personnages[ID_JOUEUR]!;
    camera = majCamera(camera, {
      capPerso: p.cap,
      vitessePerso: Math.hypot(p.vx, p.vz),
      rotationManuelle: c.rotationGlisser + c.rotationClavier * ROTATION_CLAVIER * dt,
      recentrer: c.recentrer,
    }, dt);

    const dir = directionMonde(c.jx, c.jy, camera.lacet);
    const intention = normaliserIntention({ dx: dir.dx, dz: dir.dz, action: c.action });
    derniereAction = c.action;

    accumulateur += dt;
    let pas = 0;
    while (accumulateur >= DT && pas < PAS_MAX_PAR_IMAGE) {
      precedent = monde;
      monde = etape(monde, { [ID_JOUEUR]: intention }, carte);
      accumulateur -= DT;
      pas++;
    }
    if (pas === PAS_MAX_PAR_IMAGE) accumulateur = 0;
  }

  // Rendu interpolé entre les deux derniers pas.
  const alpha = enJeu ? accumulateur / DT : 1;
  const a = precedent.personnages[ID_JOUEUR]!;
  const b = monde.personnages[ID_JOUEUR]!;
  const x = a.x + (b.x - a.x) * alpha;
  const z = a.z + (b.z - a.z) * alpha;
  const cap = a.cap + normaliserAngle(b.cap - a.cap) * alpha;
  modele.majPose(x, z, cap, enJeu ? Math.hypot(b.vx, b.vz) : 0, derniereAction && enJeu, dt);

  const pose = poseCamera(x, z, camera.lacet, carte.obstacles);
  cameraEntite.setPosition(pose.position.x, pose.position.y, pose.position.z);
  cameraEntite.lookAt(pose.cible.x, pose.cible.y, pose.cible.z);

  compterImage(dtBrut);
});

// ——— Images par seconde (moyenne sur 1 s) ———
let images = 0;
let tempsFps = 0;
let fpsMesure = 0;
function compterImage(dt: number): void {
  images++;
  tempsFps += dt;
  if (tempsFps >= 1) {
    fpsMesure = images / tempsFps;
    affichageFps.textContent = `${Math.round(fpsMesure)} i/s · ${qualite}`;
    images = 0;
    tempsFps = 0;
  }
}

// ——— Menu, pause, interruptions ———
function majBoutonQualite(): void {
  boutonQualite.textContent = `Qualité : ${qualite}`;
}
majBoutonQualite();

const hud = document.querySelector<HTMLElement>('.hud')!;
const coucheCommandes = el<HTMLDivElement>('commandes');
/** Menu ouvert : l'arrière-plan est inerte (ni focus clavier ni toucher). */
function afficherMenu(visible: boolean): void {
  menu.hidden = !visible;
  hud.inert = visible;
  coucheCommandes.inert = visible;
}
afficherMenu(true);

function jouer(): void {
  enJeu = true;
  accumulateur = 0;
  precedent = monde; // pas d'interpolation vers un état périmé à la reprise
  afficherMenu(false);
  commandes.activer(true);
  (document.activeElement as HTMLElement | null)?.blur(); // le clavier pilote le jeu, pas un bouton
}

function pause(): void {
  if (!enJeu) return;
  enJeu = false;
  commandes.activer(false);
  boutonJouer.textContent = 'Reprendre';
  afficherMenu(true);
  boutonJouer.focus();
}

boutonJouer.addEventListener('click', jouer);
boutonPause.addEventListener('click', pause);
boutonQualite.addEventListener('click', () => {
  // Le changement de qualité recharge la page : simple et sans fuite de ressources GPU.
  const suivante: Qualite = qualite === 'haute' ? 'basse' : 'haute';
  parametres.set('qualite', suivante);
  location.search = parametres.toString();
});

window.addEventListener('keydown', (e) => {
  if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
    if (enJeu) { e.preventDefault(); pause(); }
    else if (e.code === 'Escape' && boutonJouer.textContent === 'Reprendre') { e.preventDefault(); jouer(); }
  }
});

// Interruptions : onglet masqué, perte de focus (appel, notification), fermeture.
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);
window.addEventListener('pagehide', pause);

// Rotation : on efface les contacts en cours (positions écran devenues fausses).
const portrait = matchMedia('(orientation: portrait)');
function majOrientation(): void {
  bandeauPortrait.hidden = !(tactile && portrait.matches);
  commandes.reinitialiser();
}
portrait.addEventListener('change', majOrientation);
majOrientation();

app.start();

// Crochet de test (uniquement avec ?test=1) : lecture seule de l'état.
if (parametres.get('test') === '1') {
  (window as unknown as Record<string, unknown>).__pm3d = {
    etat: () => {
      const p = monde.personnages[ID_JOUEUR]!;
      return { x: p.x, z: p.z, cap: p.cap, vitesse: Math.hypot(p.vx, p.vz), lacetCamera: camera.lacet, tick: monde.tick, enJeu, qualite, fps: fpsMesure };
    },
  };
}
