// Protocole réseau partagé client ↔ serveur (JSON sur WebSocket).
// Aucun DOM, aucune dépendance Node : importé par le serveur, le client navigateur et les tests.
// Règle : tout message reçu d'un client est non fiable → validerMessageClient (clés connues seulement).

import { normaliserIntention } from '../sim/intention';

export const VERSION_PROTOCOLE = 1;
export const CHEMIN_WS = '/ws';
export const PORT_DEFAUT = 2567;
/** Taille maximale d'un message client (octets). Au-delà, la socket est fermée (1009) par le serveur. */
export const TAILLE_MAX_MESSAGE = 512;
export const JOUEURS_MIN = 2;
export const JOUEURS_MAX = 4;
export const NOM_MAX = 16;
export const LONGUEUR_CODE = 5;
/** Sans I, O, 0, 1 (ambigus à l'oral et à l'écran) : 32 symboles → 32⁵ ≈ 33,5 millions de codes. */
export const ALPHABET_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SEQ_MAX = 2 ** 31 - 1;

export type Camp = 'manifestants' | 'forces';
export const CAMPS: readonly Camp[] = ['manifestants', 'forces'];
export const NOM_CAMP: Readonly<Record<Camp, string>> = { manifestants: 'Manifestants', forces: "Forces de l'ordre" };

/** attente (salon) → compte (3 s) → partie → resultats → (revanche) compte → … */
export type Phase = 'attente' | 'compte' | 'partie' | 'resultats';

// ——————————————————————————————————————————— Client → serveur

export type MessageClient =
  | { t: 'creer'; v: number; nom: string; camp: Camp }
  | { t: 'rejoindre'; v: number; code: string; nom: string; camp?: Camp }
  | { t: 'reprendre'; v: number; code: string; jeton: string }
  | { t: 'profil'; nom?: string; camp?: Camp }
  /** Prêt dans le salon ; vote de revanche dans l'écran de résultats. */
  | { t: 'pret'; pret: boolean }
  | { t: 'demarrer' }
  /** Intention d'un pas : s = numéro de séquence croissant, a = action maintenue. */
  | { t: 'i'; s: number; dx: number; dz: number; a: boolean }
  | { t: 'quitter' }
  | { t: 'ping'; c: number };

export type TypeMessageClient = MessageClient['t'];

const CLES: Record<TypeMessageClient, { requises: string[]; facultatives: string[] }> = {
  creer: { requises: ['v', 'nom', 'camp'], facultatives: [] },
  rejoindre: { requises: ['v', 'code', 'nom'], facultatives: ['camp'] },
  reprendre: { requises: ['v', 'code', 'jeton'], facultatives: [] },
  profil: { requises: [], facultatives: ['nom', 'camp'] },
  pret: { requises: ['pret'], facultatives: [] },
  demarrer: { requises: [], facultatives: [] },
  i: { requises: ['s', 'dx', 'dz'], facultatives: ['a'] },
  quitter: { requises: [], facultatives: [] },
  ping: { requises: ['c'], facultatives: [] },
};

const estCamp = (v: unknown): v is Camp => v === 'manifestants' || v === 'forces';
const estEntier = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const chaineBornee = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/**
 * Valide un message client déjà décodé (JSON.parse). Renvoie null s'il est invalide :
 * type inconnu, clé manquante ou en trop, mauvais type, nombre non fini, chaîne trop longue.
 * Les intentions sont normalisées (longueur ≤ 1). Le nom n'est PAS nettoyé ici (voir nettoyerNom).
 */
