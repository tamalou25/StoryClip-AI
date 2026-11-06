// Prédiction locale + réconciliation du joueur local.
// Le client applique immédiatement ses intentions avec la MÊME fonction de déplacement que le serveur
// (ReglesPartie.deplacer). À chaque instantané, il repart de l'état serveur (autorité) et rejoue les
// intentions pas encore prises en compte (numéro > ack). L'écart éventuel n'est pas affiché d'un coup :
// il devient un décalage visuel qui s'amortit en ~100 ms (sauf grand écart : téléportation franche).

import type { Personnage } from '../sim/deplacement';
import type { Intention } from '../sim/intention';
import { lissage } from '../sim/math';

const ATTENTE_MAX = 90; // 3 s d'intentions non confirmées au plus
const ECART_TELEPORTATION = 2.5; // m
const AMORTISSEMENT = 14; // 1/s

export interface StatsCorrections {
  reconciliations: number;
  /** Corrections visibles (écart > 1 mm). */
  corrections: number;
  ecartMax: number;
  ecartTotal: number;
}

export class Predicteur {
  /** État prédit au dernier pas, et au pas précédent (pour l'interpolation de rendu). */
  etat: Personnage | null = null;
  precedent: Personnage | null = null;
  private enAttente: { s: number; intention: Intention }[] = [];
  private decalage = { x: 0, z: 0 };
  readonly stats: StatsCorrections = { reconciliations: 0, corrections: 0, ecartMax: 0, ecartTotal: 0 };

  constructor(private readonly deplacer: (p: Personnage, i: Intention) => Personnage) {}

  /** Applique localement une intention qui vient d'être envoyée au serveur avec le numéro s. */
  appliquer(s: number, intention: Intention): void {
    this.enAttente.push({ s, intention });
    if (this.enAttente.length > ATTENTE_MAX) this.enAttente.shift();
    if (!this.etat) return;
    this.precedent = this.etat;
    this.etat = this.deplacer(this.etat, intention);
  }

  /** Nouvel état serveur du joueur local, après prise en compte de l'intention n° ack. */
  reconcilier(ack: number, serveur: Personnage): void {
    this.enAttente = this.enAttente.filter((e) => e.s > ack);
    let p = serveur;
    for (const e of this.enAttente) p = this.deplacer(p, e.intention);
    this.stats.reconciliations++;
    const ancien = this.etat;
    if (!ancien) {
      this.etat = p;
      this.precedent = p;
      return;
    }
    const ex = ancien.x - p.x;
    const ez = ancien.z - p.z;
    const ecart = Math.hypot(ex, ez);
    if (ecart > 1e-3) {
      this.stats.corrections++;
      this.stats.ecartTotal += ecart;
      this.stats.ecartMax = Math.max(this.stats.ecartMax, ecart);
    }
    if (ecart > ECART_TELEPORTATION) {
      this.decalage = { x: 0, z: 0 };
      this.precedent = p;
    } else {
      // Le rendu ne saute pas : l'écart est absorbé par le décalage visuel, amorti ensuite.
      this.decalage = { x: this.decalage.x + ex, z: this.decalage.z + ez };
      if (this.precedent) this.precedent = { ...this.precedent, x: this.precedent.x - ex, z: this.precedent.z - ez };
    }
    this.etat = p;
  }

  /** Pose à afficher : interpolée entre les deux derniers pas (alpha ∈ [0, 1]) + décalage amorti. */
  pose(alpha: number, dtImage: number): { x: number; z: number; cap: number; vx: number; vz: number } | null {
    if (!this.etat) return null;
    const k = lissage(AMORTISSEMENT, dtImage);
    this.decalage.x -= this.decalage.x * k;
    this.decalage.z -= this.decalage.z * k;
    const a = this.precedent ?? this.etat;
    const b = this.etat;
    let dcap = b.cap - a.cap;
    if (dcap > Math.PI) dcap -= Math.PI * 2;
    else if (dcap < -Math.PI) dcap += Math.PI * 2;
    return {
      x: a.x + (b.x - a.x) * alpha + this.decalage.x,
      z: a.z + (b.z - a.z) * alpha + this.decalage.z,
      cap: a.cap + dcap * alpha,
      vx: a.vx + (b.vx - a.vx) * alpha,
      vz: a.vz + (b.vz - a.vz) * alpha,
    };
  }

  get nonConfirmees(): number {
    return this.enAttente.length;
  }

  reinitialiser(): void {
    this.etat = null;
    this.precedent = null;
    this.enAttente = [];
    this.decalage = { x: 0, z: 0 };
  }
}
