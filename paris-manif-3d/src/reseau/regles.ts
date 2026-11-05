// Adaptateur entre le réseau et les règles du jeu.
// Le serveur (salons, entrées, envois) et le client (prédiction) ne connaissent QUE cette interface :
// on peut remplacer les règles provisoires (regles-zones.ts) par celles de la session gameplay
// sans toucher au transport. Les règles doivent être pures et déterministes (aucun DOM, aucune horloge).

import type { Personnage } from '../sim/deplacement';
import type { Intention } from '../sim/intention';
import type { Camp, EtatObjectif, ObjectifVue } from './protocole';

export interface ParticipantRegles {
  id: string;
  camp: Camp;
  /** Bot de complément (les humains partis sont aussi pilotés par intentionBot, sans changer de statut ici). */
  bot: boolean;
}

/** Vue publique d'un état de jeu : ce que le serveur diffuse. */
export interface VueJeu {
  tick: number;
  /** Ticks restants avant la fin. */
  restant: number;
  personnages: Readonly<Record<string, Personnage>>;
  /** Action maintenue au dernier pas (animation). */
  actions: Readonly<Record<string, boolean>>;
  scores: Readonly<Record<Camp, number>>;
  objectifs: readonly EtatObjectif[];
}

export interface ScoresFinaux {
  gagnant: Camp | 'egalite';
  scores: Record<Camp, number>;
  /** Contribution de chaque participant (même unité que les scores). */
  points: Record<string, number>;
}

export interface ReglesPartie<E> {
  readonly nom: string;
  readonly objectifs: readonly ObjectifVue[];
  /** Nouvel état complet : aucune donnée n'est conservée d'une partie à l'autre. */
  creer(participants: readonly ParticipantRegles[], dureeTicks: number): E;
  /**
   * Un pas fixe (DT). Un participant absent de `intentions` reçoit l'intention neutre.
   * Les participants de `figes` ne bougent pas pendant ce pas (leur intention n'est pas encore arrivée) :
   * chaque intention reçue correspond ainsi à exactement un pas, ce qui rend la prédiction exacte.
   */
  etape(etat: E, intentions: Readonly<Record<string, Intention>>, figes?: ReadonlySet<string>): E;
  vue(etat: E): VueJeu;
  /** Non nul quand la partie est terminée. */
  resultat(etat: E): ScoresFinaux | null;
  /** Intention d'un participant piloté par le serveur (bot, joueur parti ou en reconnexion). */
  intentionBot(etat: E, id: string): Intention;
  /** Déplacement d'un personnage pour un pas : utilisé tel quel par la prédiction locale du client. */
  deplacer(p: Personnage, intention: Intention): Personnage;
}
