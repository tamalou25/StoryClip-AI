// Affichage en partie (DOM) : chrono, jauge de mobilisation, zones avec direction, souffle et capacités
// du joueur, journal des événements, annonces, conseils du tutoriel. Lecture seule de la simulation.

import type { Monde } from '../sim/monde';
import { progression } from '../sim/monde';
import type { Acteur, Evenement } from '../sim/partie';
import { NOM_CAMP, GAZ_CHARGES, type Camp } from '../sim/regles';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const CAPACITES: Record<Camp, { action: string; special: string; actionAide: string; specialAide: string }> = {
  manif: { action: 'Rassembler', special: 'Slogan', actionAide: 'Maintenez pour que vos camarades proches vous suivent', specialAide: 'Redonne du souffle et de l’élan aux camarades proches' },
  ordre: { action: 'Cordon', special: 'Gaz fictif', actionAide: 'Maintenez pour que vos unités se placent à vos côtés', specialAide: 'Un nuage devant vous : ralentit et essouffle les manifestants' },
};

export function formaterTemps(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.max(0, Math.floor(s % 60));
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export class Hud {
  private readonly objectif = el<HTMLDivElement>('objectif');
  private readonly chrono = el<HTMLSpanElement>('chrono');
  private readonly jauge = el<HTMLDivElement>('jauge');
  private readonly jaugeBarre = el<HTMLDivElement>('jauge-barre');
  private readonly jaugeEtiquette = el<HTMLSpanElement>('jauge-etiquette');
  private readonly zones = el<HTMLUListElement>('zones');
  private readonly etatJoueur = el<HTMLDivElement>('etat-joueur');
  private readonly souffleBarre = el<HTMLDivElement>('souffle-barre');
  private readonly capAction = el<HTMLSpanElement>('cap-action');
  private readonly capSpecial = el<HTMLSpanElement>('cap-special');
  private readonly capSpecialEtat = el<HTMLSpanElement>('cap-special-etat');
  private readonly journal = el<HTMLOListElement>('journal');
  private readonly annonce = el<HTMLParagraphElement>('annonce');
  private readonly conseil = el<HTMLParagraphElement>('conseil');
  private readonly boutonSpecial = document.querySelector<HTMLButtonElement>('[data-commande="special"]')!;
  private pastilles = new Map<string, { li: HTMLLIElement; fleche: HTMLSpanElement; effectifs: HTMLSpanElement }>();
  private minuterieAnnonce: number | null = null;
  private minuterieConseil: number | null = null;
  private dernierChrono = -1;
  private camp: Camp = 'manif';
  private readonly compteurJournal = { n: 0 };

  /** Prépare l'affichage pour une nouvelle partie. */
  demarrer(monde: Monde, camp: Camp): void {
    this.camp = camp;
    this.objectif.hidden = false;
    this.etatJoueur.hidden = false;
    this.jauge.classList.toggle('ordre', camp === 'ordre');
    this.journal.replaceChildren();
    this.annonce.hidden = true;
    this.conseil.hidden = true;
    this.zones.replaceChildren();
    this.pastilles.clear();
    for (const z of monde.zones) {
      const li = document.createElement('li');
      li.className = 'zone-pastille';
      const fleche = document.createElement('span');
      fleche.className = 'fleche';
      fleche.setAttribute('aria-hidden', 'true');
      const nom = document.createElement('span');
      nom.className = 'nom';
      nom.textContent = z.nom;
      const effectifs = document.createElement('span');
      effectifs.className = 'effectifs';
      li.append(fleche, nom, effectifs);
      this.zones.append(li);
      this.pastilles.set(z.id, { li, fleche, effectifs });
    }
    const c = CAPACITES[camp];
    el('cap-action-nom').textContent = c.action;
    el('cap-special-nom').textContent = c.special;
    el('aide-action').textContent = c.action.toLowerCase();
    el('aide-special').textContent = c.special.toLowerCase();
    el('etiquette-action').textContent = c.action;
    el('etiquette-special').textContent = c.special;
    this.boutonSpecial.setAttribute('aria-label', c.special);
    document.querySelector('[data-commande="action"]')!.setAttribute('aria-label', c.action);
    this.dernierChrono = -1;
  }

  cacher(): void {
    this.objectif.hidden = true;
    this.etatJoueur.hidden = true;
    this.annonce.hidden = true;
    this.conseil.hidden = true;
    this.journal.replaceChildren();
  }

  /** Mise à jour par image. lacetCamera sert à orienter les flèches des zones. */
  maj(monde: Monde, joueur: Acteur, lacetCamera: number): void {
    const restant = Math.max(0, monde.partie.duree - monde.partie.temps);
    const chronoEntier = Math.ceil(restant);
    if (chronoEntier !== this.dernierChrono) {
      this.dernierChrono = chronoEntier;
      this.chrono.textContent = formaterTemps(chronoEntier);
      this.chrono.classList.toggle('urgent', restant <= 30);
    }
    const p = progression(monde.partie);
    const pct = Math.floor(p * 100);
    this.jaugeBarre.style.width = `${p * 100}%`;
    this.jauge.setAttribute('aria-valuenow', String(pct));
    this.jaugeEtiquette.textContent = this.camp === 'manif' ? `Mobilisation ${pct} %` : `Mobilisation adverse ${pct} %`;

    for (const z of monde.zones) {
      const pa = this.pastilles.get(z.id);
      if (!pa) continue;
      pa.li.classList.toggle('manif', z.tenue === 'manif');
      pa.li.classList.toggle('ordre', z.tenue === 'ordre');
      pa.li.classList.toggle('contestee', z.presents.manif > 0 && z.presents.ordre > 0);
      // Flèche : direction de la zone par rapport à la caméra (haut = devant).
      const dx = z.x - joueur.x;
      const dz = z.z - joueur.z;
      const dist = Math.hypot(dx, dz);
      const angle = Math.atan2(-dx, -dz) - lacetCamera; // cap vers la zone, relatif au lacet caméra
      pa.fleche.style.transform = `rotate(${-angle}rad)`;
      pa.effectifs.textContent = `${Math.round(dist)} m · ${z.presents.manif} ⬤ ${z.presents.ordre}`;
      pa.li.setAttribute('aria-label', `${z.nom}, ${Math.round(dist)} mètres, ${z.presents.manif} manifestants, ${z.presents.ordre} forces de l'ordre${z.tenue ? `, tenue par ${NOM_CAMP[z.tenue]}` : ''}`);
    }

    const souffle = joueur.souffle / 100;
    this.souffleBarre.style.width = `${souffle * 100}%`;
    this.souffleBarre.classList.toggle('faible', souffle < 0.5 && souffle >= 0.25);
    this.souffleBarre.classList.toggle('critique', souffle < 0.25);
    this.capAction.classList.toggle('actif', joueur.rallie);
    let etat = '';
    let dispo = true;
    if (this.camp === 'ordre') {
      etat = `${joueur.charges}/${GAZ_CHARGES}`;
      if (joueur.charges === 0) { dispo = false; etat += ` · ${Math.ceil(22 - joueur.rechargeCharge)} s`; }
      else if (joueur.recharge > 0) dispo = false;
    } else if (joueur.recharge > 0) {
      dispo = false;
      etat = `${Math.ceil(joueur.recharge)} s`;
    } else etat = 'prêt';
    this.capSpecialEtat.textContent = etat;
    this.capSpecial.classList.toggle('indisponible', !dispo);
    this.boutonSpecial.classList.toggle('indisponible', !dispo);
  }

  /** Événements du pas : journal, annonces. Renvoie rien ; les sons sont gérés ailleurs. */
  evenements(evts: Evenement[], monde: Monde, idJoueur: string): void {
    for (const e of evts) {
      switch (e.type) {
        case 'zone': {
          if (e.camp === null) { this.ligne(`${e.nom} : contesté`, null); break; }
          const nous = e.camp === this.camp;
          this.ligne(`${e.nom} ${nous ? 'tenu par votre camp' : `perdu (${NOM_CAMP[e.camp]})`}`, e.camp);
          this.annoncer(nous ? `${e.nom} : à nous !` : `${e.nom} perdu`, e.camp);
          break;
        }
        case 'disperse': {
          const a = monde.acteurs[e.id]!;
          const moi = e.id === idJoueur;
          const verbe = e.camp === 'manif' ? 'dispersé' : 'en repli';
          this.ligne(moi ? `Vous êtes ${verbe} (${e.cause === 'gaz' ? 'gaz' : e.cause === 'nombre' ? 'débordé' : 'contact'}) : retour dans quelques secondes` : `${a.nom} ${verbe}`, e.camp);
          if (moi) this.annoncer(e.camp === 'manif' ? 'Dispersé ! Retour dans quelques secondes' : 'Débordé ! Repli en cours', 'alerte');
          break;
        }
        case 'retour':
          if (e.id === idJoueur) this.ligne('Vous êtes de retour', e.camp);
          break;
        case 'gaz':
          this.ligne(`${monde.acteurs[e.id]?.nom ?? '?'} lance un gaz fictif`, 'ordre');
          break;
        case 'slogan':
          this.ligne(`${monde.acteurs[e.id]?.nom ?? '?'} lance un slogan`, 'manif');
          break;
        case 'fin':
          this.annoncer(e.vainqueur === this.camp ? 'Victoire !' : 'Défaite', e.vainqueur, 4000);
          break;
        case 'alerte':
          this.ligne(e.texte, null);
          break;
      }
    }
  }

  private ligne(texte: string, camp: Camp | null): void {
    const li = document.createElement('li');
    li.textContent = texte;
    if (camp) li.classList.add(camp);
    this.journal.append(li);
    this.compteurJournal.n++;
    while (this.journal.children.length > 4) this.journal.firstElementChild?.remove();
    window.setTimeout(() => li.classList.add('fade'), 5000);
    window.setTimeout(() => li.remove(), 5700);
  }

  annoncer(texte: string, classe: Camp | 'alerte' | null, duree = 1800): void {
    this.annonce.textContent = texte;
    this.annonce.className = `annonce${classe ? ` ${classe}` : ''}`;
    this.annonce.hidden = false;
    if (this.minuterieAnnonce !== null) clearTimeout(this.minuterieAnnonce);
    this.minuterieAnnonce = window.setTimeout(() => { this.annonce.hidden = true; }, duree);
  }

  /** Conseil contextuel (tutoriel) ; html limité à des <kbd>. */
  conseiller(texte: string, duree = 7000): void {
    this.conseil.replaceChildren(...texteAvecTouches(texte));
    this.conseil.hidden = false;
    if (this.minuterieConseil !== null) clearTimeout(this.minuterieConseil);
    this.minuterieConseil = window.setTimeout(() => { this.conseil.hidden = true; }, duree);
  }

  effacerConseil(): void {
    this.conseil.hidden = true;
    if (this.minuterieConseil !== null) clearTimeout(this.minuterieConseil);
  }
}

/** Transforme « Maintenez [Espace] » en texte + <kbd>, sans innerHTML. */
function texteAvecTouches(texte: string): (string | HTMLElement)[] {
  const parties: (string | HTMLElement)[] = [];
  const re = /\[([^\]]+)\]/g;
  let i = 0;
  for (const m of texte.matchAll(re)) {
    parties.push(texte.slice(i, m.index));
    const k = document.createElement('kbd');
    k.textContent = m[1]!;
    parties.push(k);
    i = m.index + m[0].length;
  }
  parties.push(texte.slice(i));
  return parties;
}
