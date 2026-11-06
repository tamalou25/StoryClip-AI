// Point d'entrée du mode salon privé (multi.html).
// Le client n'envoie que des intentions ; tout ce qui est affiché (positions des autres, scores,
// objectifs, minuteur, résultat) vient du serveur. Le joueur local est prédit puis réconcilié.
//
// Paramètres d'URL : ?code=ABCDE (pré-remplit le code), ?serveur=wss://… (autre serveur),
// ?qualite=basse|haute, ?latence=150&gigue=30 (aller-retour simulé, essais), ?prediction=0, ?test=1.

import { CARTE_REPUBLIQUE as carte } from '../../sim/carte';
import { ClientReseau, MESSAGES_CLIENT, type Session } from '../../reseau/client';
import { CHEMIN_WS, NOM_CAMP, normaliserCode, type Camp, type ExtraEtat, type ResultatPartie, type VueSalon } from '../../reseau/protocole';
import { CAPACITES } from '../hud';
import { REGLES_MANIF } from '../../reseau/regles-manif';
import { FREQUENCE } from '../../sim/monde';
import { creerCamera as creerEtatCamera, directionMonde, distanceCible, DISTANCE, lisserDistance, majCamera, poseCamera } from '../camera';
import { Commandes } from '../commandes';
import { construireDecor } from '../decor';
import { passant } from '../personnage';
import { creerApplication, creerCamera, type Qualite } from '../rendu';
import { chargerRessources, type Ressources } from '../ressources';
import { SceneMulti } from './scene';

const ROTATION_CLAVIER = 2.2;
const parametres = new URLSearchParams(location.search);
const tactile = matchMedia('(pointer: coarse)').matches;
const q = parametres.get('qualite');
const qualite: Qualite = q === 'haute' || q === 'basse' ? q : tactile ? 'basse' : 'haute';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const $ = {
  menu: el('menu'),
  hud: el('hud'),
  accueil: el('ecran-accueil'),
  salon: el('ecran-salon'),
  resultats: el('ecran-resultats'),
  pause: el('ecran-pause'),
  erreur: el('erreur'),
  bandeau: el('bandeau-reseau'),
  compte: el('compte'),
  nom: el<HTMLInputElement>('champ-nom'),
  code: el<HTMLInputElement>('champ-code'),
  creer: el<HTMLButtonElement>('bouton-creer'),
  rejoindre: el<HTMLButtonElement>('bouton-rejoindre'),
  codeSalon: el('code-salon'),
  copier: el<HTMLButtonElement>('bouton-copier'),
  liste: el<HTMLUListElement>('liste-joueurs'),
  camp: el<HTMLButtonElement>('bouton-camp'),
  pret: el<HTMLButtonElement>('bouton-pret'),
  lancer: el<HTMLButtonElement>('bouton-lancer'),
  attente: el('attente'),
  quitter: el<HTMLButtonElement>('bouton-quitter'),
  titreResultat: el('titre-resultat'),
  scoresResultat: el('scores-resultat'),
  lignesResultat: el('lignes-resultat'),
  campRevanche: el<HTMLButtonElement>('bouton-camp-revanche'),
  revanche: el<HTMLButtonElement>('bouton-revanche'),
  attenteRevanche: el('attente-revanche'),
  quitterResultats: el<HTMLButtonElement>('bouton-quitter-resultats'),
  boutonMenuJeu: el<HTMLButtonElement>('bouton-menu-jeu'),
  reprendre: el<HTMLButtonElement>('bouton-reprendre'),
  quitterPartie: el<HTMLButtonElement>('bouton-quitter-partie'),
  scoreM: el('score-m'),
  scoreF: el('score-f'),
  minuteur: el('minuteur'),
  objectifs: el<HTMLOListElement>('objectifs'),
  reseau: el('reseau'),
  souffle: el('souffle-multi'),
  capacites: el('capacites-multi'),
  horsJeu: el('hors-jeu'),
  etiquetteSpecial: el('etiquette-special'),
};

