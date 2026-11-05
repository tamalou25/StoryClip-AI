// Intelligence des bots : choix d'un rôle par utilité (toutes les `reflexion` secondes), navigation A*
// vers une cible, réactions immédiates (nuage, contact), déblocage quand ça n'avance plus.
// Pur et déterministe : tout le hasard passe par l'aléa du monde.

import { entre, tirer, type Alea } from './alea';
import type { Carte } from './carte';
import { avant, droite } from './math';
import type { Intention } from './intention';
import { dansZone, DEPARTS } from './objectifs';
import { trouverChemin, visible } from './navigation';
import type { Acteur, Zone } from './partie';
import * as R from './regles';
import { profilPour, type Monde } from './monde';

export type Role = 'capture' | 'defense' | 'poursuite' | 'suivi' | 'repli' | 'fuite' | 'attente';

export interface MemoireBot {
  /** Tick de la prochaine décision. */
  prochaine: number;
  role: Role;
  zone: string | null;
  cible: { x: number; z: number } | null;
  chemin: { x: number; z: number }[];
  /** Position et tick du dernier progrès (déblocage). */
  progres: { x: number; z: number; tick: number };
  debloquage: number;
  debloquageDir: { dx: number; dz: number };
  /** Décalage personnel dans une zone, pour ne pas s'empiler. */
  decalage: { x: number; z: number };
  special: boolean;
}

export function creerMemoire(alea: Alea): MemoireBot {
  const angle = entre(alea, 0, Math.PI * 2);
  const r = entre(alea, 1.5, 4.5);
  return {
    prochaine: Math.floor(tirer(alea) * 12),
    role: 'attente',
    zone: null,
    cible: null,
    chemin: [],
    progres: { x: 0, z: 0, tick: 0 },
    debloquage: 0,
    debloquageDir: { dx: 0, dz: 0 },
    decalage: { x: Math.cos(angle) * r, z: Math.sin(angle) * r },
    special: false,
  };
}

const FREQUENCE = 30;
const TICKS_SANS_PROGRES = 40; // ≈ 1,3 s
const PROGRES_MIN = 0.45; // m

interface Contexte {
  monde: Monde;
  moi: Acteur;
  allies: Acteur[];
  adversaires: Acteur[];
  carte: Carte;
  profil: R.ProfilBots;
  alea: Alea;
}

function d2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function plusProche<T extends { x: number; z: number }>(de: { x: number; z: number }, liste: T[]): T | null {
  let meilleur: T | null = null;
  let md = Infinity;
  for (const e of liste) {
    const d = d2(de, e);
    if (d < md) { md = d; meilleur = e; }
  }
  return meilleur;
}

function compterA(de: { x: number; z: number }, liste: Acteur[], portee: number): number {
  const p2 = portee * portee;
  let n = 0;
  for (const a of liste) if (d2(de, a) <= p2) n++;
  return n;
}

/** Le meneur d'un camp : le premier bot actif dans l'ordre. Il rassemble / forme le cordon. */
export function meneur(monde: Monde, camp: R.Camp): Acteur | null {
  for (const id of monde.ordre) {
    const a = monde.acteurs[id]!;
    if (a.camp === camp && a.bot && a.etat === 'actif') return a;
  }
  return null;
}

