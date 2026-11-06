// Adaptateur ReglesPartie au-dessus des règles complètes de la session gameplay (src/sim/monde.ts :
// souffle, contact, cordon, gaz fictif, mobilisation, bots à navigation). Aucune modification de
// src/sim/ n'est nécessaire : l'adaptateur convertit les camps, place les humains sur des acteurs,
// confie temporairement un humain absent à l'IA, et fige les humains dont l'intention est en retard.

import { creerMemoire, type MemoireBot } from '../sim/bots';
import { CARTE_REPUBLIQUE, type Carte } from '../sim/carte';
import { avancer, type Personnage } from '../sim/deplacement';
import type { Intention } from '../sim/intention';
import { creerMonde, DT, etape as etapeMonde, FREQUENCE, type Monde } from '../sim/monde';
import { ZONES_REPUBLIQUE } from '../sim/objectifs';
import type { Acteur } from '../sim/partie';
import type { Camp as CampSim, Reglages } from '../sim/regles';
import type { Camp, EtatObjectif, ExtraEtat, ObjectifVue } from './protocole';
import type { ControlePas, ParticipantRegles, ReglesPartie, ScoresFinaux, VueJeu } from './regles';

const VERS_SIM: Record<Camp, CampSim> = { manifestants: 'manif', forces: 'ordre' };
const DEPUIS_SIM: Record<CampSim, Camp> = { manif: 'manifestants', ordre: 'forces' };

export interface EtatManif {
  monde: Monde;
  /** Identifiants des participants humains (les autres acteurs sont des bots de la simulation). */
  humains: readonly string[];
  /** Mémoire d'IA de chaque humain, utilisée quand il est absent (reconnexion, parti). */
  memoires: Readonly<Record<string, MemoireBot>>;
}

export interface OptionsReglesManif {
  carte?: Carte;
  reglages?: Partial<Omit<Reglages, 'duree' | 'effectifs'>>;
  /** Graine de chaque nouvelle partie (défaut : compteur, déterministe). */
  graine?: () => number;
}

