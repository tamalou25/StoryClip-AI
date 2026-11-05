// Éléments 3D propres au multijoueur : un Personnage3D par participant, cercles d'objectifs,
// étiquettes de noms (DOM, textContent uniquement : les pseudonymes sont du texte non fiable).

import * as pc from 'playcanvas';
import type { Camp, EtatObjectif, ObjectifVue, ParticipantVue } from '../../reseau/protocole';
import { Personnage3D } from '../personnage';

/**
 * Teintes du modèle de personnage par camp (matériaux nommés du glTF, voir src/client/main.ts) :
 * manifestants comme en solo, forces de l'ordre en tenue sombre fictive, sans insigne.
 */
const TEINTES: Record<Camp, Record<string, string>> = {
  manifestants: { Purple: '#3c4350', LightBlue: '#2a3346', White: '#d9d5cc' },
  forces: { Purple: '#1d2633', LightBlue: '#141a22', White: '#5d6672' },
};

const COULEURS: Record<EtatObjectif, [number, number, number]> = {
  0: [0.75, 0.75, 0.72],
  1: [0.88, 0.64, 0.23],
  2: [0.36, 0.56, 0.85],
  3: [0.89, 0.34, 0.3],
};

interface Entree {
  modele: Personnage3D;
  etiquette: HTMLElement;
  pose: { x: number; z: number };
}

export class SceneMulti {
  private readonly personnages = new Map<string, Entree>();
  private zones: { entite: pc.Entity; materiau: pc.StandardMaterial; etat: EtatObjectif }[] = [];
  private temps = 0;
  private readonly ecran = new pc.Vec3();
  private readonly monde = new pc.Vec3();

  constructor(private readonly app: pc.Application, private readonly calque: HTMLElement, private readonly modele: pc.ContainerResource) {}

  /** (Re)crée les personnages et objectifs d'une partie ; aucun reste de la partie précédente. */
  preparer(participants: readonly ParticipantVue[], objectifs: readonly ObjectifVue[], monId: string | null): void {
    this.vider();
    for (const p of participants) {
      const modele = new Personnage3D(this.app, this.modele, TEINTES[p.camp]);
      const etiquette = document.createElement('span');
      etiquette.className = `etiquette ${p.camp}`;
      etiquette.textContent = p.nom;
      etiquette.hidden = p.id === monId;
      this.calque.append(etiquette);
      this.personnages.set(p.id, { modele, etiquette, pose: { x: 0, z: 0 } });
    }
    for (const o of objectifs) {
      const materiau = new pc.StandardMaterial();
      materiau.blendType = pc.BLEND_NORMAL;
      materiau.depthWrite = false;
      materiau.useLighting = false;
      materiau.opacity = 0.35;
      materiau.update();
      const entite = new pc.Entity(`objectif-${o.id}`);
      entite.addComponent('render', { type: 'cylinder', material: materiau, castShadows: false, receiveShadows: false });
      entite.setLocalScale(o.rayon * 2, 0.04, o.rayon * 2);
      entite.setPosition(o.x, 0.03, o.z);
      this.app.root.addChild(entite);
      this.zones.push({ entite, materiau, etat: 0 });
      this.colorer(this.zones.length - 1, 0);
    }
  }

  majPersonnage(id: string, x: number, z: number, cap: number, vitesse: number, action: boolean, dt: number): void {
    const e = this.personnages.get(id);
    if (!e) return;
    e.modele.majPose(x, z, cap, vitesse, action, dt);
    e.pose.x = x;
    e.pose.z = z;
  }

  /** Nom affiché et état (« reconnexion », « parti → bot ») d'un participant humain. */
  majPresence(id: string, nom: string, absent: string | null): void {
    const e = this.personnages.get(id);
    if (!e) return;
    e.etiquette.textContent = absent ? `${nom} · ${absent}` : nom;
    e.etiquette.classList.toggle('absent', absent !== null);
  }

  majObjectifs(etats: readonly EtatObjectif[], dt: number): void {
    this.temps += dt;
    etats.forEach((etat, i) => {
      const z = this.zones[i];
      if (!z) return;
      if (z.etat !== etat) this.colorer(i, etat);
      if (etat === 3) {
        z.materiau.opacity = 0.3 + 0.15 * Math.sin(this.temps * 6);
        z.materiau.update();
      }
    });
  }

  /** Place les étiquettes de noms au-dessus des têtes (projection écran). */
  majEtiquettes(camera: pc.CameraComponent): void {
    for (const e of this.personnages.values()) {
      if (e.etiquette.hidden) continue;
      this.monde.set(e.pose.x, 2.15, e.pose.z);
      camera.worldToScreen(this.monde, this.ecran);
      const visible = this.ecran.z > 0 && this.ecran.z < 60;
      e.etiquette.style.visibility = visible ? 'visible' : 'hidden';
      if (visible) e.etiquette.style.transform = `translate(${Math.round(this.ecran.x)}px, ${Math.round(this.ecran.y)}px) translate(-50%, -100%)`;
    }
  }

  vider(): void {
    for (const e of this.personnages.values()) {
      e.modele.racine.destroy();
      e.etiquette.remove();
    }
    this.personnages.clear();
    for (const z of this.zones) {
      z.entite.destroy();
      z.materiau.destroy();
    }
    this.zones = [];
  }

  private colorer(i: number, etat: EtatObjectif): void {
    const z = this.zones[i]!;
    z.etat = etat;
    const [r, g, b] = COULEURS[etat];
    z.materiau.emissive = new pc.Color(r, g, b);
    z.materiau.diffuse = new pc.Color(r, g, b);
    z.materiau.opacity = etat === 0 ? 0.25 : 0.4;
    z.materiau.update();
  }
}