export function decider(monde: Monde, moi: Acteur, memoire: MemoireBot, carte: Carte, alea: Alea): { memoire: MemoireBot; intention: Intention } {
  const m: MemoireBot = { ...memoire };
  if (moi.etat === 'hors-jeu') {
    m.role = 'attente';
    m.chemin = [];
    m.cible = null;
    m.prochaine = monde.tick + 1;
    return { memoire: m, intention: { dx: 0, dz: 0, action: false } };
  }
  const profil = profilPour(monde.partie, moi);
  const actifs = monde.ordre.map((id) => monde.acteurs[id]!).filter((a) => a.etat === 'actif' && a.id !== moi.id);
  const ctx: Contexte = {
    monde, moi, carte, profil, alea,
    allies: actifs.filter((a) => a.camp === moi.camp),
    adversaires: actifs.filter((a) => a.camp !== moi.camp),
  };

  // Réactions immédiates (chaque pas) : un manifestant dans un nuage en sort tout de suite.
  const nuage = moi.camp === 'manif' ? monde.nuages.find((n) => d2(moi, n) <= (n.rayon + 1.2) ** 2) : undefined;
  if (nuage && m.role !== 'fuite') {
    m.role = 'fuite';
    m.prochaine = monde.tick + Math.round(profil.reflexion * FREQUENCE * 0.5);
    viser(ctx, m, sortieDeNuage(ctx, nuage));
  }

  if (monde.tick >= m.prochaine) {
    m.prochaine = monde.tick + Math.max(3, Math.round(profil.reflexion * FREQUENCE * entre(alea, 0.8, 1.2)));
    m.special = false;
    if (moi.camp === 'manif') deciderManifestant(ctx, m);
    else deciderPolicier(ctx, m);
  }

  const intention = suivreChemin(ctx, m);
  return { memoire: m, intention };
}

// ——————————————————————————————————————————————— Manifestant

function deciderManifestant(ctx: Contexte, m: MemoireBot): void {
  const { moi, monde, adversaires, allies, profil, alea } = ctx;
  const menace = plusProche(moi, adversaires);
  const dMenace = menace ? Math.sqrt(d2(moi, menace)) : Infinity;
  const policeProches = compterA(moi, adversaires, 6);
  const amisProches = compterA(moi, allies, 4);

  // Spécial : slogan quand on est en groupe et que ça chauffe (ou qu'un camarade faiblit).
  if (moi.recharge <= 0 && tirer(alea) < profil.usageSpecial) {
    const pres = allies.filter((a) => d2(moi, a) <= R.SLOGAN_PORTEE ** 2);
    const faiblit = pres.some((a) => a.souffle < 55) || moi.souffle < 55;
    if (pres.length >= 1 && faiblit && (policeProches > 0 || moi.auContact)) m.special = true;
  }

  // Repli : essoufflé et menacé → s'éloigner vers les camarades ou le départ.
  if (moi.souffle < profil.seuilRepli && dMenace < 7) {
    m.role = 'repli';
    viser(ctx, m, pointDeRepli(ctx));
    return;
  }
  if (m.role === 'repli' && moi.souffle < 70 && dMenace < 10) {
    viser(ctx, m, pointDeRepli(ctx));
    return;
  }

  // Suivi d'un meneur qui rassemble (joueur ou bot), s'il n'est pas trop loin.
  const chefs = allies.filter((a) => a.rallie && d2(moi, a) <= R.PORTEE_RALLIEMENT ** 2);
  const chef = plusProche(moi, chefs);
  if (chef && !(chef.bot && estMeneur(monde, moi))) {
    m.role = 'suivi';
    m.zone = null;
    const dir = avant(chef.cap);
    const lat = droite(chef.cap);
    // Derrière et de côté du meneur, selon son décalage personnel.
    const dist = 1.4 + Math.abs(m.decalage.x) * 0.5;
    const cote = m.decalage.z > 0 ? 1 : -1;
    viser(ctx, m, { x: chef.x - dir.x * dist + lat.x * cote * 0.9, z: chef.z - dir.z * dist + lat.z * cote * 0.9 }, 0.6);
    return;
  }

  // Pression : un policier isolé entre dans notre zone, et on est au moins deux en forme → on le fait reculer.
  // (Jamais de poursuite à travers la place : on ne quitte pas la zone pour ça.)
  const maZone = monde.zones.find((z) => z.id === m.zone && dansZone(moi.x, moi.z, z));
  if (menace && maZone && dMenace < 6 && moi.souffle > 55 && amisProches >= 1 && dansZone(menace.x, menace.z, maZone)) {
    const collegues = compterA(menace, adversaires, 4) - 1;
    const amisEnForme = allies.filter((a) => d2(moi, a) <= 36 && a.souffle > 45).length;
    if ((collegues === 0 && amisEnForme >= 1) || (collegues <= 1 && amisEnForme >= 3)) {
      m.role = 'poursuite';
      viser(ctx, m, { x: menace.x, z: menace.z });
      return;
    }
  }

  // Choix d'une zone par utilité.
  const zone = choisirZoneManif(ctx, m);
  m.role = 'capture';
  m.zone = zone.id;
  // Point dans la zone : décalage personnel, hors du socle (le lissage A* contourne de toute façon).
  const cible = pointDansZone(ctx, zone, m.decalage);
  // Dans la zone déjà ? On reste, en se repositionnant légèrement si des policiers approchent.
  if (dansZone(moi.x, moi.z, zone)) {
    if (menace && dMenace < 3.5 && amisProches < 2 && moi.souffle < 80) {
      // Esquive : se décaler à l'opposé du policier en restant dans la zone.
      const ux = (moi.x - menace.x) / dMenace;
      const uz = (moi.z - menace.z) / dMenace;
      const p = { x: moi.x + ux * 3, z: moi.z + uz * 3 };
      if (dansZone(p.x, p.z, zone)) { viser(ctx, m, p); return; }
    }
    viser(ctx, m, cible, 0.5);
    return;
  }
  viser(ctx, m, cible);
}

