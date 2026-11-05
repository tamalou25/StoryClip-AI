// Chargement des ressources tierces stockées dans public/ressources (aucun lien externe au lancement).
// La qualité choisit les variantes : textures 2048/1024 et HDRI 2k en haute, 512/256 et HDRI 1k en basse.

import * as pc from 'playcanvas';
import type { Qualite } from './decor';
import { fichiersRessources } from './listeRessources';

const BASE = `${import.meta.env.BASE_URL}ressources/`;

export interface TexturePBR {
  couleur: pc.Texture;
  normale: pc.Texture;
  /** AO (R), rugosité (G), métal (B). */
  arm: pc.Texture;
}

export interface Ressources {
  dalles: TexturePBR;
  paves: TexturePBR;
  asphalte: TexturePBR;
  ecorce: TexturePBR;
  pierre: TexturePBR;
  rameau: pc.Texture;
  ciel: pc.Texture;
  lampadaire: pc.ContainerResource;
  banc: pc.ContainerResource;
  statue: pc.ContainerResource;
  manifestant: pc.ContainerResource;
  passant: pc.ContainerResource;
}

function charger<T>(app: pc.Application, url: string, type: string, donnees: Record<string, unknown> = {}): Promise<T> {
  return new Promise((ok, echec) => {
    const asset = new pc.Asset(url, type, { url }, donnees);
    asset.once('load', () => ok(asset.resource as T));
    asset.once('error', (err: unknown) => echec(new Error(`Ressource introuvable : ${url} (${String(err)})`)));
    app.assets.add(asset);
    app.assets.load(asset);
  });
}

/** Charge tout ; `progression` reçoit une valeur dans [0, 1]. */
export async function chargerRessources(app: pc.Application, qualite: Qualite, progression: (p: number) => void): Promise<Ressources> {
  const q = qualite;
  let faits = 0;
  let total = 0;
  const suivre = <T>(p: Promise<T>): Promise<T> => {
    total++;
    return p.then((v) => {
      faits++;
      progression(faits / total);
      return v;
    });
  };
  const tex = (url: string, srgb: boolean) =>
    // Les cartes de couleur sont en sRGB ; normales et ARM restent linéaires.
    suivre(charger<pc.Texture>(app, url, 'texture', { srgb })).then((t) => {
      t.anisotropy = Math.min(q === 'haute' ? 8 : 2, app.graphicsDevice.maxAnisotropy);
      t.addressU = pc.ADDRESS_REPEAT;
      t.addressV = pc.ADDRESS_REPEAT;
      return t;
    });
  const f = fichiersRessources(q);
  const pbr = async (id: keyof typeof f.pbr): Promise<TexturePBR> => {
    const [c, n, a] = f.pbr[id];
    const [couleur, normale, arm] = await Promise.all([tex(BASE + c, true), tex(BASE + n!, false), tex(BASE + a!, false)]);
    return { couleur, normale, arm };
  };
  const modele = (chemin: string) => suivre(charger<pc.ContainerResource>(app, BASE + chemin, 'container'));

  const [dalles, paves, asphalte, ecorce, pierre, rameau, ciel, lampadaire, banc, statue, manifestant, passant] = await Promise.all([
    pbr('concrete_tiles_02'),
    pbr('cobblestone_floor_09'),
    pbr('asphalt_02'),
    pbr('bark_platanus'),
    pbr('beige_wall_001'),
    tex(BASE + f.rameau, true),
    suivre(charger<pc.Texture>(app, BASE + f.ciel, 'texture')),
    modele(f.lampadaire),
    modele(f.banc),
    modele(f.statue),
    modele(f.manifestant),
    modele(f.passant),
  ]);
  return { dalles, paves, asphalte, ecorce, pierre, rameau, ciel, lampadaire, banc, statue, manifestant, passant };
}
