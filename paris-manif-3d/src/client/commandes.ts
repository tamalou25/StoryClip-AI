// Commandes clavier et tactiles réunies en un seul état lu à chaque image.
// Clavier : on lit event.code (position physique) → ZQSD sur AZERTY, WASD sur QWERTY, et les flèches.
// Tactile : joystick flottant à gauche, glisser à droite pour tourner la caméra (facultatif), 2 gros boutons.
// Aucune interaction n'exige le survol ni le verrouillage du pointeur.

import { VITESSE_MARCHE, VITESSE_MAX } from '../sim/deplacement';

export interface EtatCommandes {
  /** Joystick : jx vers la droite, jy vers l'avant, longueur ≤ 1. */
  jx: number;
  jy: number;
  action: boolean;
  /** Bouton spécial maintenu (slogan / gaz fictif) ; la simulation ne réagit qu'au front montant. */
  special: boolean;
  /** Rotation caméra continue demandée au clavier (−1 gauche, +1 droite). */
  rotationClavier: number;
  /** Rotation caméra accumulée par glisser depuis la dernière lecture (radians). */
  rotationGlisser: number;
  /** Demande de recentrage depuis la dernière lecture. */
  recentrer: boolean;
}

const AVANT = ['KeyW', 'ArrowUp'];
const ARRIERE = ['KeyS', 'ArrowDown'];
const GAUCHE = ['KeyA', 'ArrowLeft'];
const DROITE = ['KeyD', 'ArrowRight'];
const ACTION = ['Space'];
const SPECIAL = ['KeyF', 'ControlLeft', 'ControlRight'];
const RECENTRER = ['KeyC'];
const CAM_GAUCHE = ['KeyQ']; // touche A sur AZERTY
const CAM_DROITE = ['KeyE'];
const MARCHE = ['ShiftLeft', 'ShiftRight'];
const FACTEUR_MARCHE = VITESSE_MARCHE / VITESSE_MAX; // ≈ 1,5 m/s
const TOUCHES_JEU = new Set([...AVANT, ...ARRIERE, ...GAUCHE, ...DROITE, ...ACTION, ...SPECIAL, ...RECENTRER, ...CAM_GAUCHE, ...CAM_DROITE, ...MARCHE]);

const RAYON_JOYSTICK = 56; // px
const ZONE_MORTE = 0.15;
const SENSIBILITE_GLISSER = 0.008; // rad/px

export class Commandes {
  private touches = new Set<string>();
  private joystick = { id: -1, ox: 0, oy: 0, jx: 0, jy: 0 };
  private glisser = { id: -1, x: 0 };
  private rotationGlisser = 0;
  private recentrerDemande = false;
  private actionTactile = false;
  private specialTactile = false;
  /** Un appui bref sur Spécial est retenu jusqu'à la prochaine lecture : rien n'est perdu à bas débit d'images. */
  private specialRetenu = false;
  private actif = false;
  private readonly relacheursBoutons: (() => void)[] = [];

  private readonly base: HTMLElement;
  private readonly bouton: HTMLElement;

