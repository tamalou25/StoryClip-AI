// Personnage humain articulé (≈ 1,78 m) et animation procédurale : repos, marche, course, action.
// - La cadence est liée à la distance parcourue (longueur de foulée) : les pieds glissent peu.
// - Le bassin descend pour que le pied le plus bas touche le sol (IK simple à deux segments).
// - Les transitions sont des mélanges continus pilotés par la vitesse lissée.

import * as pc from 'playcanvas';
import { borner, lissage } from '../sim/math';
import { ombreContact, texture } from './textures';

const CUISSE = 0.45;
const TIBIA = 0.43;
const CHEVILLE = 0.075;
const HANCHE_LARGEUR = 0.1;
const BRAS = 0.29;
const AVANT_BRAS = 0.27;
const DEG = 180 / Math.PI;

export interface Tenue {
  veste: string;
  pantalon: string;
  chaussures: string;
  peau: string;
  cheveux: string;
}

export const TENUE_MANIFESTANT: Tenue = { veste: '#5d6b4a', pantalon: '#34435c', chaussures: '#d8d4cb', peau: '#c79470', cheveux: '#2b211a' };

function mat(hex: string, gloss: number, metal = 0): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useMetalness = true;
  m.diffuse = new pc.Color().fromString(hex);
  m.gloss = gloss;
  m.metalness = metal;
  m.update();
  return m;
}

function piece(parent: pc.Entity, type: 'capsule' | 'sphere' | 'box' | 'cylinder', m: pc.Material, pos: [number, number, number], echelle: [number, number, number], ombre: boolean, rot: [number, number, number] = [0, 0, 0]): pc.Entity {
  const e = new pc.Entity(type);
  e.addComponent('render', { type, material: m, castShadows: ombre, receiveShadows: true });
  e.setLocalPosition(...pos);
  // La capsule PlayCanvas mesure 2 m de haut : on exprime toutes les longueurs en mètres.
  e.setLocalScale(echelle[0], type === 'capsule' ? echelle[1] / 2 : echelle[1], echelle[2]);
  e.setLocalEulerAngles(...rot);
  parent.addChild(e);
  return e;
}

function pivot(parent: pc.Entity, nom: string, pos: [number, number, number]): pc.Entity {
  const e = new pc.Entity(nom);
  e.setLocalPosition(...pos);
  parent.addChild(e);
  return e;
}

interface Jambe { hanche: pc.Entity; genou: pc.Entity; cheville: pc.Entity }
interface Bras { epaule: pc.Entity; coude: pc.Entity }

export type EvenementPas = (cote: 'gauche' | 'droite', intensite: number) => void;

export class Personnage3D {
  readonly racine: pc.Entity;
  private readonly bassin: pc.Entity;
  private readonly buste: pc.Entity;
  private readonly tete: pc.Entity;
  private readonly jambes: [Jambe, Jambe];
  private readonly bras: [Bras, Bras];
  private readonly ombre: pc.Entity;

  private phase = 0;
  private vitesseLissee = 0;
  private actionPoids = 0;
  private temps = 0;
  private capPrecedent = 0;
  private inclinaison = 0;
  private penche = 0;
  private dernierePhasePas = 0;
  onPas: EvenementPas | null = null;