// ——— Réseau ———
const urlServeur = parametres.get('serveur') ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${CHEMIN_WS}`;
const rtt = Number(parametres.get('latence') ?? 0);
const gigue = Number(parametres.get('gigue') ?? 0);
const stockage = {
  lire(): Session | null {
    try {
      const s = JSON.parse(sessionStorage.getItem('pm3d-session') ?? 'null') as Session | null;
      return s && typeof s.code === 'string' && typeof s.jeton === 'string' && typeof s.id === 'string' ? s : null;
    } catch { return null; }
  },
  ecrire(s: Session | null): void {
    try {
      if (s) sessionStorage.setItem('pm3d-session', JSON.stringify(s));
      else sessionStorage.removeItem('pm3d-session');
    } catch { /* stockage indisponible : pas de reprise après rechargement */ }
  },
};
const client = new ClientReseau({
  url: urlServeur,
  regles: REGLES_MANIF,
  stockage,
  prediction: parametres.get('prediction') !== '0',
  latenceMs: Number.isFinite(rtt) && rtt > 0 ? rtt / 2 : 0,
  gigueMs: Number.isFinite(gigue) && gigue > 0 ? gigue / 2 : 0,
});

// ——— Rendu ———
const canvas = el<HTMLCanvasElement>('scene');
const app = creerApplication(canvas, qualite);
app.start();
// Ressources (textures, modèles, ciel) chargées avant la scène ; créer/rejoindre attend la fin.
$.creer.disabled = true;
$.rejoindre.disabled = true;
const texteCreer = $.creer.textContent;
let res: Ressources;
try {
  res = await chargerRessources(app, qualite, (p) => { $.creer.textContent = `Chargement… ${Math.round(p * 100)} %`; });
} catch (e) {
  $.creer.textContent = 'Chargement impossible';
  $.erreur.hidden = false;
  $.erreur.textContent = 'Les ressources du jeu n’ont pas pu être chargées. Rechargez la page.';
  throw e;
}
$.creer.textContent = texteCreer;
$.creer.disabled = false;
$.rejoindre.disabled = false;
construireDecor(app, carte, qualite, res);
const TEINTES_PASSANTS: Record<string, string>[] = [
  { Red_Dark: '#6b3a32', LightBrown: '#3b3a3f' },
  { Red_Dark: '#2f4560', LightBrown: '#4a4036' },
  { Red_Dark: '#b9a27a', LightBrown: '#2a2e36' },
  { Red_Dark: '#3e4a3a', LightBrown: '#5a4a3a' },
];
for (const p of carte.passants) passant(app, res.passant, p.x, p.z, p.regard, TEINTES_PASSANTS[p.variante % TEINTES_PASSANTS.length]!, (p.variante * 0.37) % 1);
const { entite: cameraEntite } = creerCamera(app, qualite);
const scene = new SceneMulti(app, el('etiquettes'), res.manifestant);
try { if (localStorage.getItem('pm3d-reduire-effets') === '1') scene.opaciteGaz = 0.3; } catch { /* sans effet */ }
const commandes = new Commandes(el('commandes'));

let camera = creerEtatCamera(-Math.PI / 2);
let distanceCamera = DISTANCE;
let menuJeuOuvert = false;
let campChoisi: Camp = 'manifestants';
let posePrecedente = { x: -36, z: 0, cap: -Math.PI / 2, vitesse: 0 };

// ——— Écrans ———
type Ecran = 'accueil' | 'salon' | 'resultats' | 'pause' | 'aucun';
let ecranCourant: Ecran = 'accueil';
function montrer(ecran: Ecran): void {
  ecranCourant = ecran;
  $.accueil.hidden = ecran !== 'accueil';
  $.salon.hidden = ecran !== 'salon';
  $.resultats.hidden = ecran !== 'resultats';
  $.pause.hidden = ecran !== 'pause';
  const menuVisible = ecran !== 'aucun';
  $.menu.hidden = !menuVisible;
  $.hud.inert = menuVisible;
  el('commandes').inert = menuVisible;
  commandes.activer(!menuVisible && client.salon?.phase === 'partie');
  if (!menuVisible) (document.activeElement as HTMLElement | null)?.blur();
}

function erreur(texte: string | null): void {
  $.erreur.hidden = texte === null;
  $.erreur.textContent = texte ?? '';
}

function occupe(oui: boolean): void {
  $.creer.disabled = oui;
  $.rejoindre.disabled = oui;
}

/** Choisit l'écran d'après la phase du salon. */
function synchroniserEcran(): void {
  const s = client.salon;
  if (!s) { montrer('accueil'); return; }
  $.hud.hidden = !(s.phase === 'compte' || s.phase === 'partie');
  if (s.phase === 'attente') montrer('salon');
  else if (s.phase === 'resultats') montrer(client.resultat ? 'resultats' : 'salon');
  else montrer(menuJeuOuvert ? 'pause' : 'aucun');
}

function presenceTexte(p: VueSalon['joueurs'][number]): string {
  if (p.presence === 'reconnexion') return 'reconnexion…';
  if (p.presence === 'parti') return 'parti (bot)';
  return p.pret ? 'prêt' : 'pas prêt';
}

function majSalon(s: VueSalon): void {
  const moi = s.joueurs.find((j) => j.id === client.id);
  $.codeSalon.textContent = s.code;
  $.liste.replaceChildren(...s.joueurs.map((j) => {
    const li = document.createElement('li');
    li.className = `${j.camp}${j.id === client.id ? ' moi' : ''}${j.presence !== 'connecte' ? ' absent' : ''}`;
    const pastille = document.createElement('span');
    pastille.className = `pastille ${j.camp}`;
    pastille.title = NOM_CAMP[j.camp];
    const nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = j.hote ? `${j.nom} ★` : j.nom; // textContent : jamais de HTML venant d'un joueur
    const etat = document.createElement('span');
    etat.className = `etat${j.pret && j.presence === 'connecte' ? ' pret' : ''}`;
    etat.textContent = `${NOM_CAMP[j.camp]} · ${presenceTexte(j)}`;
    li.append(pastille, nom, etat);
    return li;
  }));
  if (moi) {
    campChoisi = moi.camp;
    $.pret.setAttribute('aria-pressed', String(moi.pret));
    $.pret.textContent = moi.pret ? 'Prêt ✓' : 'Je suis prêt';
    $.revanche.setAttribute('aria-pressed', String(moi.pret));
    $.revanche.textContent = moi.pret ? 'Revanche demandée ✓' : 'Revanche';
    $.camp.textContent = `Camp : ${NOM_CAMP[moi.camp]}`;
    $.campRevanche.textContent = `Camp : ${NOM_CAMP[moi.camp]}`;
  }
  const hote = moi?.hote === true;
  $.lancer.hidden = !hote || s.phase !== 'attente';
  $.lancer.disabled = s.attente !== null;
  const raison = s.attente ?? (hote ? 'Tout le monde est prêt : lancez la partie.' : 'Tout le monde est prêt : l’hôte (★) peut lancer.');
  $.attente.textContent = s.phase === 'resultats' && !client.resultat ? `${raison} (vous rejoignez pour la prochaine partie)` : raison;
  $.attenteRevanche.textContent = s.attente ?? '';
  if (s.phase === 'compte') {
    $.compte.hidden = false;
    $.compte.textContent = String(s.compte);
  } else {
    $.compte.hidden = true;
  }
  // Présence des humains dans la scène (reconnexion / parti → bot).
  for (const j of s.joueurs) scene.majPresence(j.id, j.nom, j.presence === 'connecte' ? null : presenceTexte(j));
  synchroniserEcran();
}

function majResultat(r: ResultatPartie): void {
  const monCamp = r.participants.find((p) => p.id === client.id)?.camp;
  $.titreResultat.textContent = r.gagnant === 'egalite' ? 'Égalité' : r.gagnant === monCamp ? `Victoire — ${NOM_CAMP[r.gagnant]}` : `Défaite — ${NOM_CAMP[r.gagnant]} gagnent`;
  $.scoresResultat.textContent = `Manifestants ${r.scores.manifestants} · ${r.scores.forces} Forces de l'ordre — partie n° ${r.partie}`;
  const lignes = [...r.participants].sort((a, b) => b.points - a.points).map((p) => {
    const tr = document.createElement('tr');
    for (const texte of [p.bot ? `${p.nom} (bot)` : p.nom, NOM_CAMP[p.camp], String(p.points)]) {
      const td = document.createElement('td');
      td.textContent = texte;
      tr.append(td);
    }
    if (p.id === client.id) tr.style.fontWeight = '700';
    return tr;
  });
  $.lignesResultat.replaceChildren(...lignes);
}