  constructor(private readonly couche: HTMLElement) {
    this.base = couche.querySelector<HTMLElement>('.joystick-base')!;
    this.bouton = couche.querySelector<HTMLElement>('.joystick-bouton')!;

    window.addEventListener('keydown', (e) => this.toucheBas(e));
    window.addEventListener('keyup', (e) => {
      this.touches.delete(e.code);
      // macOS n'envoie pas le keyup des lettres jouées avec Cmd : on vide tout au relâchement de Cmd.
      if (e.key === 'Meta') this.touches.clear();
    });
    couche.addEventListener('contextmenu', (e) => e.preventDefault());

    couche.addEventListener('pointerdown', (e) => this.pointeurBas(e));
    couche.addEventListener('pointermove', (e) => this.pointeurBouge(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      couche.addEventListener(type, (e) => this.pointeurHaut(e));
    }

    this.brancherBouton('[data-commande="action"]', (bas) => (this.actionTactile = bas));
    this.brancherBouton('[data-commande="special"]', (bas) => { this.specialTactile = bas; if (bas) this.specialRetenu = true; });
    this.brancherBouton('[data-commande="recentrer"]', (bas) => {
      if (bas) this.recentrerDemande = true;
    });
  }

  /** Active ou suspend la lecture (pause, menu). Suspendre efface tout l'état. */
  activer(actif: boolean): void {
    this.actif = actif;
    if (!actif) this.reinitialiser();
  }

  /** Efface tout : à appeler sur perte de focus, onglet masqué, rotation, pointercancel. */
  reinitialiser(): void {
    this.touches.clear();
    this.joystick = { id: -1, ox: 0, oy: 0, jx: 0, jy: 0 };
    this.glisser = { id: -1, x: 0 };
    this.rotationGlisser = 0;
    this.recentrerDemande = false;
    this.actionTactile = false;
    this.specialTactile = false;
    this.specialRetenu = false;
    this.base.hidden = true;
    for (const relacher of this.relacheursBoutons) relacher();
  }

  /** Lit l'état courant et consomme les événements ponctuels (recentrage, glisser). */
  lire(): EtatCommandes {
    const t = (codes: string[]) => (codes.some((c) => this.touches.has(c)) ? 1 : 0);
    let jx = t(DROITE) - t(GAUCHE) + this.joystick.jx;
    let jy = t(AVANT) - t(ARRIERE) + this.joystick.jy;
    const l = Math.hypot(jx, jy);
    if (l > 1) { jx /= l; jy /= l; }
    if (t(MARCHE)) { jx *= FACTEUR_MARCHE; jy *= FACTEUR_MARCHE; }
    const etat: EtatCommandes = {
      jx,
      jy,
      action: t(ACTION) === 1 || this.actionTactile,
      special: t(SPECIAL) === 1 || this.specialTactile || this.specialRetenu,
      rotationClavier: t(CAM_DROITE) - t(CAM_GAUCHE),
      rotationGlisser: this.rotationGlisser,
      recentrer: this.recentrerDemande,
    };
    this.rotationGlisser = 0;
    this.recentrerDemande = false;
    this.specialRetenu = false;
    return etat;
  }

  private toucheBas(e: KeyboardEvent): void {
    if (!this.actif || !TOUCHES_JEU.has(e.code)) return;
    if (e.metaKey || e.altKey || (e.ctrlKey && !SPECIAL.includes(e.code))) return; // raccourcis du navigateur ou du système
    e.preventDefault(); // pas de défilement de page avec les flèches ou Espace
    if (RECENTRER.includes(e.code) && !e.repeat) this.recentrerDemande = true;
    if (SPECIAL.includes(e.code) && !e.repeat) this.specialRetenu = true;
    this.touches.add(e.code);
  }

  private pointeurBas(e: PointerEvent): void {
    if (!this.actif) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // clic droit / molette : ignorés
    const cible = e.target as HTMLElement;
    if (cible.closest('[data-commande]')) return; // géré par le bouton
    const gauche = e.clientX < window.innerWidth / 2;
    if (gauche && this.joystick.id === -1) {
      this.joystick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, jx: 0, jy: 0 };
      this.base.hidden = false;
      this.base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.bouton.style.transform = 'translate(0px, 0px)';
    } else if (!gauche && this.glisser.id === -1) {
      this.glisser = { id: e.pointerId, x: e.clientX };
    } else {
      return;
    }
    this.couche.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private pointeurBouge(e: PointerEvent): void {
    // Souris relâchée sans pointerup (menu contextuel, sortie de fenêtre) : on libère.
    if (e.pointerType === 'mouse' && e.buttons === 0) { this.pointeurHaut(e); return; }
    if (e.pointerId === this.joystick.id) {
      let dx = e.clientX - this.joystick.ox;
      let dy = e.clientY - this.joystick.oy;
      const l = Math.hypot(dx, dy);
      if (l > RAYON_JOYSTICK) { dx *= RAYON_JOYSTICK / l; dy *= RAYON_JOYSTICK / l; }
      this.bouton.style.transform = `translate(${dx}px, ${dy}px)`;
      const n = Math.min(l, RAYON_JOYSTICK) / RAYON_JOYSTICK;
      const echelle = n < ZONE_MORTE ? 0 : (n - ZONE_MORTE) / (1 - ZONE_MORTE) / (n || 1);
      this.joystick.jx = (dx / RAYON_JOYSTICK) * echelle;
      this.joystick.jy = (-dy / RAYON_JOYSTICK) * echelle;
    } else if (e.pointerId === this.glisser.id) {
      this.rotationGlisser += (e.clientX - this.glisser.x) * SENSIBILITE_GLISSER;
      this.glisser.x = e.clientX;
    }
  }

  private pointeurHaut(e: PointerEvent): void {
    if (e.pointerId === this.joystick.id) {
      this.joystick = { id: -1, ox: 0, oy: 0, jx: 0, jy: 0 };
      this.base.hidden = true;
    } else if (e.pointerId === this.glisser.id) {
      this.glisser = { id: -1, x: 0 };
    }
  }

  private brancherBouton(selecteur: string, rappel: (bas: boolean) => void): void {
    const el = this.couche.querySelector<HTMLElement>(selecteur)!;
    let id = -1;
    el.addEventListener('pointerdown', (e) => {
      if (!this.actif) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      id = e.pointerId;
      el.setPointerCapture(e.pointerId);
      el.classList.add('appuye');
      rappel(true);
    });
    const relacher = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      el.classList.remove('appuye');
      rappel(false);
    };
    this.relacheursBoutons.push(() => {
      if (id === -1) return;
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
      id = -1;
      el.classList.remove('appuye');
      rappel(false);
    });
    el.addEventListener('pointerup', relacher);
    el.addEventListener('pointercancel', relacher);
    el.addEventListener('lostpointercapture', relacher);
  }
}
