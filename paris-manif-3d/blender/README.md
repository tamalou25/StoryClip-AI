# Sources Blender

Blender **4.5.15 LTS** (archive officielle download.blender.org, SHA-256 vérifiée), piloté en arrière-plan par scripts Python.

```bash
/opt/blender/blender -b --factory-startup --python blender/scripts/<script>.py
```

| Dossier | Contenu |
|---|---|
| `scripts/` | Générateurs reproductibles (un script = un ou plusieurs exports) |
| `sources/` | Fichiers `.blend` enregistrés par les scripts (textures référencées, non embarquées) |

## Conventions d'export (communes à tous les scripts)
- Unités : mètres. Axe vertical +Y dans le glTF (réglage par défaut de l'exportateur), origine au sol.
- Sortie : `public/ressources/modeles/<nom>-haute.glb` et `<nom>-basse.glb` (niveaux de détail).
- **Matériaux par nom** : les GLB ne contiennent pas de textures ; PlayCanvas remplace chaque matériau par le
  matériau partagé du même nom (`src/client/decor.ts`). Noms utilisés : `pierre`, `pierre_claire`, `corniche`,
  `zinc`, `vitre`, `menuiserie`, `ferronnerie`, `devanture`, `ecorce`, `feuillage`, `bronze`, `fonte`.
- UV en mètres (1 unité UV = 1 m) pour les matières répétées (pierre, zinc, écorce), afin que l'échelle des
  textures soit la même partout ; UV 0–1 pour les cartes (feuillage, ferronnerie, devanture).

## Scripts et exports (exécutés dans cette session, Blender 4.5.15 LTS en arrière-plan)

| Script | Exports | Source `.blend` | Rôle |
|---|---|---|---|
| `facade.py` | `facade-haute.glb`, `facade-basse.glb` | `facade.blend` (niveau haut) | Kit haussmannien par travée de 3 m (8 pièces nommées : `rdc_boutique`, `rdc_porte`, `etage_simple`, `etage_balcon`, `etage_balconnet`, `corniche`, `lucarne`, `store`) |
| `monument.py` | `monument-haute.glb`, `monument-basse.glb` | `monument.blend` (niveau haut) | Piédestal du monument ; la statue Poly Haven est posée par le jeu à 7,13 m |
| `platane.py` | `platane-{a,b,c}-{haute,basse}.glb` | `platanes.blend` | Platanes procéduraux, 3 variantes, 2 niveaux de détail |
| `personnage.py` | `manifestant-lisse.glb`, `passant-lisse.glb` | `personnages.blend` | Personnages Quaternius soudés, subdivisés partiellement, lissés ; 5 animations |

Variables d'environnement facultatives : `APERCU_FACADE=<fichier.png>` et `APERCU_MONUMENT=<fichier.png>` produisent un
rendu d'aperçu Cycles (CPU). `platane.py -- --apercu <dossier>` rend les aperçus des arbres.

## Vérifications et limites
- Le conteneur n'a pas `libEGL` : Eevee et Workbench ne peuvent pas rendre, seuls les aperçus **Cycles CPU** sont possibles.
  Le rendu de référence est donc celui du jeu (PlayCanvas, Chromium) : `node e2e/vues.mjs`.
- Les faces du kit de façade sont orientées explicitement à leur création (pas de recalcul automatique des
  normales, peu fiable sur des pièces ouvertes) : PlayCanvas n'affiche qu'une face.
- Les niveaux bas sont reconstruits par le script (mêmes noms de nœuds) ; seul le niveau haut est enregistré dans
  le `.blend` de la façade et du monument.
- Pas de connecteur MCP Blender dans cette session : tout passe par `blender -b --python`.
