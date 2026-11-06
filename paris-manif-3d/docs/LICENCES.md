# Licences et provenance

## Dépendances (vérifiées dans le registre npm le 05/11/2026)

| Paquet | Version | Licence | Usage |
|---|---|---|---|
| playcanvas | 2.23.3 | MIT | Moteur 3D (livré au client) |
| vite | 8.3.5 | MIT | Développement / build |
| typescript | 6.0.3 | Apache-2.0 | Développement |
| vitest | 5.0.5 | MIT | Tests |
| @playwright/test | 1.63.0 | Apache-2.0 | Tests |
| @gltf-transform/core, functions, extensions | 4.5.1 | MIT | Préparation des modèles (hors client) |
| meshoptimizer | 1.3.0 | MIT | Simplification des maillages (hors client) |
| sharp | 0.35.5 | Apache-2.0 | Conversion WebP des textures (hors client) |
| @types/node | 22.20.5 | MIT | Typage des tests |
| colyseus (prévu) | 0.18.x | MIT | Serveur, incrément 4 — à revérifier à l'installation |

## Ressources tierces (toutes CC0 1.0, domaine public)

Aucune attribution n'est exigée par CC0 ; elle est donnée ici par respect des auteurs et pour la traçabilité.
Licences vérifiées le 05/11/2026 sur les pages des sources. Liste lisible par machine : `public/ressources/CREDITS.json`.

