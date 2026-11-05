// État complet de la simulation et pas fixe : déplacements, contacts, souffle, zones, spéciaux,
// bots, fin de partie. Même code en solo (navigateur) et, plus tard, sur le serveur autoritaire.
// `etape` ne modifie jamais ses entrées : elle renvoie un nouveau monde (et la liste des événements du pas).

import { creerAlea, entre, type Alea } from './alea';
import type { Carte } from './carte';
import { avancer, creerPersonnage, resoudreCollisions, VITESSE_MAX } from './deplacement';
import { INTENTION_NEUTRE, type Intention } from './intention';
import { avant, borner } from './math';
import { dansZone, pointDepart, ZONES_REPUBLIQUE, type DefinitionZone } from './objectifs';
import type { Acteur, Evenement, Nuage, Partie, Zone } from './partie';
import * as R from './regles';
import { type Camp, type Reglages } from './regles';
import { creerMemoire, decider, type MemoireBot } from './bots';

export const FREQUENCE = 30; // pas de simulation par seconde
export const DT = 1 / FREQUENCE;

export interface Monde {
  tick: number;
  alea: Alea;
  acteurs: Record<string, Acteur>;
  /** Ordre stable des acteurs (déterminisme et affichage). */
  ordre: string[];
  zones: Zone[];
  nuages: Nuage[];
  partie: Partie;
  bots: Record<string, MemoireBot>;
  /** Événements produits par le dernier pas (le client les lit puis les oublie). */
  evenements: Evenement[];
  compteurNuage: number;
}

export interface OptionsMonde {
  /** Camp du joueur humain, ou null pour une partie entre bots. */
  campJoueur: Camp | null;
  idJoueur?: string;
  nomJoueur?: string;
  reglages?: Partial<Reglages>;
  zones?: readonly DefinitionZone[];
}

const PRENOMS: Record<Camp, string[]> = {
  manif: ['Lou', 'Sacha', 'Inès', 'Noa', 'Jules', 'Maé', 'Camille', 'Yanis'],
  ordre: ['Unité 1', 'Unité 2', 'Unité 3', 'Unité 4', 'Unité 5', 'Unité 6', 'Unité 7', 'Unité 8'],
};

export function creerMonde(carte: Carte, options: OptionsMonde): Monde {
  const reglages = R.reglagesParDefaut(options.reglages);
  const alea = creerAlea(reglages.graine);
  const acteurs: Record<string, Acteur> = {};
  const ordre: string[] = [];
  const bots: Record<string, MemoireBot> = {};
  const idJoueur = options.idJoueur ?? 'joueur';
  for (const camp of R.CAMPS) {
    const n = reglages.effectifs[camp];
    for (let i = 0; i < n; i++) {
      const estJoueur = options.campJoueur === camp && i === 0;
      const id = estJoueur ? idJoueur : `${camp}-${i}`;
      const d = pointDepart(camp, i, carte);
      const nom = estJoueur ? (options.nomJoueur ?? 'Vous') : PRENOMS[camp][i % PRENOMS[camp].length]!;
      acteurs[id] = creerActeur(id, camp, !estJoueur, nom, d.x, d.z, d.cap);
      ordre.push(id);
      if (!estJoueur) bots[id] = creerMemoire(alea);
    }
  }
  const zones: Zone[] = (options.zones ?? ZONES_REPUBLIQUE).map((z) => ({ ...z, controle: 0, tenue: null, presents: { manif: 0, ordre: 0 } }));
  return {
    tick: 0,
    alea,
    acteurs,
    ordre,
    zones,
    nuages: [],
    partie: {
      phase: 'en-cours',
      temps: 0,
      duree: reglages.duree,
      mobilisation: 0,
      cibleMobilisation: reglages.cibleMobilisation,
      vainqueur: null,
      raison: null,
      tenueCumulee: { manif: 0, ordre: 0 },
      journal: [],
      reglages,
      campJoueur: options.campJoueur,
    },
    bots,
    evenements: [],
    compteurNuage: 0,
  };
}

function creerActeur(id: string, camp: Camp, bot: boolean, nom: string, x: number, z: number, cap: number): Acteur {
  return {
    ...creerPersonnage(x, z, cap),
    id, camp, bot, nom,
    etat: 'actif', retour: 0,
    souffle: R.SOUFFLE_MAX, depuisPerte: 99,
    rallie: false, elan: 0,
    recharge: 0, charges: camp === 'ordre' ? R.GAZ_CHARGES : 0, rechargeCharge: 0,
    dansGaz: false, enCordon: false, auContact: false, specialPrecedent: false,
    stats: { dispersions: 0, neutralisations: 0, speciaux: 0, tempsEnZone: 0 },
  };
}