export function validerMessageClient(brut: unknown): MessageClient | null {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return null;
  const o = brut as Record<string, unknown>;
  const t = o.t;
  if (typeof t !== 'string' || !Object.hasOwn(CLES, t)) return null;
  const regle = CLES[t as TypeMessageClient];
  for (const cle of Object.keys(o)) {
    if (cle !== 't' && !regle.requises.includes(cle) && !regle.facultatives.includes(cle)) return null;
  }
  for (const cle of regle.requises) if (!Object.hasOwn(o, cle)) return null;

  switch (t as TypeMessageClient) {
    case 'creer':
      if (!estEntier(o.v, 0, 1000) || !chaineBornee(o.nom, 64) || !estCamp(o.camp)) return null;
      return { t: 'creer', v: o.v, nom: o.nom, camp: o.camp };
    case 'rejoindre':
      if (!estEntier(o.v, 0, 1000) || !chaineBornee(o.code, 16) || !chaineBornee(o.nom, 64)) return null;
      if (o.camp !== undefined && !estCamp(o.camp)) return null;
      return o.camp === undefined
        ? { t: 'rejoindre', v: o.v, code: o.code, nom: o.nom }
        : { t: 'rejoindre', v: o.v, code: o.code, nom: o.nom, camp: o.camp };
    case 'reprendre':
      if (!estEntier(o.v, 0, 1000) || !chaineBornee(o.code, 16) || !chaineBornee(o.jeton, 64)) return null;
      return { t: 'reprendre', v: o.v, code: o.code, jeton: o.jeton };
    case 'profil': {
      if (o.nom !== undefined && !chaineBornee(o.nom, 64)) return null;
      if (o.camp !== undefined && !estCamp(o.camp)) return null;
      if (o.nom === undefined && o.camp === undefined) return null;
      const m: { t: 'profil'; nom?: string; camp?: Camp } = { t: 'profil' };
      if (o.nom !== undefined) m.nom = o.nom as string;
      if (o.camp !== undefined) m.camp = o.camp as Camp;
      return m;
    }
    case 'pret':
      return typeof o.pret === 'boolean' ? { t: 'pret', pret: o.pret } : null;
    case 'demarrer':
      return { t: 'demarrer' };
    case 'i': {
      if (!estEntier(o.s, 0, SEQ_MAX)) return null;
      if (typeof o.dx !== 'number' || typeof o.dz !== 'number') return null;
      if (!Number.isFinite(o.dx) || !Number.isFinite(o.dz)) return null;
      if (o.a !== undefined && typeof o.a !== 'boolean') return null;
      const n = normaliserIntention({ dx: o.dx, dz: o.dz, action: o.a === true });
      return { t: 'i', s: o.s, dx: n.dx, dz: n.dz, a: n.action };
    }
    case 'quitter':
      return { t: 'quitter' };
    case 'ping':
      return typeof o.c === 'number' && Number.isFinite(o.c) ? { t: 'ping', c: o.c } : null;
  }
}

/** Décode et valide un texte reçu ; null si JSON invalide ou message refusé. */
export function decoderMessageClient(texte: string): MessageClient | null {
  if (texte.length > TAILLE_MAX_MESSAGE) return null;
  try {
    return validerMessageClient(JSON.parse(texte));
  } catch {
    return null;
  }
}

/**
 * Nettoie un pseudonyme (texte non fiable) : normalisation NFC, suppression des caractères de contrôle,
 * de formatage (dont les inversions bidirectionnelles) et invisibles, espaces regroupés,
 * NOM_MAX caractères au plus. Renvoie '' si rien d'affichable ne reste.
 * L'affichage côté client se fait toujours par textContent, jamais en HTML.
 */
export function nettoyerNom(brut: string): string {
  const propre = brut
    .normalize('NFC')
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(propre).slice(0, NOM_MAX).join('').trim();
}

/** Met un code saisi en forme (majuscules, sans espaces ni tirets) ; null s'il est invalide. */
export function normaliserCode(brut: string): string | null {
  const code = brut.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== LONGUEUR_CODE) return null;
  for (const c of code) if (!ALPHABET_CODE.includes(c)) return null;
  return code;
}

// ——————————————————————————————————————————— Serveur → client

export type EtatPresence = 'connecte' | 'reconnexion' | 'parti';

export interface VueJoueur {
  id: string;
  nom: string;
  camp: Camp;
  /** Prêt (salon) ou vote de revanche (résultats). */
  pret: boolean;
  presence: EtatPresence;
  hote: boolean;
}

