// Écrans du menu (accueil, camp, pause, résultat) et réglages persistants. Aucune logique de jeu :
// main.ts branche les actions. Tout est navigable au clavier ; le fond est inerte quand un écran est ouvert.

import type { Monde } from '../sim/monde';
import type { Acteur } from '../sim/partie';
import { NOM_CAMP, type Camp, type Difficulte } from '../sim/regles';
import { CAPACITES, formaterTemps } from './hud';

export type NomEcran = 'accueil' | 'camp' | 'pause' | 'resultat';

export interface ReglagesClient {
  difficulte: Difficulte;
  duree: number;
  volumeAmbiance: number;
  volumeEffets: number;
  reduireEffets: boolean;
  conseils: boolean;
  dernierCamp: Camp;
}

const CLE = 'pm3d-reglages';

export function chargerReglages(): ReglagesClient {
  const defaut: ReglagesClient = { difficulte: 'normal', duree: 300, volumeAmbiance: 0.9, volumeEffets: 1, reduireEffets: false, conseils: true, dernierCamp: 'manif' };
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) ?? '{}') as Partial<ReglagesClient>;
    const r = { ...defaut, ...brut };
    if (!['facile', 'normal', 'difficile'].includes(r.difficulte)) r.difficulte = 'normal';
    if (![180, 300].includes(r.duree)) r.duree = 300;
    if (!['manif', 'ordre'].includes(r.dernierCamp)) r.dernierCamp = 'manif';
    r.volumeAmbiance = Math.min(1, Math.max(0, Number(r.volumeAmbiance) || 0));
    r.volumeEffets = Math.min(1, Math.max(0, Number(r.volumeEffets) || 0));
    return r;
  } catch {
    return defaut;
  }
}

export function sauverReglages(r: ReglagesClient): void {
  try { localStorage.setItem(CLE, JSON.stringify(r)); } catch { /* stockage indisponible */ }
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Ecrans {
  readonly menu = el<HTMLDivElement>('menu');
  private readonly ecrans: Record<NomEcran, HTMLElement> = {
    accueil: el('ecran-accueil'),
    camp: el('ecran-camp'),
    pause: el('ecran-pause'),
    resultat: el('ecran-resultat'),
  };
  courant: NomEcran | null = 'accueil';
  readonly reglages: ReglagesClient;
  private readonly fonds: HTMLElement[];

  constructor(fonds: HTMLElement[]) {
    this.fonds = fonds;
    this.reglages = chargerReglages();
    this.majChoix();
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-difficulte]')) {
      b.addEventListener('click', () => { this.reglages.difficulte = b.dataset.difficulte as Difficulte; this.majChoix(); sauverReglages(this.reglages); });
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-duree]')) {
      b.addEventListener('click', () => { this.reglages.duree = Number(b.dataset.duree); this.majChoix(); sauverReglages(this.reglages); });
    }
    const options = el<HTMLDivElement>('options');
    const boutonOptions = el<HTMLButtonElement>('bouton-options');
    boutonOptions.addEventListener('click', () => {
      options.hidden = !options.hidden;
      boutonOptions.setAttribute('aria-expanded', String(!options.hidden));
    });
    const ambiance = el<HTMLInputElement>('volume-ambiance');
    const effets = el<HTMLInputElement>('volume-effets');
    const reduire = el<HTMLInputElement>('reduire-effets');
    const conseils = el<HTMLInputElement>('afficher-tuto');
    ambiance.value = String(Math.round(this.reglages.volumeAmbiance * 100));
    effets.value = String(Math.round(this.reglages.volumeEffets * 100));
    reduire.checked = this.reglages.reduireEffets;
    conseils.checked = this.reglages.conseils;
    const lire = () => {
      this.reglages.volumeAmbiance = Number(ambiance.value) / 100;
      this.reglages.volumeEffets = Number(effets.value) / 100;
      this.reglages.reduireEffets = reduire.checked;
      this.reglages.conseils = conseils.checked;
      sauverReglages(this.reglages);
      this.onReglages?.(this.reglages);
    };
    for (const i of [ambiance, effets, reduire, conseils]) i.addEventListener('input', lire);
  }

  onReglages: ((r: ReglagesClient) => void) | null = null;

  private majChoix(): void {
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-difficulte]')) b.setAttribute('aria-pressed', String(b.dataset.difficulte === this.reglages.difficulte));
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-duree]')) b.setAttribute('aria-pressed', String(Number(b.dataset.duree) === this.reglages.duree));
  }

  /** Affiche un écran (ou aucun) et donne le focus à son premier bouton principal. */
  montrer(nom: NomEcran | null, focus?: string): void {
    this.courant = nom;
    this.menu.hidden = nom === null;
    for (const f of this.fonds) f.inert = nom !== null;
    for (const [n, e] of Object.entries(this.ecrans)) e.hidden = n !== nom;
    if (nom) {
      const cible = focus ? el<HTMLElement>(focus) : this.ecrans[nom].querySelector<HTMLElement>('button');
      cible?.focus();
      this.menu.scrollTop = 0;
    }
  }

  remplirPause(camp: Camp, monde: Monde): void {
    const c = CAPACITES[camp];
    el('pause-rappel').textContent = `${NOM_CAMP[camp]} · ${formaterTemps(Math.max(0, monde.partie.duree - monde.partie.temps))} restantes · mobilisation ${Math.round((monde.partie.mobilisation / monde.partie.cibleMobilisation) * 100)} %`;
    const aide = el<HTMLDListElement>('pause-aide');
    aide.replaceChildren(
      ligneAide('Objectif', camp === 'manif' ? 'Tenir les zones pour atteindre 100 % de mobilisation avant la fin.' : 'Garder la mobilisation sous 100 % jusqu’à la fin, ou disperser tous les manifestants.'),
      ligneAide(c.action, `${c.actionAide} (Espace / bouton Action).`),
      ligneAide(c.special, `${c.specialAide} (F / bouton Spécial).`),
    );
  }

  remplirResultat(camp: Camp, monde: Monde, idJoueur: string): void {
    const p = monde.partie;
    const victoire = p.vainqueur === camp;
    const ecran = this.ecrans.resultat;
    ecran.className = `ecran ${victoire ? p.vainqueur : 'defaite'}`;
    el('resultat-surtitre').textContent = `${NOM_CAMP[camp]} · ${formaterTemps(p.temps)} jouées`;
    el('resultat-titre').textContent = victoire ? 'Victoire' : 'Défaite';
    el('resultat-raison').textContent = p.raison ?? '';

    const joueur = monde.acteurs[idJoueur]!;
    const acteurs = monde.ordre.map((id) => monde.acteurs[id]!);
    const somme = (c: Camp, f: (a: Acteur) => number) => acteurs.filter((a) => a.camp === c).reduce((s, a) => s + f(a), 0);
    const bilan = el<HTMLTableSectionElement>('resultat-bilan');
    bilan.replaceChildren(
      ligneBilan('Mobilisation finale', `${Math.round((p.mobilisation / p.cibleMobilisation) * 100)} %`),
      ligneBilan('Zones tenues (secondes cumulées)', `${Math.round(p.tenueCumulee.manif)} manif · ${Math.round(p.tenueCumulee.ordre)} ordre`),
      ligneBilan('Manifestants dispersés / unités en repli', `${somme('manif', (a) => a.stats.dispersions)} · ${somme('ordre', (a) => a.stats.dispersions)}`),
      ligneBilan('Vous : temps en zone', `${Math.round(joueur.stats.tempsEnZone)} s`),
      ligneBilan(camp === 'manif' ? 'Vous : dispersions subies / slogans' : 'Vous : replis subis / gaz lancés', `${joueur.stats.dispersions} · ${joueur.stats.speciaux}`),
      ligneBilan('Vous : adversaires neutralisés', String(joueur.stats.neutralisations)),
    );
    el('resultat-conseil').textContent = conseil(camp, monde, joueur);
    const journal = el<HTMLOListElement>('resultat-journal');
    journal.replaceChildren(...p.journal.slice(-6).map((e) => {
      const li = document.createElement('li');
      const t = document.createElement('span');
      t.textContent = formaterTemps(e.temps);
      li.append(t, e.texte);
      return li;
    }));
  }
}