function estMeneur(monde: Monde, a: Acteur): boolean {
  return meneur(monde, a.camp)?.id === a.id;
}

function choisirZoneManif(ctx: Contexte, m: MemoireBot): Zone {
  const { monde, moi, allies, adversaires } = ctx;
  let meilleure = monde.zones[0]!;
  let meilleurScore = -Infinity;
  for (const z of monde.zones) {
    const dist = Math.sqrt(d2(moi, z));
    const amis = allies.filter((a) => dansZone(a.x, a.z, z) || (a.bot && monde.bots[a.id]?.zone === z.id)).length;
    const police = adversaires.filter((a) => d2(a, z) <= (z.rayon + 4) ** 2).length;
    const gaz = monde.nuages.some((n) => d2(n, z) <= (n.rayon + z.rayon * 0.5) ** 2);
    let score = 0;
    score += z.tenue === 'manif' ? 0.6 : (1 - z.controle) * 1.4; // zones à prendre ou à retourner
    score -= dist / 30;
    score += Math.min(amis, 3) * 0.35; // force du nombre
    score -= Math.max(0, police - amis) * 0.9; // ne pas foncer seul dans un groupe
    score -= amis >= 4 ? 1.2 : 0; // ne pas s'empiler
    score -= gaz ? 1.5 : 0;
    if (m.zone === z.id) score += 0.3; // constance
    if (score > meilleurScore) { meilleurScore = score; meilleure = z; }
  }
  return meilleure;
}

function pointDansZone(ctx: Contexte, zone: Zone, decalage: { x: number; z: number }): { x: number; z: number } {
  // Pour le monument, on vise l'anneau entre le socle et le bord.
  let x = zone.x + decalage.x;
  let z = zone.z + decalage.z;
  if (zone.id === 'monument') {
    const l = Math.hypot(decalage.x, decalage.z) || 1;
    const r = 6.2;
    x = zone.x + (decalage.x / l) * r;
    z = zone.z + (decalage.z / l) * r;
  }
  const lim = ctx.carte.limites;
  return { x: Math.max(lim.minX + 1, Math.min(lim.maxX - 1, x)), z: Math.max(lim.minZ + 1, Math.min(lim.maxZ - 1, z)) };
}

