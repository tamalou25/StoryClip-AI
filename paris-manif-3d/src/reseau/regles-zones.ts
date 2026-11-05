// Règles PROVISOIRES pour le multijoueur : contrôle de trois points de rassemblement.
// Elles réutilisent tel quel le pas fixe de src/sim/ (déplacement + collisions) et y ajoutent
// camps, objectifs, scores et minuteur. À remplacer par les règles de la session gameplay
// via l'adaptateur ReglesPartie (voir docs/RESEAU.md, « Raccordements »).
//
// Un objectif est tenu par le camp majoritaire dans son cercle ; à égalité non nulle il est contesté ;
// vide, il reste au dernier camp qui l'a tenu. Chaque objectif tenu rapporte 1 point par seconde.

import type { Carte } from '../sim/carte';
import { CARTE_REPUBLIQUE } from '../sim/carte';
import { avancer, creerPersonnage, type Personnage } from '../sim/deplacement';
import type { Intention } from '../sim/intention';
import { INTENTION_NEUTRE } from '../sim/intention';
import { FREQUENCE, DT, etape as etapeMonde, type Monde } from '../sim/monde';
import type { Camp, EtatObjectif, ObjectifVue } from './protocole';
import type { ParticipantRegles, ReglesPartie, ScoresFinaux, VueJeu } from './regles';

export const OBJECTIFS_REPUBLIQUE: readonly ObjectifVue[] = Object.freeze([
  { id: 'A', nom: 'Allée ouest', x: -26, z: -8, rayon: 4 },
  { id: 'B', nom: 'Monument', x: 0, z: 9.5, rayon: 4 },
  { id: 'C', nom: 'Allée est', x: 24, z: -8, rayon: 4 },
]);

/** Départs : manifestants à l'ouest, forces de l'ordre à l'est, en ligne face au monument. */
const DEPARTS: Record<Camp, { x: number; cap: number }> = {
  manifestants: { x: -36, cap: -Math.PI / 2 },
  forces: { x: 36, cap: Math.PI / 2 },
};
const DECALAGES_Z = [-1.5, 1.5, -4.5, 4.5, -7.5, 7.5, 0, -10];

export interface EtatZones {
  monde: Monde;
  camps: Readonly<Record<string, Camp>>;
  actions: Readonly<Record<string, boolean>>;
  /** Propriétaire courant de chaque objectif (null = jamais tenu). */
  proprietaires: readonly (Camp | null)[];
  objectifs: readonly EtatObjectif[];
  /** Scores en ticks-objectifs (30 = 1 point). */
  ticksScore: Readonly<Record<Camp, number>>;
  ticksJoueur: Readonly<Record<string, number>>;
  restant: number;
}

const CODE_CAMP: Record<Camp, EtatObjectif> = { manifestants: 1, forces: 2 };