function ligneAide(titre: string, texte: string): HTMLElement {
  const div = document.createElement('div');
  const dt = document.createElement('dt');
  dt.textContent = titre;
  const dd = document.createElement('dd');
  dd.textContent = texte;
  div.append(dt, dd);
  return div;
}

function ligneBilan(titre: string, valeur: string): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const a = document.createElement('td');
  a.textContent = titre;
  const b = document.createElement('td');
  b.textContent = valeur;
  tr.append(a, b);
  return tr;
}

/** Un conseil lisible, déduit du bilan : ce qui a fait gagner ou perdre. */
function conseil(camp: Camp, monde: Monde, joueur: Acteur): string {
  const p = monde.partie;
  const victoire = p.vainqueur === camp;
  const pct = p.mobilisation / p.cibleMobilisation;
  if (camp === 'manif') {
    if (victoire) return p.raison?.startsWith('Déroute') ? 'Déroute totale : vous avez fait reculer toutes les unités. Rare et beau.' : 'Vous avez tenu les zones assez longtemps. Pour aller plus vite : tenez deux zones à la fois avec des groupes de trois.';
    if (p.raison?.startsWith('Place dégagée')) return 'Tout le monde a été dispersé en même temps. Évitez le contact isolé et le gaz ; repliez-vous vers vos camarades quand le souffle baisse (barre en bas).';
    if (joueur.stats.tempsEnZone < p.temps * 0.3) return `Vous n'avez passé que ${Math.round(joueur.stats.tempsEnZone)} s dans les zones : la mobilisation ne monte que si une zone est tenue. Restez dans les anneaux.`;
    if (pct > 0.8) return 'Il a manqué peu de chose. Un slogan (F) au bon moment ou un rassemblement (Espace) sur la zone contestée aurait suffi.';
    return 'Les forces de l’ordre ont repris les zones trop souvent. Rassemblez (Espace) avant d’entrer dans une zone : à trois, elle bascule vite et vous récupérez du souffle ensemble.';
  }
  if (victoire) return p.raison?.startsWith('Place dégagée') ? 'Place dégagée : tous dispersés d’un coup. Le gaz sur un groupe puis le cordon pour finir, c’est la recette.' : 'La mobilisation n’a pas atteint 100 %. Pour une victoire plus nette : dispersez tout le monde en même temps (gaz puis cordon).';
  if (joueur.stats.dispersions >= 2) return 'Vous avez été débordé plusieurs fois : ne restez pas isolé face à deux manifestants. Maintenez Espace pour que vos unités forment un cordon avec vous.';
  if (joueur.stats.speciaux === 0) return 'Vous n’avez pas utilisé le gaz fictif (F) : un nuage sur un groupe dans une zone le ralentit et annule sa capture.';
  return 'Les manifestants ont tenu une zone trop longtemps. Visez la zone qu’ils tiennent (flèches en haut) et entrez-y en cordon : au contact, ils s’essoufflent.';
}