export interface VueSalon {
  code: string;
  phase: Phase;
  /** Numéro de la partie (1 = première, 2 = première revanche…). */
  partie: number;
  joueurs: VueJoueur[];
  /** Secondes restantes avant le début (phase compte), sinon 0. */
  compte: number;
  /** Ce qui empêche de démarrer (ou la revanche), null si l'hôte peut lancer. */
  attente: string | null;
  dureePartie: number;
}

export interface ParticipantVue {
  id: string;
  nom: string;
  camp: Camp;
  bot: boolean;
}

export interface ObjectifVue {
  id: string;
  nom: string;
  x: number;
  z: number;
  rayon: number;
}

/** 0 = neutre, 1 = manifestants, 2 = forces de l'ordre, 3 = contesté. */
export type EtatObjectif = 0 | 1 | 2 | 3;

export interface ResultatPartie {
  partie: number;
  gagnant: Camp | 'egalite';
  scores: Record<Camp, number>;
  participants: (ParticipantVue & { points: number })[];
}

/** État complet d'un personnage du joueur local (précision complète, pour la réconciliation). */
export type EtatLocal = [x: number, z: number, vx: number, vz: number, cap: number];
/** Personnage distant compact : position et cap arrondis, vitesse, action (0/1). */
export type EtatDistant = [x: number, z: number, cap: number, vitesse: number, action: 0 | 1];

export interface MessageEtat {
  t: 'etat';
  /** Tick serveur de cet instantané. */
  k: number;
  /** Dernière intention du destinataire prise en compte (−1 si aucune). */
  a: number;
  /** Personnage du destinataire (null s'il n'en a pas). */
  m: EtatLocal | null;
  /** Tous les autres personnages, par identifiant. */
  j: Record<string, EtatDistant>;
  /** Scores [manifestants, forces]. */
  s: [number, number];
  /** État de chaque objectif, dans l'ordre de `debut.objectifs`. */
  z: EtatObjectif[];
  /** Ticks restants. */
  r: number;
}

export type CodeErreur =
  | 'introuvable'
  | 'complet'
  | 'commencee'
  | 'invalide'
  | 'trop_rapide'
  | 'version'
  | 'jeton'
  | 'conditions'
  | 'non_hote'
  | 'serveur_plein'
  | 'limite'
  | 'interne';

export type MessageServeur =
  | { t: 'bienvenue'; v: number; id: string; code: string; jeton: string }
  | { t: 'salon'; salon: VueSalon }
  | { t: 'debut'; partie: number; duree: number; participants: ParticipantVue[]; objectifs: ObjectifVue[] }
  | MessageEtat
  | { t: 'fin'; resultat: ResultatPartie }
  | { t: 'erreur'; code: CodeErreur; message: string; fatal: boolean }
  | { t: 'pong'; c: number; k: number };

/** Codes de fermeture WebSocket propres au jeu (4000–4999). */
export const FERMETURE = {
  remplacee: 4001,
  invalides: 4002,
  salonFerme: 4004,
  abus: 4008,
  inactif: 4009,
  quitte: 4010,
  interne: 4011,
} as const;

export const MESSAGES_ERREUR: Readonly<Record<CodeErreur, string>> = {
  introuvable: 'Salon introuvable. Vérifiez le code (5 caractères).',
  complet: 'Ce salon est complet (4 joueurs maximum).',
  commencee: 'La partie a déjà commencé dans ce salon. Attendez la fin pour la revanche.',
  invalide: 'Message refusé par le serveur.',
  trop_rapide: 'Trop de messages envoyés : ralentissez.',
  version: 'Version du jeu différente de celle du serveur : rechargez la page.',
  jeton: 'Votre place dans ce salon a expiré.',
  conditions: 'La partie ne peut pas encore démarrer.',
  non_hote: "Seul l'hôte du salon peut lancer la partie.",
  serveur_plein: 'Serveur plein pour le moment. Réessayez dans quelques minutes.',
  limite: 'Trop de tentatives depuis votre connexion. Patientez une minute.',
  interne: 'Erreur du serveur : le salon a été fermé.',
};