function formaterTemps(ticks: number): string {
  const s = Math.ceil(ticks / FREQUENCE);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ——— Événements réseau ———
client.evenements.connexion = (etat) => {
  occupe(etat === 'connexion');
  $.bandeau.hidden = etat !== 'reconnexion';
  if (etat === 'reconnexion') $.bandeau.textContent = MESSAGES_CLIENT.interrompue;
  if (etat === 'connexion') erreur(null);
  if (etat === 'hors_ligne' && !client.session) {
    scene.vider();
    $.hud.hidden = true;
    $.compte.hidden = true;
    montrer('accueil');
  }
};
client.evenements.salon = (s) => {
  erreur(null);
  const url = new URL(location.href);
  if (url.searchParams.get('code') !== s.code) {
    url.searchParams.set('code', s.code);
    history.replaceState(null, '', url);
  }
  majSalon(s);
};
client.evenements.debut = (info) => {
  scene.preparer(info.participants, info.objectifs, client.id);
  $.horsJeu.hidden = true;
  majExtra(undefined);
  $.objectifs.replaceChildren(...info.objectifs.map((o) => {
    const li = document.createElement('li');
    li.textContent = o.id;
    li.title = o.nom;
    li.dataset.etat = '0';
    return li;
  }));
  menuJeuOuvert = false;
  const moi = info.participants.find((p) => p.id === client.id);
  camera = creerEtatCamera(moi?.camp === 'forces' ? Math.PI / 2 : -Math.PI / 2);
};
client.evenements.etat = (m) => {
  $.scoreM.textContent = String(m.s[0]);
  $.scoreF.textContent = String(m.s[1]);
  $.minuteur.textContent = formaterTemps(m.r);
  m.z.forEach((z, i) => { const li = $.objectifs.children[i] as HTMLElement | undefined; if (li) li.dataset.etat = String(z); });
  majExtra(m.x);
  scene.majNuages(m.x?.nuages, m.k);
};

/** Compléments des règles complètes : souffle, hors-jeu, charges du spécial (absents avec d'autres règles). */
function majExtra(x: ExtraEtat | undefined): void {
  const souffle = x?.souffle;
  $.souffle.parentElement!.hidden = souffle === undefined;
  if (souffle !== undefined) {
    $.souffle.style.width = `${souffle}%`;
    $.souffle.classList.toggle('faible', souffle < 50 && souffle >= 25);
    $.souffle.classList.toggle('critique', souffle < 25);
  }
  const horsJeu = x?.retour !== undefined;
  $.horsJeu.hidden = !horsJeu || client.salon?.phase !== 'partie';
  if (horsJeu) $.horsJeu.textContent = `${monCamp() === 'forces' ? 'En repli' : 'Dispersé'} · retour dans ${x!.retour} s`;
  const camp = monCamp();
  if (x?.charges !== undefined && camp) {
    const c = CAPACITES[camp === 'forces' ? 'ordre' : 'manif'];
    $.capacites.textContent = camp === 'forces' ? `${c.special} : ${x.charges} charge${x.charges > 1 ? 's' : ''}` : x.charges > 0 ? `${c.special} prêt` : `${c.special} dans ${x.recharge} s`;
    $.etiquetteSpecial.textContent = c.special;
    el('commandes').querySelector('[data-commande="special"]')?.classList.toggle('indisponible', x.charges <= 0);
  } else {
    $.capacites.textContent = '';
  }
}
function monCamp(): Camp | null {
  return client.partie?.participants.find((p) => p.id === client.id)?.camp ?? null;
}
client.evenements.fin = (r) => {
  majResultat(r);
  menuJeuOuvert = false;
  synchroniserEcran();
};
client.evenements.erreur = (_code, message, fatal) => {
  if (_code === 'interrompue') return; // bandeau dédié
  erreur(message);
  if (fatal && !client.session) montrer('accueil');
};

// ——— Actions de l'interface ———
function nomSaisi(): string {
  const nom = $.nom.value.trim();
  try { localStorage.setItem('pm3d-nom', nom); } catch { /* sans effet */ }
  return nom;
}
function campSaisi(): Camp {
  return (document.querySelector<HTMLInputElement>('input[name="camp"]:checked')?.value as Camp | undefined) ?? 'manifestants';
}

$.creer.addEventListener('click', () => {
  erreur(null);
  client.creer(nomSaisi(), campSaisi());
});
function rejoindre(): void {
  erreur(null);
  const code = normaliserCode($.code.value);
  if (!code) {
    erreur('Code invalide : 5 caractères (lettres et chiffres, sans 0, 1, I ni O).');
    $.code.focus();
    return;
  }
  client.rejoindre(code, nomSaisi(), campSaisi());
}
$.rejoindre.addEventListener('click', rejoindre);
$.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') rejoindre(); });
$.copier.addEventListener('click', async () => {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('code', client.salon?.code ?? '');
  try {
    await navigator.clipboard.writeText(url.toString());
    $.copier.textContent = 'Lien copié ✓';
  } catch {
    $.copier.textContent = url.toString();
  }
  setTimeout(() => { $.copier.textContent = 'Copier le lien'; }, 2500);
});
const changerCamp = () => client.profil({ camp: campChoisi === 'manifestants' ? 'forces' : 'manifestants' });
$.camp.addEventListener('click', changerCamp);
$.campRevanche.addEventListener('click', changerCamp);
$.pret.addEventListener('click', () => client.pret($.pret.getAttribute('aria-pressed') !== 'true'));
$.revanche.addEventListener('click', () => client.pret($.revanche.getAttribute('aria-pressed') !== 'true'));
$.lancer.addEventListener('click', () => client.demarrer());
for (const b of [$.quitter, $.quitterResultats, $.quitterPartie]) {
  b.addEventListener('click', () => {
    client.quitter();
    scene.vider();
    $.hud.hidden = true;
    $.compte.hidden = true;
    menuJeuOuvert = false;
    montrer('accueil');
  });
}
function ouvrirMenuJeu(ouvert: boolean): void {
  if (client.salon?.phase !== 'partie' && client.salon?.phase !== 'compte') return;
  menuJeuOuvert = ouvert;
  synchroniserEcran();
  if (ouvert) $.reprendre.focus();
}
$.boutonMenuJeu.addEventListener('click', () => ouvrirMenuJeu(true));
$.reprendre.addEventListener('click', () => ouvrirMenuJeu(false));
window.addEventListener('keydown', (e) => {
  if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat && (client.salon?.phase === 'partie' || client.salon?.phase === 'compte')) {
    e.preventDefault();
    ouvrirMenuJeu(!menuJeuOuvert);
  }
});
// Onglet masqué : on lâche les commandes (le serveur arrête le personnage faute d'intentions).
document.addEventListener('visibilitychange', () => { if (document.hidden) commandes.reinitialiser(); });
window.addEventListener('blur', () => commandes.reinitialiser());