export function creerReglesManif(options: OptionsReglesManif = {}): ReglesPartie<EtatManif> {
  const carte = options.carte ?? CARTE_REPUBLIQUE;
  let compteur = 0;
  const graine = options.graine ?? (() => ++compteur);
  const objectifs: ObjectifVue[] = ZONES_REPUBLIQUE.map((z) => ({ id: z.id, nom: z.nom, x: z.x, z: z.z, rayon: z.rayon }));

  return {
    nom: 'manif-complet',
    objectifs,
    deplacer: (p: Personnage, i: Intention) => avancer(p, i, DT, carte),

    creer(participants: readonly ParticipantRegles[], dureeTicks: number): EtatManif {
      const effectifs: Record<CampSim, number> = { manif: 0, ordre: 0 };
      for (const p of participants) effectifs[VERS_SIM[p.camp]]++;
      // Partie « entre bots » de la bonne taille, puis chaque acteur est attribué à un participant.
      const base = creerMonde(carte, {
        campJoueur: null,
        reglages: { ...options.reglages, duree: dureeTicks / FREQUENCE, effectifs, graine: graine() },
      });
      const rangs: Record<CampSim, number> = { manif: 0, ordre: 0 };
      const acteurs: Record<string, Acteur> = {};
      const bots: Record<string, MemoireBot> = {};
      const memoires: Record<string, MemoireBot> = {};
      const ordre: string[] = [];
      for (const p of participants) {
        const camp = VERS_SIM[p.camp];
        const source = `${camp}-${rangs[camp]++}`;
        const a = base.acteurs[source]!;
        acteurs[p.id] = { ...a, id: p.id, bot: p.bot };
        ordre.push(p.id);
        if (p.bot) bots[p.id] = base.bots[source]!;
        else memoires[p.id] = base.bots[source]!;
      }
      return {
        monde: { ...base, acteurs, ordre, bots },
        humains: participants.filter((p) => !p.bot).map((p) => p.id),
        memoires,
      };
    },

    etape(etat: EtatManif, intentions: Readonly<Record<string, Intention>>, controle: ControlePas = {}): EtatManif {
      const auto = [...(controle.automatiques ?? [])].filter((id) => etat.humains.includes(id));
      let monde = etat.monde;
      if (auto.length > 0) {
        // Humains absents : acteurs « bot » pour ce pas, avec leur propre mémoire d'IA.
        const acteurs = { ...monde.acteurs };
        const bots = { ...monde.bots };
        for (const id of auto) {
          acteurs[id] = { ...acteurs[id]!, bot: true };
          bots[id] = etat.memoires[id] ?? creerMemoire({ etat: monde.alea.etat });
        }
        monde = { ...monde, acteurs, bots };
      }
      let suivant = etapeMonde(monde, intentions, carte);
      const memoires = { ...etat.memoires };
      if (auto.length > 0 || (controle.figes?.size ?? 0) > 0) {
        const acteurs = { ...suivant.acteurs };
        const bots = { ...suivant.bots };
        for (const id of auto) {
          memoires[id] = bots[id]!;
          delete bots[id];
          acteurs[id] = { ...acteurs[id]!, bot: false };
        }
        // Humains dont l'intention est en retard : position et vitesse inchangées pendant ce pas.
        for (const id of controle.figes ?? []) {
          const avant = etat.monde.acteurs[id];
          const apres = acteurs[id];
          if (avant && apres && apres.etat === 'actif') acteurs[id] = { ...apres, x: avant.x, z: avant.z, vx: avant.vx, vz: avant.vz, cap: avant.cap };
        }
        suivant = { ...suivant, acteurs, bots };
      }
      return { monde: suivant, humains: etat.humains, memoires };
    },

    vue(etat: EtatManif): VueJeu {
      const { monde } = etat;
      const actions: Record<string, boolean> = {};
      for (const id of monde.ordre) actions[id] = monde.acteurs[id]!.rallie;
      return {
        tick: monde.tick,
        restant: monde.partie.phase === 'terminee' ? 0 : Math.max(0, Math.round((monde.partie.duree - monde.partie.temps) * FREQUENCE)),
        personnages: monde.acteurs,
        actions,
        scores: scores(monde),
        objectifs: monde.zones.map((z): EtatObjectif => (z.presents.manif > 0 && z.presents.ordre > 0 ? 3 : z.tenue === 'manif' ? 1 : z.tenue === 'ordre' ? 2 : 0)),
      };
    },

    extra(etat: EtatManif, id: string): ExtraEtat {
      const { monde } = etat;
      const a = monde.acteurs[id];
      const x: ExtraEtat = {
        mobilisation: Math.min(1, monde.partie.mobilisation / monde.partie.cibleMobilisation),
        horsJeu: monde.ordre.filter((i) => monde.acteurs[i]!.etat === 'hors-jeu'),
        nuages: monde.nuages.map((n) => [n.id, Math.round(n.x * 10) / 10, Math.round(n.z * 10) / 10, Math.round(n.reste * 10) / 10, n.duree]),
      };
      if (a) {
        x.souffle = Math.round(a.souffle);
        if (a.etat === 'hors-jeu') x.retour = Math.ceil(a.retour);
        x.charges = a.camp === 'ordre' ? a.charges : a.recharge <= 0 ? 1 : 0;
        x.recharge = Math.ceil(a.recharge);
      }
      if (monde.partie.raison) x.raison = monde.partie.raison;
      return x;
    },

    resultat(etat: EtatManif): ScoresFinaux | null {
      const { partie, acteurs, ordre } = etat.monde;
      if (partie.phase !== 'terminee' || !partie.vainqueur) return null;
      const points: Record<string, number> = {};
      for (const id of ordre) points[id] = Math.floor(acteurs[id]!.stats.tempsEnZone);
      return { gagnant: DEPUIS_SIM[partie.vainqueur], scores: scores(etat.monde), points };
    },
  };
}

/** Manifestants : mobilisation (points de zone) ; forces de l'ordre : secondes de zone tenue. */
function scores(monde: Monde): Record<Camp, number> {
  return { manifestants: Math.floor(monde.partie.mobilisation), forces: Math.floor(monde.partie.tenueCumulee.ordre) };
}

export const REGLES_MANIF = creerReglesManif();