/** Profil d'un bot : la difficulté choisie s'applique aux adversaires du joueur ; ses coéquipiers restent « normal ». */
export function profilPour(partie: Partie, a: Acteur): R.ProfilBots {
  if (partie.campJoueur !== null && a.camp === partie.campJoueur) return R.PROFILS.normal;
  return R.PROFILS[partie.reglages.difficulte];
}

export function adversaire(camp: Camp): Camp {
  return camp === 'manif' ? 'ordre' : 'manif';
}

function distance2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function formaterTemps(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** Un pas fixe. Les intentions manquantes valent « immobile ». Les bots décident eux-mêmes. */
export function etape(monde: Monde, intentions: Readonly<Record<string, Intention>>, carte: Carte): Monde {
  if (monde.partie.phase === 'terminee') return { ...monde, evenements: [] };

  const evenements: Evenement[] = [];
  const alea: Alea = { etat: monde.alea.etat };
  const partie: Partie = { ...monde.partie, tenueCumulee: { ...monde.partie.tenueCumulee }, journal: monde.partie.journal };
  const journal = (texte: string) => {
    partie.journal = [...partie.journal, { temps: partie.temps, texte }];
  };
  const vivants = monde.ordre.map((id) => monde.acteurs[id]!);

  // 1. Décisions des bots (lecture de l'état du pas précédent).
  const bots: Record<string, MemoireBot> = {};
  const toutesIntentions: Record<string, Intention> = {};
  for (const a of vivants) {
    if (a.bot) {
      const memoire = monde.bots[a.id]!;
      const r = decider(monde, a, memoire, carte, alea);
      bots[a.id] = r.memoire;
      toutesIntentions[a.id] = r.intention;
    } else {
      toutesIntentions[a.id] = intentions[a.id] ?? INTENTION_NEUTRE;
    }
  }

  // 2. Déplacement de chaque acteur.
  const acteurs: Record<string, Acteur> = {};
  for (const a of vivants) {
    const intention = toutesIntentions[a.id]!;
    let n: Acteur = { ...a, stats: { ...a.stats }, rallie: false, auContact: false };
    if (a.etat === 'hors-jeu') {
      n.retour = Math.max(0, a.retour - DT);
      n.vx = 0;
      n.vz = 0;
      if (n.retour === 0) {
        const i = monde.ordre.filter((id) => monde.acteurs[id]!.camp === a.camp).indexOf(a.id);
        const d = pointDepart(a.camp, i, carte);
        n = { ...n, x: d.x + entre(alea, -0.6, 0.6), z: d.z + entre(alea, -0.6, 0.6), cap: d.cap, etat: 'actif', souffle: R.SOUFFLE_MAX * 0.8, depuisPerte: 99, dansGaz: false };
        evenements.push({ type: 'retour', id: a.id, camp: a.camp });
      }
      acteurs[a.id] = n;
      continue;
    }
    let facteur = (a.bot ? profilPour(partie, a).vitesse : 1) * (a.dansGaz ? R.RALENTI_GAZ : 1) * (a.elan > 0 ? R.ELAN_VITESSE : 1);
    // Un acteur essoufflé ralentit un peu : la fuite reste possible mais coûte.
    if (a.souffle < 25) facteur *= 0.85;
    const deplace = avancer(a, intention, DT, carte, VITESSE_MAX * facteur);
    n = { ...n, ...deplace, rallie: intention.action, elan: Math.max(0, a.elan - DT) };
    acteurs[a.id] = n;
  }

  // 3. Séparation entre acteurs (cercles) : les cordons sont lourds, les groupes poussent.
  const ids = monde.ordre.filter((id) => acteurs[id]!.etat === 'actif');
  // Cordon : un policier avec un collègue à portée (après déplacement).
  for (const id of ids) {
    const a = acteurs[id]!;
    if (a.camp !== 'ordre') continue;
    a.enCordon = ids.some((j) => j !== id && acteurs[j]!.camp === 'ordre' && distance2(a, acteurs[j]!) <= R.PORTEE_CORDON * R.PORTEE_CORDON);
  }
  const masse = (a: Acteur) => (a.enCordon && a.rallie ? R.MASSE_CORDON : a.enCordon ? R.MASSE[a.camp] * 1.6 : R.MASSE[a.camp]);
  const diametre = R.RAYON_ACTEUR * 2;
  for (let passe = 0; passe < 2; passe++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = acteurs[ids[i]!]!;
        const b = acteurs[ids[j]!]!;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        if (d >= diametre) continue;
        if (d < 1e-4) { dx = 1; dz = 0; d = 1e-4; }
        const chev = diametre - d;
        const ma = masse(a);
        const mb = masse(b);
        const pa = mb / (ma + mb);
        const pb = ma / (ma + mb);
        const ux = dx / d;
        const uz = dz / d;
        a.x -= ux * chev * pa;
        a.z -= uz * chev * pa;
        b.x += ux * chev * pb;
        b.z += uz * chev * pb;
      }
    }
  }
  for (const id of ids) {
    const a = acteurs[id]!;
    const r = resoudreCollisions(a.x, a.z, a.vx, a.vz, carte);
    a.x = r.x; a.z = r.z; a.vx = r.vx; a.vz = r.vz;
  }

  // 4. Nuages : vieillissement ; qui est dedans.
  const nuages: Nuage[] = monde.nuages.map((nu) => ({ ...nu, reste: nu.reste - DT })).filter((nu) => nu.reste > 0);
  for (const id of ids) {
    const a = acteurs[id]!;
    a.dansGaz = a.camp === 'manif' && nuages.some((nu) => distance2(a, nu) <= nu.rayon * nu.rayon);
  }

  // 5. Spéciaux (front montant) et recharges.
  let compteurNuage = monde.compteurNuage;
  for (const id of ids) {
    const a = acteurs[id]!;
    const intention = toutesIntentions[id]!;
    a.recharge = Math.max(0, a.recharge - DT);
    if (a.camp === 'ordre' && a.charges < R.GAZ_CHARGES) {
      a.rechargeCharge += DT;
      if (a.rechargeCharge >= R.GAZ_RECHARGE) { a.rechargeCharge = 0; a.charges++; }
    }
    const presse = !!intention.special && !a.specialPrecedent;
    a.specialPrecedent = !!intention.special;
    if (!presse || a.recharge > 0) continue;
    if (a.camp === 'ordre') {
      if (a.charges <= 0) continue;
      const dir = avant(a.cap);
      let x = a.x + dir.x * R.GAZ_PORTEE;
      let z = a.z + dir.z * R.GAZ_PORTEE;
      x = borner(x, carte.limites.minX, carte.limites.maxX);
      z = borner(z, carte.limites.minZ, carte.limites.maxZ);
      compteurNuage++;
      nuages.push({ id: `nuage-${compteurNuage}`, x, z, rayon: R.GAZ_RAYON, reste: R.GAZ_DUREE, duree: R.GAZ_DUREE, auteur: id });
      a.charges--;
      a.recharge = R.GAZ_DELAI;
      a.stats.speciaux++;
      evenements.push({ type: 'gaz', id, x, z });
    } else {
      for (const j of ids) {
        const b = acteurs[j]!;
        if (b.camp !== 'manif' || distance2(a, b) > R.SLOGAN_PORTEE * R.SLOGAN_PORTEE) continue;
        b.souffle = Math.min(R.SOUFFLE_MAX, b.souffle + R.SLOGAN_SOUFFLE);
        b.elan = R.SLOGAN_ELAN;
      }
      a.recharge = R.SLOGAN_RECHARGE;
      a.stats.speciaux++;
      evenements.push({ type: 'slogan', id, x: a.x, z: a.z });
    }
  }

  // 6. Contacts et souffle.
  const portee2 = R.PORTEE_CONTACT * R.PORTEE_CONTACT;
  const pertes: Record<string, number> = {};
  const attaquants: Record<string, string[]> = {};
  for (const id of ids) { pertes[id] = 0; attaquants[id] = []; }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = acteurs[ids[i]!]!;
      const b = acteurs[ids[j]!]!;
      if (a.camp === b.camp || distance2(a, b) > portee2) continue;
      const [m, o] = a.camp === 'manif' ? [a, b] : [b, a];
      m.auContact = true;
      o.auContact = true;
      pertes[m.id]! += R.CONTACT_ORDRE_SUR_MANIF * (o.enCordon ? R.BONUS_CORDON : 1);
      attaquants[m.id]!.push(o.id);
      attaquants[o.id]!.push(m.id);
    }
  }
  for (const id of ids) {
    const o = acteurs[id]!;
    if (o.camp !== 'ordre') continue;
    const n = attaquants[id]!.length;
    if (n > 1) pertes[id]! += R.CONTACT_MANIF_SUR_ORDRE * n * (o.enCordon ? R.PROTECTION_CORDON : 1);
  }
  for (const id of ids) {
    const a = acteurs[id]!;
    let perte = pertes[id]!;
    let cause: 'contact' | 'gaz' | 'nombre' = a.camp === 'manif' ? 'contact' : 'nombre';
    if (a.dansGaz) { perte += R.GAZ_PERTE; if (pertes[id] === 0) cause = 'gaz'; }
    if (perte > 0) {
      a.souffle -= perte * DT;
      a.depuisPerte = 0;
    } else {
      a.depuisPerte += DT;
      if (a.depuisPerte >= R.RECUP_DELAI) {
        let recup = R.RECUP;
        if (a.camp === 'manif') {
          const camarades = ids.filter((j) => j !== id && acteurs[j]!.camp === 'manif' && distance2(a, acteurs[j]!) <= R.PORTEE_GROUPE * R.PORTEE_GROUPE).length;
          if (camarades >= 2) recup += R.RECUP_GROUPE;
        }
        a.souffle = Math.min(R.SOUFFLE_MAX, a.souffle + recup * DT);
      }
    }
    if (a.souffle <= 0) {
      a.souffle = 0;
      a.etat = 'hors-jeu';
      a.retour = R.RETOUR[a.camp];
      a.vx = 0; a.vz = 0;
      a.stats.dispersions++;
      a.dansGaz = false;
      a.enCordon = false;
      for (const j of attaquants[id]!) acteurs[j]!.stats.neutralisations++;
      if (cause === 'gaz' && nuages.length > 0) {
        const nu = nuages.find((n) => distance2(a, n) <= n.rayon * n.rayon);
        if (nu && acteurs[nu.auteur]) acteurs[nu.auteur]!.stats.neutralisations++;
      }
      evenements.push({ type: 'disperse', id, camp: a.camp, x: a.x, z: a.z, cause });
    }
  }
  const actifs = ids.filter((id) => acteurs[id]!.etat === 'actif');

  // 7. Zones : contrôle, tenue, mobilisation.
  const zones: Zone[] = monde.zones.map((z) => ({ ...z, presents: { manif: 0, ordre: 0 } }));
  for (const zone of zones) {
    for (const id of actifs) {
      const a = acteurs[id]!;
      if (!dansZone(a.x, a.z, zone)) continue;
      a.stats.tempsEnZone += DT;
      if (a.camp === 'manif' && a.dansGaz) continue; // dispersé par le gaz : ne compte pas
      zone.presents[a.camp]++;
    }
    const ecart = borner(zone.presents.manif - zone.presents.ordre, -R.CAPTURE_ECART_MAX, R.CAPTURE_ECART_MAX);
    zone.controle = borner(zone.controle + ecart * R.CAPTURE_PAR_PERSONNE * DT, -1, 1);
    const avantTenue = zone.tenue;
    if (zone.controle >= R.SEUIL_TENUE) zone.tenue = 'manif';
    else if (zone.controle <= -R.SEUIL_TENUE) zone.tenue = 'ordre';
    else if (Math.abs(zone.controle) < 0.1) zone.tenue = null;
    if (zone.tenue !== avantTenue) {
      evenements.push({ type: 'zone', zone: zone.id, nom: zone.nom, camp: zone.tenue, x: zone.x, z: zone.z });
      if (zone.tenue) journal(`${zone.nom} : ${zone.tenue === 'manif' ? 'occupé par les manifestants' : "repris par les forces de l'ordre"}`);
    }
    if (zone.tenue) {
      partie.tenueCumulee[zone.tenue] += DT;
      if (zone.tenue === 'manif') partie.mobilisation += DT;
    }
  }

  // 8. Temps, fin de partie.
  partie.temps += DT;
  const nbActifs = (camp: Camp) => actifs.filter((id) => acteurs[id]!.camp === camp).length;
  if (partie.mobilisation >= partie.cibleMobilisation) {
    terminer(partie, 'manif', `Mobilisation atteinte à ${formaterTemps(partie.temps)}`);
  } else if (partie.reglages.effectifs.manif > 0 && nbActifs('manif') === 0) {
    terminer(partie, 'ordre', 'Place dégagée : tous les manifestants dispersés');
  } else if (partie.reglages.effectifs.ordre > 0 && nbActifs('ordre') === 0) {
    terminer(partie, 'manif', 'Déroute : toutes les forces en repli');
  } else if (partie.temps >= partie.duree) {
    terminer(partie, 'ordre', `Temps écoulé : mobilisation à ${Math.round((partie.mobilisation / partie.cibleMobilisation) * 100)} %`);
  }
  if (partie.phase === 'terminee' && partie.vainqueur) {
    journal(partie.raison!);
    evenements.push({ type: 'fin', vainqueur: partie.vainqueur, raison: partie.raison! });
  }

  return { tick: monde.tick + 1, alea, acteurs, ordre: monde.ordre, zones, nuages, partie, bots, evenements, compteurNuage };
}

function terminer(partie: Partie, vainqueur: Camp, raison: string): void {
  partie.phase = 'terminee';
  partie.vainqueur = vainqueur;
  partie.raison = raison;
}

/** Progression (0..1) de la mobilisation. */
export function progression(partie: Partie): number {
  return Math.min(1, partie.mobilisation / partie.cibleMobilisation);
}