// ——— Boucle ———
let horlogePrecedente = performance.now();
app.on('update', (dtMoteur: number) => {
  // PlayCanvas plafonne son dt à 0,1 s : sur un appareil très lent, le jeu ralentirait et le client
  // enverrait moins d'intentions que le serveur n'en consomme. On mesure donc le temps réel.
  const maintenant = performance.now();
  const dtBrut = Math.max(dtMoteur, (maintenant - horlogePrecedente) / 1000);
  horlogePrecedente = maintenant;
  const dt = Math.min(dtBrut, 0.25);
  const c = commandes.lire();
  const enPartie = client.salon?.phase === 'partie' && !menuJeuOuvert;

  const pose = client.poseLocale(dt) ?? posePrecedente;
  posePrecedente = pose;
  camera = majCamera(camera, {
    capPerso: pose.cap,
    vitessePerso: pose.vitesse,
    rotationManuelle: enPartie ? c.rotationGlisser + c.rotationClavier * ROTATION_CLAVIER * dt : 0,
    recentrer: enPartie && c.recentrer,
  }, dt);
  const dir = enPartie ? directionMonde(c.jx, c.jy, camera.lacet) : { dx: 0, dz: 0 };
  client.avancer(dt, { dx: dir.dx, dz: dir.dz, action: enPartie && c.action, special: enPartie && c.special });

  if (client.partie && client.id) {
    scene.majPersonnage(client.id, pose.x, pose.z, pose.cap, pose.vitesse, client.actionLocale && enPartie, dt);
    for (const [id, e] of client.posesDistantes()) scene.majPersonnage(id, e.x, e.z, e.cap, e.vitesse, e.action, dt);
    scene.majObjectifs(client.dernierEtat?.z ?? [], dt);
  }

  distanceCamera = lisserDistance(distanceCamera, distanceCible(pose.x, pose.z, camera.lacet, carte.obstacles), dt);
  const p = poseCamera(pose.x, pose.z, camera.lacet, carte.obstacles, distanceCamera);
  cameraEntite.setPosition(p.position.x, p.position.y, p.position.z);
  cameraEntite.lookAt(p.cible.x, p.cible.y, p.cible.z);
  scene.majEtiquettes(cameraEntite.camera!);

  if (client.etatConnexion === 'en_ligne' && client.rtt > 0) $.reseau.textContent = `${Math.round(client.rtt)} ms`;
  images++;
  tempsImages += dtBrut;
  if (tempsImages >= 1) {
    fps = images / tempsImages;
    images = 0;
    tempsImages = 0;
  }
});
let images = 0;
let tempsImages = 0;
let fps = 0;