  constructor(app: pc.Application, tenue: Tenue, ombres: boolean) {
    const veste = mat(tenue.veste, 0.22);
    const pantalon = mat(tenue.pantalon, 0.18);
    const chaussure = mat(tenue.chaussures, 0.35);
    const semelle = mat('#3a3a3a', 0.2);
    const peau = mat(tenue.peau, 0.38);
    const cheveux = mat(tenue.cheveux, 0.3);

    this.racine = new pc.Entity('personnage');
    app.root.addChild(this.racine);

    // Ombre de contact (toujours présente, même sans ombres portées).
    const om = new pc.StandardMaterial();
    om.diffuse = new pc.Color(0, 0, 0);
    om.opacityMap = texture(app.graphicsDevice, ombreContact(), false, 1, false);
    om.opacityMapChannel = 'a';
    om.blendType = pc.BLEND_NORMAL;
    om.depthWrite = false;
    om.useLighting = false;
    om.update();
    this.ombre = new pc.Entity('ombreContact');
    this.ombre.addComponent('render', { type: 'plane', material: om, castShadows: false, receiveShadows: false });
    this.ombre.setLocalScale(1.1, 1, 1.1);
    this.ombre.setLocalPosition(0, 0.012, 0);
    this.racine.addChild(this.ombre);

    this.bassin = pivot(this.racine, 'bassin', [0, CUISSE + TIBIA + CHEVILLE, 0]);
    piece(this.bassin, 'capsule', pantalon, [0, 0.0, 0], [0.24, 0.36, 0.22], ombres, [0, 0, 90]);

    // Jambes.
    const jambe = (cote: number): Jambe => {
      const hanche = pivot(this.bassin, 'hanche', [cote * HANCHE_LARGEUR, -0.02, 0]);
      piece(hanche, 'capsule', pantalon, [0, -CUISSE / 2, 0], [0.17, CUISSE + 0.1, 0.18], ombres);
      const genou = pivot(hanche, 'genou', [0, -CUISSE, 0]);
      piece(genou, 'capsule', pantalon, [0, -TIBIA / 2, 0], [0.13, TIBIA + 0.08, 0.14], ombres);
      const cheville = pivot(genou, 'cheville', [0, -TIBIA, 0]);
      piece(cheville, 'box', chaussure, [0, -0.035, -0.05], [0.11, 0.08, 0.27], ombres);
      piece(cheville, 'box', semelle, [0, -0.07, -0.05], [0.115, 0.02, 0.28], false);
      return { hanche, genou, cheville };
    };
    this.jambes = [jambe(-1), jambe(1)];

    // Buste : veste, épaules, cou, tête.
    this.buste = pivot(this.bassin, 'buste', [0, 0.08, 0]);
    piece(this.buste, 'capsule', veste, [0, 0.25, 0], [0.37, 0.6, 0.23], ombres);
    piece(this.buste, 'box', veste, [0, 0.0, 0.0], [0.33, 0.14, 0.21], false); // bas de veste
    piece(this.buste, 'capsule', veste, [0, 0.46, 0], [0.19, 0.5, 0.21], ombres, [0, 0, 90]);
    piece(this.buste, 'cylinder', veste, [0, 0.58, 0.01], [0.16, 0.08, 0.16], false); // col
    piece(this.buste, 'cylinder', peau, [0, 0.63, 0], [0.1, 0.1, 0.1], false);
    this.tete = pivot(this.buste, 'tete', [0, 0.68, 0]);
    piece(this.tete, 'sphere', peau, [0, 0.11, 0], [0.19, 0.24, 0.21], ombres);
    piece(this.tete, 'sphere', peau, [0, 0.06, -0.075], [0.07, 0.07, 0.07], false); // nez/menton
    piece(this.tete, 'sphere', cheveux, [0, 0.16, 0.015], [0.205, 0.19, 0.215], ombres);
    piece(this.tete, 'sphere', peau, [-0.097, 0.11, 0.01], [0.035, 0.06, 0.04], false);
    piece(this.tete, 'sphere', peau, [0.097, 0.11, 0.01], [0.035, 0.06, 0.04], false);

    // Bras.
    const bras = (cote: number): Bras => {
      const epaule = pivot(this.buste, 'epaule', [cote * 0.22, 0.5, 0]);
      piece(epaule, 'capsule', veste, [0, -BRAS / 2, 0], [0.12, BRAS + 0.09, 0.12], ombres);
      const coude = pivot(epaule, 'coude', [0, -BRAS, 0]);
      piece(coude, 'capsule', veste, [0, -AVANT_BRAS / 2, 0], [0.1, AVANT_BRAS + 0.06, 0.1], ombres);
      piece(coude, 'sphere', peau, [0, -AVANT_BRAS - 0.05, 0], [0.08, 0.1, 0.06], false);
      return { epaule, coude };
    };
    this.bras = [bras(-1), bras(1)];
  }