export function creerReglesZones(carte: Carte = CARTE_REPUBLIQUE, objectifs: readonly ObjectifVue[] = OBJECTIFS_REPUBLIQUE): ReglesPartie<EtatZones> {
  const deplacer = (p: Personnage, i: Intention): Personnage => avancer(p, i, DT, carte);

  return {
    nom: 'zones-provisoires',
    objectifs,
    deplacer,

    creer(participants: readonly ParticipantRegles[], dureeTicks: number): EtatZones {
      const personnages: Record<string, Personnage> = {};
      const camps: Record<string, Camp> = {};
      const rangs: Record<Camp, number> = { manifestants: 0, forces: 0 };
      const ticksJoueur: Record<string, number> = {};
      for (const p of participants) {
        const d = DEPARTS[p.camp];
        const z = DECALAGES_Z[rangs[p.camp]++ % DECALAGES_Z.length]!;
        personnages[p.id] = creerPersonnage(d.x, z, d.cap);
        camps[p.id] = p.camp;
        ticksJoueur[p.id] = 0;
      }
      return {
        monde: { tick: 0, personnages },
        camps,
        actions: {},
        proprietaires: objectifs.map(() => null),
        objectifs: objectifs.map(() => 0 as EtatObjectif),
        ticksScore: { manifestants: 0, forces: 0 },
        ticksJoueur,
        restant: Math.max(1, Math.floor(dureeTicks)),
      };
    },

    etape(etat: EtatZones, intentions: Readonly<Record<string, Intention>>, figes?: ReadonlySet<string>): EtatZones {
      if (etat.restant <= 0) return etat;
      const monde = etapeMonde(etat.monde, intentions, carte);
      const actions: Record<string, boolean> = {};
      for (const id of Object.keys(monde.personnages)) {
        if (figes?.has(id)) {
          monde.personnages[id] = etat.monde.personnages[id]!;
          actions[id] = etat.actions[id] ?? false;
        } else {
          actions[id] = intentions[id]?.action ?? false;
        }
      }

      const proprietaires = [...etat.proprietaires];
      const etats: EtatObjectif[] = [];
      const ticksScore = { ...etat.ticksScore };
      const ticksJoueur = { ...etat.ticksJoueur };
      objectifs.forEach((o, n) => {
        const dedans: Record<Camp, string[]> = { manifestants: [], forces: [] };
        for (const [id, p] of Object.entries(monde.personnages)) {
          if (Math.hypot(p.x - o.x, p.z - o.z) <= o.rayon) dedans[etat.camps[id]!].push(id);
        }
        const m = dedans.manifestants.length;
        const f = dedans.forces.length;
        if (m > f) proprietaires[n] = 'manifestants';
        else if (f > m) proprietaires[n] = 'forces';
        const conteste = m > 0 && m === f;
        const proprio = proprietaires[n] ?? null;
        etats.push(conteste ? 3 : proprio ? CODE_CAMP[proprio] : 0);
        if (proprio && !conteste) {
          ticksScore[proprio] += 1;
          for (const id of dedans[proprio]) ticksJoueur[id] = (ticksJoueur[id] ?? 0) + 1;
        }
      });

      return { monde, camps: etat.camps, actions, proprietaires, objectifs: etats, ticksScore, ticksJoueur, restant: etat.restant - 1 };
    },

    vue(etat: EtatZones): VueJeu {
      return {
        tick: etat.monde.tick,
        restant: etat.restant,
        personnages: etat.monde.personnages,
        actions: etat.actions,
        scores: { manifestants: points(etat.ticksScore.manifestants), forces: points(etat.ticksScore.forces) },
        objectifs: etat.objectifs,
      };
    },

    resultat(etat: EtatZones): ScoresFinaux | null {
      if (etat.restant > 0) return null;
      const scores = { manifestants: points(etat.ticksScore.manifestants), forces: points(etat.ticksScore.forces) };
      const gagnant = scores.manifestants > scores.forces ? 'manifestants' : scores.forces > scores.manifestants ? 'forces' : 'egalite';
      const pts: Record<string, number> = {};
      for (const [id, t] of Object.entries(etat.ticksJoueur)) pts[id] = points(t);
      return { gagnant, scores, points: pts };
    },

    intentionBot(etat: EtatZones, id: string): Intention {
      const p = etat.monde.personnages[id];
      const camp = etat.camps[id];
      if (!p || !camp || objectifs.length === 0) return INTENTION_NEUTRE;
      // Cible : l'objectif non tenu par son camp le plus proche, sinon le plus proche (pour le garder).
      let cible: ObjectifVue | null = null;
      let meilleure = Infinity;
      objectifs.forEach((o, n) => {
        const aPrendre = etat.objectifs[n] !== CODE_CAMP[camp];
        const d = Math.hypot(o.x - p.x, o.z - p.z) + (aPrendre ? 0 : 40);
        if (d < meilleure) { meilleure = d; cible = o; }
      });
      const o = cible as ObjectifVue | null;
      if (!o) return INTENTION_NEUTRE;
      let dx = o.x - p.x;
      let dz = o.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < o.rayon * 0.5) return INTENTION_NEUTRE;
      dx /= d;
      dz /= d;
      // Bloqué contre un obstacle (presque immobile loin de la cible) : contournement de 70° d'un côté fixe.
      if (Math.hypot(p.vx, p.vz) < 0.6 && etat.monde.tick > 10) {
        const s = id.charCodeAt(id.length - 1) % 2 === 0 ? 1 : -1;
        const a = (70 * Math.PI / 180) * s;
        const c = Math.cos(a);
        const si = Math.sin(a);
        [dx, dz] = [dx * c - dz * si, dx * si + dz * c];
      }
      return { dx, dz, action: false };
    },
  };
}

/** 1 point par seconde de tenue d'un objectif. */
function points(ticks: number): number {
  return Math.floor(ticks / FREQUENCE);
}

export const REGLES_ZONES = creerReglesZones();