function pointDeRepli(ctx: Contexte): { x: number; z: number } {
  const { moi, allies, adversaires } = ctx;
  // Vers le groupe d'amis le plus proche loin des policiers, sinon vers le départ du camp.
  const surs = allies.filter((a) => compterA(a, adversaires, 5) === 0 && d2(a, moi) > 4);
  const ami = plusProche(moi, surs);
  if (ami) return { x: ami.x, z: ami.z };
  const d = DEPARTS[moi.camp];
  return { x: d.x + (moi.camp === 'manif' ? 4 : -4), z: moi.z * 0.5 };
}

function sortieDeNuage(ctx: Contexte, nuage: { x: number; z: number; rayon: number }): { x: number; z: number } {
  const { moi, carte } = ctx;
  let ux = moi.x - nuage.x;
  let uz = moi.z - nuage.z;
  const l = Math.hypot(ux, uz);
  if (l < 0.3) { ux = -1; uz = 0; } else { ux /= l; uz /= l; }
  // On préfère sortir côté opposé aux policiers si possible (côté manifestants = −x).
  if (ux > 0.3 && moi.camp === 'manif') { ux *= 0.4; }
  const lim = carte.limites;
  const dist = nuage.rayon + 2.5;
  let x = nuage.x + ux * dist;
  let z = nuage.z + uz * dist;
  x = Math.max(lim.minX + 1, Math.min(lim.maxX - 1, x));
  z = Math.max(lim.minZ + 1, Math.min(lim.maxZ - 1, z));
  return { x, z };
}

// ——————————————————————————————————————————————— Policier

function deciderPolicier(ctx: Contexte, m: MemoireBot): void {
  const { moi, monde, adversaires, allies, profil, alea } = ctx;
  const manifProches = adversaires.filter((a) => d2(moi, a) <= 5 * 5);
  const collegues = compterA(moi, allies, 4);
  const cible = plusProche(moi, adversaires);
  const dCible = cible ? Math.sqrt(d2(moi, cible)) : Infinity;

  // Gaz fictif : un groupe de manifestants devant, pas déjà gazé, assez loin pour ne pas se gêner.
  if (moi.recharge <= 0 && moi.charges > 0 && tirer(alea) < profil.usageSpecial) {
    const dir = avant(moi.cap);
    const point = { x: moi.x + dir.x * R.GAZ_PORTEE, z: moi.z + dir.z * R.GAZ_PORTEE };
    const touches = adversaires.filter((a) => d2(point, a) <= (R.GAZ_RAYON - 0.5) ** 2 && !a.dansGaz).length;
    const dejaGaze = monde.nuages.some((n) => d2(n, point) <= (n.rayon * 1.2) ** 2);
    if (touches >= 2 && !dejaGaze) m.special = true;
  }

  // Repli si débordé.
  if (moi.souffle < profil.seuilRepli && manifProches.length >= 2) {
    m.role = 'repli';
    viser(ctx, m, pointDeRepli(ctx));
    return;
  }
  if (m.role === 'repli' && moi.souffle < 65) {
    viser(ctx, m, pointDeRepli(ctx));
    return;
  }

  // Cordon : suivre un meneur qui forme un cordon (joueur ou bot) ; se placer à ses côtés.
  const chefs = allies.filter((a) => a.rallie && d2(moi, a) <= R.PORTEE_RALLIEMENT ** 2);
  const chef = plusProche(moi, chefs);
  const rang = chef ? rangDansCordon(monde, chef, moi) : 99;
  // Au plus trois suiveurs par cordon : les autres gardent les zones.
  if (chef && rang < 3 && !(chef.bot && estMeneur(monde, moi))) {
    m.role = 'suivi';
    const lat = droite(chef.cap);
    const cote = rang % 2 === 0 ? 1 : -1;
    const k = Math.floor(rang / 2) + 1;
    viser(ctx, m, { x: chef.x + lat.x * cote * k * 1.05, z: chef.z + lat.z * cote * k * 1.05 }, 0.6);
    return;
  }

  // Poursuite : manifestant isolé ou affaibli à portée, et on n'est pas seul contre plusieurs.
  if (cible && dCible < profil.perception * 0.6) {
    const soutiens = compterA(cible, adversaires, 4); // ses camarades autour de lui (lui compris)
    const nous = collegues + 1;
    const faible = cible.souffle < 45;
    if ((soutiens <= nous || faible) && dCible < 10) {
      m.role = 'poursuite';
      viser(ctx, m, { x: cible.x, z: cible.z });
      return;
    }
    if (soutiens > nous + 1 && dCible < 5) {
      // Trop nombreux : on recule vers les collègues pour reformer.
      m.role = 'attente';
      viser(ctx, m, pointDeRepli(ctx));
      return;
    }
  }

  // Défense d'une zone par utilité.
  const zone = choisirZoneOrdre(ctx, m);
  m.role = 'defense';
  m.zone = zone.id;
  const point = pointDansZone(ctx, zone, { x: m.decalage.x * 0.6, z: m.decalage.z * 0.6 });
  if (dansZone(moi.x, moi.z, zone)) {
    // Dans la zone : aller au contact du manifestant le plus proche dans la zone, sinon se poster.
    const dedans = adversaires.filter((a) => dansZone(a.x, a.z, zone));
    const c = plusProche(moi, dedans);
    if (c) { m.role = 'poursuite'; viser(ctx, m, { x: c.x, z: c.z }); return; }
    viser(ctx, m, point, 0.45);
    return;
  }
  viser(ctx, m, point);
}

