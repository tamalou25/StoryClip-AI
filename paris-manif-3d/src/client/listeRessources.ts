// Liste des fichiers de ressources par qualité (module pur, partagé par le chargeur et les tests).

export type QualiteRessources = 'basse' | 'haute';

export const TEXTURES_PBR = ['concrete_tiles_02', 'cobblestone_floor_09', 'asphalt_02', 'bark_platanus', 'beige_wall_001'] as const;
export const CARTES_PBR = ['couleur', 'normale', 'arm'] as const;

export function cheminTexture(id: string, q: QualiteRessources, carte: string): string {
  return `textures/${id}/${q}/${carte}.webp`;
}

export function fichiersRessources(q: QualiteRessources) {
  return {
    pbr: Object.fromEntries(TEXTURES_PBR.map((id) => [id, CARTES_PBR.map((c) => cheminTexture(id, q, c))])) as Record<(typeof TEXTURES_PBR)[number], string[]>,
    rameau: `textures/feuillage/${q}/rameau.webp`,
    ciel: `hdri/ciel-${q === 'haute' ? '2k' : '1k'}.hdr`,
    lampadaire: `modeles/lampadaire-${q}.glb`,
    banc: `modeles/banc-${q}.glb`,
    statue: `modeles/statue-${q}.glb`,
    manifestant: 'modeles/manifestant.glb',
    passant: 'modeles/passant.glb',
  };
}
