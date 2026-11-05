// Personnages animés : modèles Quaternius « Ultimate Modular Men » (CC0, voir docs/LICENCES.md).
// - Locomotion : mélange 1D Repos → Marche → Course piloté par la vitesse de la simulation.
// - Cadence calée sur les vitesses naturelles des animations (mesurées par cinématique directe sur
//   le pied d'appui : marche 1,26 m/s, course 2,84 m/s) : les pieds glissent peu.
// - Action : couche « haut du corps » (masque à partir de l'abdomen) jouant « Wave », mélangée en douceur.

import * as pc from 'playcanvas';
import { borner, lissage } from '../sim/math';
import { ombreContact, texture } from './textures';

/** Vitesses naturelles (m/s) des animations du pack, mesurées hors ligne. */
export const VITESSE_ANIM_MARCHE = 1.26;
export const VITESSE_ANIM_COURSE = 2.84;
/** Longueur d'un pas (m) : vitesse × durée du cycle / 2. */
const PAS_MARCHE = (1.333 * VITESSE_ANIM_MARCHE) / 2;
const PAS_COURSE = (0.8 * VITESSE_ANIM_COURSE) / 2;
const DEG = 180 / Math.PI;

export type EvenementPas = (intensite: number) => void;

function piste(conteneur: pc.ContainerResource, nom: string): pc.AnimTrack {
  const a = conteneur.animations.find((x) => (x.resource as pc.AnimTrack).name === nom);
  if (!a) throw new Error(`Animation absente du modèle : ${nom}`);
  return a.resource as pc.AnimTrack;
}

/** Remplace les couleurs de certains matériaux (copie locale : les autres instances ne changent pas). */
function teindre(modele: pc.Entity, teintes: Record<string, string>, gloss: number): void {
  const copies = new Map<pc.Material, pc.StandardMaterial>();
  for (const r of modele.findComponents('render') as pc.RenderComponent[]) {
    r.castShadows = true;
    for (const mi of r.meshInstances) {
      const origine = mi.material as pc.StandardMaterial;
      let copie = copies.get(origine);
      if (!copie) {
        copie = origine.clone();
        const hex = teintes[origine.name];
        if (hex) copie.diffuse = new pc.Color().fromString(hex);
        // Tissus et peau mats : le pack est réglé assez brillant pour un rendu « jouet ».
        if (origine.name !== 'Eye') copie.gloss = Math.min(copie.gloss, gloss);
        copie.metalness = 0;
        copie.update();
        copies.set(origine, copie);
      }
      mi.material = copie;
    }
  }
}

/** Chemin d'un os depuis l'entité porteuse de l'animation (format des masques PlayCanvas). */
function chemin(depuis: pc.Entity, os: pc.GraphNode): string {
  const noms: string[] = [];
  let n: pc.GraphNode | null = os;
  while (n && n !== depuis) {
    noms.unshift(n.name);
    n = n.parent;
  }
  return noms.join('/');
}

function ombre(app: pc.Application): pc.Entity {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(0, 0, 0);
  m.opacityMap = texture(app.graphicsDevice, ombreContact(), false, 1, false);
  m.opacityMapChannel = 'a';
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.useLighting = false;
  m.update();
  const e = new pc.Entity('ombreContact');
  e.addComponent('render', { type: 'plane', material: m, castShadows: false, receiveShadows: false });
  e.setLocalScale(1.0, 1, 1.0);
  e.setLocalPosition(0, 0.012, 0);
  return e;
}

export class Personnage3D {
  readonly racine: pc.Entity;
  private readonly modele: pc.Entity;
  private readonly coucheAction: pc.AnimComponentLayer;
  private vitesseLissee = 0;
  private actionPoids = 0;
  private capPrecedent = 0;
  private inclinaison = 0;
  private distancePas = 0;
  onPas: EvenementPas | null = null;