  /**
   * Met à jour la pose. vitesse en m/s (vitesse réelle de la simulation), cap en radians.
   * dt = durée de l'image (rendu), pas un pas de simulation.
   */
  majPose(x: number, z: number, cap: number, vitesse: number, action: boolean, dt: number): void {
    this.temps += dt;
    this.racine.setPosition(x, 0.14, z);
    this.racine.setEulerAngles(0, cap * DEG, 0);

    this.vitesseLissee += (vitesse - this.vitesseLissee) * lissage(10, dt);
    const v = this.vitesseLissee;
    this.actionPoids += ((action ? 1 : 0) - this.actionPoids) * lissage(9, dt);

    // Mélange repos → marche → course.
    const enMouvement = borner((v - 0.15) / 0.6, 0, 1);
    const course = borner((v - 2.6) / 2.2, 0, 1);
    // Longueur d'un cycle complet (deux pas) en mètres : la cadence suit la distance parcourue.
    const cycle = 1.35 + course * 1.15 + borner(v / 6, 0, 1) * 0.2;
    const dPhase = (v / cycle) * Math.PI * 2 * dt;
    this.phase = (this.phase + dPhase) % (Math.PI * 2);
    if (enMouvement < 0.05) this.phase += (0 - Math.sin(this.phase)) * lissage(4, dt) * 0.5; // revient au neutre

    // Événements de pas : à chaque passage de la phase par 0 et π (pose du talon).
    const demi = Math.floor(this.phase / Math.PI);
    if (demi !== this.dernierePhasePas && enMouvement > 0.3) {
      this.onPas?.(demi === 0 ? 'gauche' : 'droite', 0.4 + course * 0.6);
    }
    this.dernierePhasePas = demi;

    // Inclinaison du buste vers l'avant (vitesse) et sur le côté dans les virages.
    const vitesseRotation = ((((cap - this.capPrecedent + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / Math.max(dt, 1e-4));
    this.capPrecedent = cap;
    this.inclinaison += (borner(-vitesseRotation * v * 0.6, -14, 14) - this.inclinaison) * lissage(6, dt);
    this.penche += ((4 * enMouvement + 10 * course) - this.penche) * lissage(5, dt);

    const amplitudeHanche = (24 + 22 * course) * enMouvement;
    const flexionGenou = (38 + 52 * course) * enMouvement;
    const angles: [number, number][] = [];
    for (let i = 0; i < 2; i++) {
      const p = this.phase + i * Math.PI;
      const hanche = Math.sin(p) * amplitudeHanche + course * 8 * enMouvement; // en degrés, + = vers l'avant
      // Le genou plie surtout pendant le retour de la jambe (phase de suspension).
      const genou = (Math.max(0, Math.sin(p - 1.4)) * flexionGenou + 6 * enMouvement + 3) * -1;
      angles.push([hanche, genou]);
      const j = this.jambes[i]!;
      j.hanche.setLocalEulerAngles(hanche, 0, 0);
      j.genou.setLocalEulerAngles(genou, 0, 0);
      // Pied à plat sur le sol au contact, pointe relevée en fin de retour.
      const pied = -(hanche + genou) + Math.max(0, Math.cos(p)) * 12 * enMouvement;
      j.cheville.setLocalEulerAngles(pied, 0, 0);
    }

    // IK simple : hauteur du bassin = jambe la plus « longue » verticalement (le pied d'appui touche le sol).
    let hBassin = 0;
    for (const [h, g] of angles) {
      const t = h / DEG;
      const s = (h + g) / DEG;
      hBassin = Math.max(hBassin, CUISSE * Math.cos(t) + TIBIA * Math.cos(s) + CHEVILLE);
    }
    const respiration = Math.sin(this.temps * 1.6) * 0.006 * (1 - enMouvement);
    const envol = course * Math.max(0, Math.sin(this.phase * 2)) * 0.05; // phase de suspension en course
    this.bassin.setLocalPosition(Math.sin(this.phase) * 0.02 * enMouvement, hBassin + respiration + envol, 0);
    this.bassin.setLocalEulerAngles(0, Math.sin(this.phase) * 7 * enMouvement, this.inclinaison * 0.4);

    // Buste : contre-rotation des épaules, penché en avant, balancement au repos.
    const balancementRepos = Math.sin(this.temps * 0.7) * 1.5 * (1 - enMouvement);
    this.buste.setLocalEulerAngles(-this.penche, -Math.sin(this.phase) * 12 * enMouvement, this.inclinaison * 0.6 + balancementRepos);
    this.tete.setLocalEulerAngles(this.penche * 0.6, Math.sin(this.temps * 0.4) * 6 * (1 - enMouvement), 0);

    // Bras : opposés aux jambes, coudes pliés davantage en course ; action = bras droit levé, poing fermé.
    for (let i = 0; i < 2; i++) {
      const b = this.bras[i]!;
      const p = this.phase + i * Math.PI + Math.PI;
      const balancier = Math.sin(p) * (18 + 30 * course) * enMouvement;
      let epaule = balancier + 4;
      let coude = 10 + 15 * enMouvement + 65 * course + Math.max(0, Math.sin(p)) * 20 * course;
      let ecart = (i === 0 ? -1 : 1) * (6 + 3 * (1 - enMouvement));
      if (i === 1) {
        const a = this.actionPoids;
        epaule = epaule * (1 - a) + (165 + Math.sin(this.temps * 9) * 6) * a;
        coude = coude * (1 - a) + 15 * a;
        ecart = ecart * (1 - a) + 12 * a;
      }
      b.epaule.setLocalEulerAngles(epaule, 0, ecart);
      b.coude.setLocalEulerAngles(coude, 0, 0);
    }

    // L'ombre de contact rétrécit légèrement quand le corps s'élève.
    const s = 1.1 - envol * 2;
    this.ombre.setLocalScale(s, 1, s * 1.05);
  }
}