// ——— Démarrage ———
try { $.nom.value = localStorage.getItem('pm3d-nom') ?? ''; } catch { /* sans effet */ }
const codeUrl = parametres.get('code');
if (codeUrl) $.code.value = normaliserCode(codeUrl) ?? '';
montrer('accueil');
if (client.reprendre()) $.bandeau.hidden = true; // rechargement de page : on reprend sa place
else $.nom.focus();

// Crochet de test (?test=1) : lecture seule de l'état, plus quelques actions de pilotage.
if (parametres.get('test') === '1') {
  (window as unknown as Record<string, unknown>).__pm3dMulti = {
    etat: () => ({
      connexion: client.etatConnexion,
      id: client.id,
      code: client.salon?.code ?? null,
      phase: client.salon?.phase ?? null,
      joueurs: client.salon?.joueurs ?? [],
      ecran: ecranCourant,
      local: client.poseLocale(0),
      distants: Object.fromEntries(client.posesDistantes()),
      scores: client.dernierEtat?.s ?? null,
      objectifs: client.dernierEtat?.z ?? null,
      restant: client.dernierEtat?.r ?? null,
      tick: client.dernierEtat?.k ?? null,
      resultat: client.resultat,
      rtt: client.rtt,
      fps,
      corrections: client.statsCorrections,
      erreur: $.erreur.hidden ? null : $.erreur.textContent,
      bandeau: $.bandeau.hidden ? null : $.bandeau.textContent,
    }),
    couper: () => client.couper(),
  };
}