  constructor(app: pc.Application, conteneur: pc.ContainerResource, teintes: Record<string, string>) {
    this.racine = new pc.Entity('personnage');
    app.root.addChild(this.racine);
    this.racine.addChild(ombre(app));

    // Pivot pour ne pas écraser la transformation du nœud racine du GLB.
    this.modele = new pc.Entity('modele');
    this.modele.addChild(conteneur.instantiateRenderEntity());
    this.modele.setLocalEulerAngles(0, 180, 0); // le modèle regarde vers +z ; le jeu, vers −z
    this.racine.addChild(this.modele);
    teindre(this.modele, teintes, 0.3);

    this.modele.addComponent('anim', { activate: true });
    const anim = this.modele.anim!;
    anim.loadStateGraph({
      layers: [
        {
          name: 'Base',
          states: [
            { name: 'START' },
            {
              name: 'Locomotion',
              speed: 1,
              loop: true,
              blendTree: {
                type: pc.ANIM_BLEND_1D,
                parameter: 'vitesse',
                syncAnimations: true,
                children: [
                  { name: 'Repos', point: 0 },
                  { name: 'Marche', point: VITESSE_ANIM_MARCHE },
                  { name: 'Course', point: VITESSE_ANIM_COURSE },
                ],
              },
            },
          ],
          transitions: [{ from: 'START', to: 'Locomotion' }],
        },
        {
          name: 'Action',
          blendType: pc.ANIM_LAYER_OVERWRITE,
          states: [{ name: 'START' }, { name: 'Salut', speed: 1, loop: true }],
          transitions: [{ from: 'START', to: 'Salut' }],
        },
      ],
      parameters: { vitesse: { name: 'vitesse', type: pc.ANIM_PARAMETER_FLOAT, value: 0 } },
    });
    anim.assignAnimation('Locomotion.Repos', piste(conteneur, 'Idle'), 'Base');
    anim.assignAnimation('Locomotion.Marche', piste(conteneur, 'Walk'), 'Base');
    anim.assignAnimation('Locomotion.Course', piste(conteneur, 'Run'), 'Base');
    anim.assignAnimation('Salut', piste(conteneur, 'Wave'), 'Action');

    this.coucheAction = anim.findAnimationLayer('Action');
    const abdomen = this.modele.findByName('Abdomen');
    if (abdomen) this.coucheAction.mask = { [chemin(this.modele, abdomen)]: { children: true } };
    this.coucheAction.weight = 0;
  }

  /** Pose et animation. vitesse en m/s (simulation), cap en radians, dt = durée de l'image. */
  majPose(x: number, z: number, cap: number, vitesse: number, action: boolean, dt: number): void {
    this.racine.setPosition(x, 0.14, z);
    this.racine.setEulerAngles(0, cap * DEG, 0);

    this.vitesseLissee += (vitesse - this.vitesseLissee) * lissage(12, dt);
    const v = this.vitesseLissee < 0.05 ? 0 : this.vitesseLissee;
    const anim = this.modele.anim!;
    anim.setFloat('vitesse', Math.min(v, VITESSE_ANIM_COURSE));
    // Cadence : ralentie en marche lente, accélérée au-delà de la course naturelle.
    anim.speed = v > VITESSE_ANIM_COURSE ? v / VITESSE_ANIM_COURSE : v > 0.15 && v < VITESSE_ANIM_MARCHE ? Math.max(0.7, v / VITESSE_ANIM_MARCHE) : 1;

    this.actionPoids += ((action ? 1 : 0) - this.actionPoids) * lissage(8, dt);
    this.coucheAction.weight = this.actionPoids;

    // Légère inclinaison dans les virages (le corps se penche vers l'intérieur).
    const vitesseRotation = (((cap - this.capPrecedent + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / Math.max(dt, 1e-4);
    this.capPrecedent = cap;
    this.inclinaison += (borner(-vitesseRotation * v * 0.5, -10, 10) - this.inclinaison) * lissage(6, dt);
    this.modele.setLocalEulerAngles(0, 180, -this.inclinaison);

    // Bruits de pas : un pas tous les ~0,84 m en marche, ~1,14 m en course.
    if (v > 0.3) {
      const mel = borner((v - VITESSE_ANIM_MARCHE) / (VITESSE_ANIM_COURSE - VITESSE_ANIM_MARCHE), 0, 1);
      const pas = PAS_MARCHE + (PAS_COURSE - PAS_MARCHE) * mel;
      this.distancePas += v * dt;
      if (this.distancePas >= pas) {
        this.distancePas -= pas;
        this.onPas?.(0.35 + mel * 0.65);
      }
    } else {
      this.distancePas = 0;
    }
  }
}

/** Passant immobile (animation de repos), pour donner de la vie à la place. */
export function passant(app: pc.Application, conteneur: pc.ContainerResource, x: number, z: number, regard: number, teintes: Record<string, string>, decalage: number): pc.Entity {
  const racine = new pc.Entity('passant');
  racine.setPosition(x, 0.14, z);
  racine.setEulerAngles(0, regard * DEG, 0);
  racine.addChild(ombre(app));
  const modele = new pc.Entity('modele');
  modele.addChild(conteneur.instantiateRenderEntity());
  modele.setLocalEulerAngles(0, 180, 0);
  racine.addChild(modele);
  teindre(modele, teintes, 0.3);
  modele.addComponent('anim', { activate: true, speed: 0.9 + decalage * 0.2 });
  modele.anim!.assignAnimation('Repos', piste(conteneur, decalage > 0.5 ? 'Idle_Neutral' : 'Idle'));
  modele.anim!.baseLayer!.activeStateCurrentTime = decalage * 1.6; // désynchronise les passants
  app.root.addChild(racine);
  return racine;
}