function rangDansCordon(monde: Monde, chef: Acteur, moi: Acteur): number {
  let rang = 0;
  for (const id of monde.ordre) {
    if (id === moi.id) return rang;
    const a = monde.acteurs[id]!;
    if (a.id !== chef.id && a.camp === moi.camp && a.bot && a.etat === 'actif') rang++;
  }
  return rang;
}

function choisirZoneOrdre(ctx: Contexte, m: MemoireBot): Zone {
  const { monde, moi, allies, adversaires } = ctx;
  let meilleure = monde.zones[0]!;
  let meilleurScore = -Infinity;
  for (const z of monde.zones) {
    const dist = Math.sqrt(d2(moi, z));
    const collegues = allies.filter((a) => dansZone(a.x, a.z, z) || (a.bot && monde.bots[a.id]?.zone === z.id)).length;
    const manif = adversaires.filter((a) => d2(a, z) <= (z.rayon + 5) ** 2).length;
    let score = 0;
    score += z.tenue === 'manif' ? 1.6 : z.controle > 0 ? 1.0 : z.tenue === 'ordre' ? 0.2 : 0.6;
    score += Math.min(manif, 4) * 0.5; // là où sont les manifestants
    score -= dist / 30;
    score -= Math.max(0, collegues - manif) * 0.6; // pas tous au même endroit
    score -= collegues >= 3 && manif <= 1 ? 1 : 0;
    if (m.zone === z.id) score += 0.3;
    if (score > meilleurScore) { meilleurScore = score; meilleure = z; }
  }
  return meilleure;
}

// ——————————————————————————————————————————————— Navigation et suivi

/** Fixe une cible et calcule le chemin (seulement si la cible a bougé sensiblement). */
function viser(ctx: Contexte, m: MemoireBot, cible: { x: number; z: number }, _allure = 1): void {
  if (m.cible && d2(m.cible, cible) < 0.5 * 0.5 && m.chemin.length > 0) return;
  m.cible = cible;
  m.chemin = trouverChemin(ctx.carte, ctx.moi.x, ctx.moi.z, cible.x, cible.z);
  m.progres = { x: ctx.moi.x, z: ctx.moi.z, tick: ctx.monde.tick };
}