| Ressource | Source | Auteur(s) | Usage dans le jeu | Transformations |
|---|---|---|---|---|
| `concrete_tiles_02` (texture PBR) | [Poly Haven](https://polyhaven.com/a/concrete_tiles_02) | Charlotte Baglioni | Dalles de l'esplanade (1,825 m) | WebP 2048 (haute) / 512 (basse) ; teinte légèrement éclaircie dans le matériau |
| `cobblestone_floor_09` (texture PBR) | [Poly Haven](https://polyhaven.com/a/cobblestone_floor_09) | Charlotte Baglioni | Pavés : bandes d'arbres, bordures, trottoirs | WebP 1024 / 512 |
| `asphalt_02` (texture PBR) | [Poly Haven](https://polyhaven.com/a/asphalt_02) | Rob Tuytel | Chaussée | WebP 1024 / 512, teinte assombrie |
| `bark_platanus` (texture PBR) | [Poly Haven](https://polyhaven.com/a/bark_platanus) | Dimitrios Savva | Écorce des platanes | WebP 1024 / 256 |
| `beige_wall_001` (texture PBR) | [Poly Haven](https://polyhaven.com/a/beige_wall_001) | Dimitrios Savva, Rico Cilliers | Pierre (corps des immeubles, monument) et normales de détail des façades | WebP 1024 / 512 |
| `street_lamp_01` (modèle glTF) | [Poly Haven](https://polyhaven.com/a/street_lamp_01) | Josh Dean | Candélabres (3,87 m) | GLB ; 15 400 triangles (haute) / 3 900 (basse) ; textures WebP 1024 / 256 |
| `modular_street_seating` (modèle glTF) | [Poly Haven](https://polyhaven.com/a/modular_street_seating) | Stuart Attenborrow | Bancs | Un seul module droit extrait et recentré ; GLB 12 500 / 5 700 triangles ; WebP 512 / 256 |
| `gothic_statue` (modèle glTF) | [Poly Haven](https://polyhaven.com/a/gothic_statue) | Benny Weimer | Statue allégorique (fictive) du monument, ×2,2 | GLB 16 600 / 14 700 triangles ; WebP 1024 / 512 |
| `kloofendal_38d_partly_cloudy_puresky` (HDRI) | [Poly Haven](https://polyhaven.com/a/kloofendal_38d_partly_cloudy_puresky) | Greg Zaal, Jarod Guest | Ciel et éclairage d'ambiance (IBL), fin d'après-midi (soleil à 38°) | `.hdr` 2k (haute) / 1k (basse), sans modification ; ciel tourné pour placer le soleil au sud-ouest |
| `LeafSet010` (atlas de feuilles) | [ambientCG](https://ambientcg.com/view?id=LeafSet010) | Lennart Demes | Feuillage des platanes | Rameau composé par script (34 feuilles tournées, teintées, sur une tige dessinée) ; WebP 512 avec transparence |
| *Ultimate Modular Men* (Feb 2022) : `Casual_Hoodie`, `Casual_2` | [Quaternius](https://quaternius.com/packs/ultimatemodularcharacters.html) | Quaternius | Manifestant jouable, passants | Retravaillés dans Blender (`blender/scripts/personnage.py`) : soudure, subdivision partielle, normales lisses, rugosités, couleurs de sommet ; animations conservées : Idle, Idle_Neutral, Walk, Run, Wave → `manifestant-lisse.glb`, `passant-lisse.glb`. Licence d'origine copiée : `public/ressources/modeles/LICENCE-Quaternius.txt` |

## Modèles créés dans Blender pour le projet (licence du projet)
Générés par scripts Python exécutés dans Blender 4.5.15 LTS (logiciel sous GPL ; la licence de l'outil ne
s'applique pas aux fichiers produits). Sources `.blend` dans `blender/sources/`, scripts dans `blender/scripts/`.

| Modèle | Script | Contenu | Triangles haute / basse |
|---|---|---|---|
| `facade-{haute,basse}.glb` | `facade.py` | Kit haussmannien par travée de 3 m : rez-de-chaussée à refends (boutique ou porte cochère), étages (baie profonde, chambranle, appui, linteau, menuiseries), balcons filants sur consoles, balconnets, corniche à modillons, lucarne, store banne | 2 982 / 794 (jeu de pièces) |
| `monument-{haute,basse}.glb` | `monument.py` | Piédestal : emmarchement en granit, socle mouluré, dé à plaques de bronze et médaillons, corniche, attique | 4 478 / 430 |
| `platane-{a,b,c}-{haute,basse}.glb` | `platane.py` | Platanes communs procéduraux : fût, charpentières, ramifications, cartes de feuillage (LeafSet010) | ≈ 5 500 / ≈ 1 000 |

Textures générées en code pour ces modèles : joints d'assise de la pierre, atlas de 8 devantures et
enseignes **inventées**, toiles de stores rayées (`src/client/textures.ts`).

### Reproduire
```bash
node scripts/assets/telecharger.mjs   # → assets-sources/ (non versionné, ≈ 50 Mo)
node scripts/assets/preparer.mjs      # → public/ressources/ (versionné, 18 Mo)
```
La liste des sources est dans `scripts/assets/sources.json`.

### Accès réseau constatés le 05/11/2026 (environnement de développement)
| Hôte | Résultat | Conséquence |
|---|---|---|
| api.polyhaven.com, dl.polyhaven.org | accessibles | textures, modèles, HDRI téléchargés |
| download.blender.org | accessible | Blender 4.5.15 LTS installé dans `/opt/blender` (somme SHA-256 vérifiée) |
| fab.com | recherche accessible (API de listing testée) ; le téléchargement passe par l'ajout à la bibliothèque d'un compte Epic, impossible ici sans identifiants (non vérifié plus avant) ; licences propres à Fab, non CC0 | aucun asset Fab utilisé |
| ambientcg.com | accessible | atlas de feuilles téléchargé |
| quaternius.com, itch.io | accessibles | pages et licence consultées |
| drive.google.com (lien de téléchargement officiel Quaternius) | « Quota exceeded » | personnages récupérés depuis une copie publique du pack sur raw.githubusercontent.com (dépôt `osman-1002/3D-3rd-Person-Godot-Game-With-GenAI-Integration`, dossier `addons/Ultimate Modular Men- Feb 2022/`), qui contient le `License.txt` CC0 d'origine. L'identité octet par octet avec le fichier officiel n'a pas pu être vérifiée. |
| kenney.nl, poly.pizza, github.com (pages web, codeload) | refusés (403) | non utilisés |

## Ressources générées par le code du projet
Pas d'équivalent libre adapté trouvé, donc fait en code (licence du projet) :
- façades haussmanniennes : travées, moulures, balcons en fer forgé, rez-de-chaussée et **enseignes inventées**, toits en zinc (`src/client/textures.ts`, `decor.ts`), enrichies des normales photographiques de `beige_wall_001` ;
- socle du monument, barrières, colonne d'affichage et **affiches fictives**, plaques de rue aux **noms inventés** ;
- ambiance sonore et bruits de pas, synthétisés en direct (`src/client/son.ts`) : aucun fichier audio.

## Code
Code original. Aucun code copié d'Hémicycle (seulement des principes, voir `AUDIT-HEMICYCLE.md`). Licence du projet : à choisir par le propriétaire (aucune pour l'instant = tous droits réservés).

## Contenu
Pas de logos, insignes, uniformes exacts, noms d'unités ni personnes réelles. Lieu « inspiré de » : aucune photo ni texture issue de cartes ou d'images protégées. La statue est une figure allégorique générique, pas la statue réelle de la place de la République.
