# Licences et provenance

## Dépendances (vérifiées dans le registre npm le 05/11/2026)

| Paquet | Version | Licence | Usage |
|---|---|---|---|
| playcanvas | 2.23.3 | MIT | Moteur 3D (livré au client) |
| vite | 8.3.5 | MIT | Développement / build |
| typescript | 6.0.3 | Apache-2.0 | Développement |
| vitest | 5.0.5 | MIT | Tests |
| @playwright/test | 1.63.0 | Apache-2.0 | Tests |
| colyseus (prévu) | 0.18.x | MIT | Serveur, incrément 4 — à revérifier à l'installation |

## Assets
Aucun asset externe. Toutes les ressources sont **générées par le code du projet** au chargement (licence du projet) :
- textures procédurales canvas (`src/client/textures.ts`) : dalles, pavés, asphalte, travées haussmanniennes, rez-de-chaussée et enseignes **inventées**, zinc, écorce, feuillage, bronze, ciel, garde-corps, affiches fictives ; cartes de normales dérivées de cartes de hauteur ;
- géométrie (`src/client/geometrie.ts`, `decor.ts`, `personnage.ts`) : primitives PlayCanvas et maillages construits en code ;
- sons synthétisés en direct avec Web Audio (`src/client/son.ts`) : aucun fichier audio.
Aucun modèle 3D ni son tiers n'a été téléchargé : les hôtes d'assets testés (dl.polyhaven.org, kenney.nl, github.com) étaient bloqués par le réseau de l'environnement de développement.
Avant d'ajouter un asset : noter source, auteur, licence (CC0 de préférence), URL et date dans ce tableau.

| Asset | Source | Licence | Date |
|---|---|---|---|
| — | — | — | — |

## Code
Code original. Aucun code copié d'Hémicycle (seulement des principes, voir `AUDIT-HEMICYCLE.md`). Licence du projet : à choisir par le propriétaire (aucune pour l'instant = tous droits réservés).

## Contenu
Pas de logos, insignes, uniformes exacts, noms d'unités ni personnes réelles. Lieu « inspiré de » : volumes stylisés, aucune photo ni texture issue de cartes ou d'images protégées.