function suivreChemin(ctx: Contexte, m: MemoireBot): Intention {
  const { moi, monde, allies } = ctx;
  const action = doitRallier(ctx, m);
  const special = m.special;
  m.special = false;

  // Déblocage en cours : direction aléatoire quelques pas, puis on recalcule.
  if (m.debloquage > 0) {
    m.debloquage--;
    if (m.debloquage === 0) { m.chemin = []; m.cible = m.cible ? { ...m.cible } : null; if (m.cible) viserForce(ctx, m, m.cible); }
    return { dx: m.debloquageDir.dx, dz: m.debloquageDir.dz, action, special };
  }

  // Prochain point du chemin.
  while (m.chemin.length > 0) {
    const p = m.chemin[0]!;
    const seuil = m.chemin.length === 1 ? 0.6 : 0.9;
    if (d2(moi, p) <= seuil * seuil) m.chemin.shift();
    else break;
  }
  if (m.chemin.length === 0) {
    // Arrivé : on se tourne vers la menace la plus proche, immobile.
    return { dx: 0, dz: 0, action, special };
  }
  const p = m.chemin[0]!;
  let dx = p.x - moi.x;
  let dz = p.z - moi.z;
  let l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;

  // Séparation douce avec les alliés très proches (on ne se marche pas dessus).
  for (const a of allies) {
    const d = d2(moi, a);
    if (d < 1.1 * 1.1 && d > 1e-6) {
      const k = (1.1 - Math.sqrt(d)) * 0.8;
      dx += ((moi.x - a.x) / Math.sqrt(d)) * k;
      dz += ((moi.z - a.z) / Math.sqrt(d)) * k;
    }
  }
  l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  // Allure : course, sauf à l'approche de la cible finale.
  const dFin = m.cible ? Math.sqrt(d2(moi, m.cible)) : 10;
  const allure = dFin < 1.5 ? 0.35 : 1;

  // Déblocage : si on n'a pas progressé depuis ~1,3 s alors qu'on voulait avancer.
  if (d2(moi, m.progres) >= PROGRES_MIN * PROGRES_MIN) {
    m.progres = { x: moi.x, z: moi.z, tick: monde.tick };
  } else if (monde.tick - m.progres.tick > TICKS_SANS_PROGRES) {
    const angle = entre(ctx.alea, 0, Math.PI * 2);
    m.debloquage = 8 + Math.floor(tirer(ctx.alea) * 10);
    m.debloquageDir = { dx: Math.cos(angle), dz: Math.sin(angle) };
    m.progres = { x: moi.x, z: moi.z, tick: monde.tick };
  }
  return { dx: dx * allure, dz: dz * allure, action, special };
}

function viserForce(ctx: Contexte, m: MemoireBot, cible: { x: number; z: number }): void {
  m.cible = cible;
  m.chemin = trouverChemin(ctx.carte, ctx.moi.x, ctx.moi.z, cible.x, cible.z);
  if (m.chemin.length === 0 && !visible(ctx.moi.x, ctx.moi.z, cible.x, cible.z, ctx.carte.obstacles)) m.chemin = [cible];
}

/** Le meneur d'un camp maintient l'action quand des alliés sont proches et qu'il va au contact. */
function doitRallier(ctx: Contexte, m: MemoireBot): boolean {
  const { moi, monde, allies, adversaires } = ctx;
  if (!estMeneur(monde, moi)) return false;
  if (moi.souffle < 30) return false;
  const pres = compterA(moi, allies, R.PORTEE_RALLIEMENT);
  if (pres === 0) return false;
  if (moi.camp === 'ordre') {
    // Cordon quand des manifestants approchent et qu'on défend.
    return compterA(moi, adversaires, 14) >= 2 && (m.role === 'defense' || m.role === 'poursuite' || m.role === 'suivi');
  }
  // Rassembler en route vers une zone contestée.
  return m.role === 'capture' && compterA(moi, adversaires, 18) >= 1;
}
