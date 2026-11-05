// Introduction interactive : quelques conseils affichés au bon moment, validés par les actes du joueur.
// Logique pure (testable) : `avancer` renvoie le conseil à afficher, s'il change.

import type { Monde } from '../sim/monde';
import { dansZone } from '../sim/objectifs';
import type { Acteur } from '../sim/partie';
import type { Camp } from '../sim/regles';

export interface EtapeTuto {
  id: string;
  texte: string;
  /** Vrai quand l'étape est accomplie. */
  fait: (monde: Monde, joueur: Acteur, m: MemoireTuto) => boolean;
  /** Délai d'affichage après la précédente (s). */
  delai: number;
}

export interface MemoireTuto {
  index: number;
  /** Secondes depuis que l'étape courante est affichée (ou −1 : pas encore affichée). */
  depuis: number;
  attente: number;
  ralliement: number;
  speciaux: number;
  termine: boolean;
}

const ETAPES: Record<Camp, EtapeTuto[]> = {
  manif: [
    { id: 'zone', delai: 1.5, texte: 'Objectif : tenir les zones (anneaux au sol, flèches en haut). Rejoignez-en une.', fait: (m, j) => m.zones.some((z) => dansZone(j.x, j.z, z)) },
    { id: 'rassembler', delai: 1, texte: 'Maintenez [Espace] pour rassembler vos camarades proches : à plusieurs, une zone bascule plus vite.', fait: (_m, _j, t) => t.ralliement >= 1 },
    { id: 'souffle', delai: 1, texte: 'Votre souffle (barre en bas) baisse au contact des forces de l’ordre. À zéro, vous êtes dispersé. Reculez vers vos camarades pour récupérer.', fait: (_m, _j, t) => t.depuis > 9 },
    { id: 'slogan', delai: 1, texte: '[F] lance un slogan : souffle et élan pour les camarades proches. Utile quand ça chauffe.', fait: (_m, j, t) => t.speciaux > 0 || j.stats.speciaux > 0 || t.depuis > 14 },
  ],
  ordre: [
    { id: 'zone', delai: 1.5, texte: 'Objectif : empêcher la mobilisation d’atteindre 100 %. Reprenez une zone (anneaux au sol, flèches en haut).', fait: (m, j) => m.zones.some((z) => dansZone(j.x, j.z, z)) },
    { id: 'cordon', delai: 1, texte: 'Maintenez [Espace] pour former un cordon : vos unités se placent à vos côtés. En cordon, vous êtes plus solides et plus efficaces au contact.', fait: (_m, _j, t) => t.ralliement >= 1 },
    { id: 'contact', delai: 1, texte: 'Au contact, un manifestant s’essouffle et finit dispersé. Mais à deux contre vous, c’est vous qui perdez du souffle : restez groupés.', fait: (_m, _j, t) => t.depuis > 9 },
    { id: 'gaz', delai: 1, texte: '[F] lance un gaz fictif devant vous : il ralentit et essouffle les manifestants. 3 charges, qui se rechargent.', fait: (_m, j, t) => t.speciaux > 0 || j.stats.speciaux > 0 || t.depuis > 14 },
  ],
};

export function creerTuto(): MemoireTuto {
  return { index: 0, depuis: -1, attente: 0, ralliement: 0, speciaux: 0, termine: false };
}

/** Avance le tutoriel ; renvoie le texte à afficher si une nouvelle étape commence, 'fin' quand tout est vu. */
export function avancerTuto(t: MemoireTuto, monde: Monde, joueur: Acteur, camp: Camp, dt: number): string | null {
  if (t.termine) return null;
  const etapes = ETAPES[camp];
  if (joueur.rallie) t.ralliement += dt;
  if (t.index >= etapes.length) { t.termine = true; return null; }
  const etape = etapes[t.index]!;
  if (t.depuis < 0) {
    t.attente += dt;
    if (t.attente >= etape.delai) { t.depuis = 0; t.attente = 0; return etape.texte; }
    return null;
  }
  t.depuis += dt;
  if (etape.fait(monde, joueur, t)) {
    t.index++;
    t.depuis = -1;
    t.attente = 0;
    if (t.index >= etapes.length) { t.termine = true; return 'fin'; }
  }
  return null;
}
