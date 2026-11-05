# Règles du jeu (incrément 5–6 : partie solo complète)

Partie de 5 min (ou 3 min) sur la place. Deux camps, un joueur humain, dix bots au total. Tout ce qui suit vit dans `src/sim/` (aucune dépendance au rendu) ; les constantes sont dans `src/sim/regles.ts`.

## Objectif

| Camp | Victoire | Défaite |
|---|---|---|
| Manifestants (6) | **Mobilisation à 100 %** : chaque seconde où une zone est tenue rapporte 1 point ; cible = 0,8 × durée (240 points sur 5 min, soit « une zone tenue 80 % du temps » ou deux zones 40 % du temps) | Temps écoulé, ou tous dispersés en même temps |
| Forces de l'ordre (5) | **Temps écoulé** avec mobilisation < 100 %, ou **place dégagée** (tous les manifestants hors-jeu en même temps) | Mobilisation à 100 %, ou toutes les unités en repli en même temps (« déroute ») |

Trois zones (anneaux au sol) : Parvis ouest (r 6 m), Monument (r 9 m, anneau autour du socle), Parvis est (r 6 m). Le contrôle d'une zone glisse de −1 à +1 à 0,12 par seconde et par personne d'écart (écart plafonné à 3) ; elle est « tenue » au-delà de ±0,5. Un manifestant dans un nuage ne compte pas.

## Souffle (endurance)

- 100 points. Au contact (< 1,7 m) d'une force de l'ordre, un manifestant perd 12 pts/s (×1,5 si l'unité est en cordon). Dans un nuage : −9 pts/s et vitesse ÷ 2.
- Une force de l'ordre ne perd rien seule contre un ; dès deux manifestants au contact elle perd 9 pts/s par manifestant (×0,65 en cordon).
- À zéro : hors-jeu 9 s (manifestant « dispersé ») ou 11 s (unité « en repli »), puis retour au point de départ avec 80 % de souffle.
- Récupération : +9 pts/s après 1,5 s sans perte ; +9 de plus pour un manifestant avec au moins deux camarades à 3 m.
- Les acteurs se poussent (cercles de 0,4 m) : une unité pèse 1,5, un cordon qui tient l'action pèse 4, un manifestant 1. Trois manifestants font reculer un cordon lentement.

## Actions (Espace / bouton Action, maintenu)

| Camp | Action | Effet |
|---|---|---|
| Manifestants | Rassembler | Les camarades bots à 15 m viennent se placer derrière et à côté de vous et vous suivent |
| Forces de l'ordre | Cordon | Les unités bots à 15 m (3 au plus) se placent à vos côtés ; un cordon (unités à 2,6 m) frappe plus fort, encaisse mieux et pèse lourd |

## Spéciaux (F ou Ctrl / bouton Spécial, front montant)

| Camp | Spécial | Effet | Limite |
|---|---|---|---|
| Manifestants | Slogan | +30 souffle et +22 % de vitesse pendant 5 s pour les camarades à 9 m | recharge 18 s |
| Forces de l'ordre | Gaz fictif | Nuage de 4,5 m, 11 s, à 5 m devant vous : ralentit, essouffle, annule la capture | 3 charges, +1 toutes les 22 s, 1,2 s entre deux lancers |

Réponses prévues : au gaz → sortir du nuage et contourner (les bots le font d'eux-mêmes) ; au cordon → le déborder par le nombre ou changer de zone ; au rassemblement → gaz sur le groupe puis cordon.

## Bots (`src/sim/bots.ts`)

- Décision par utilité toutes les 0,3–0,9 s selon la difficulté : zone à prendre ou défendre (besoin, distance, nombre d'amis et d'adversaires, gaz), poursuite d'un adversaire isolé ou faible, suivi du meneur qui rassemble / forme le cordon, repli quand le souffle baisse, sortie immédiate d'un nuage.
- Navigation : grille 1 m dérivée de la carte, A* 8 directions, lissage par visibilité. Déblocage : sans progrès pendant 1,3 s, pas de côté aléatoire puis nouveau chemin.
- Difficulté (« Adversaires faciles / normaux / coriaces ») : s'applique aux bots du camp adverse ; vos coéquipiers restent « normaux ». Réglages dans `PROFILS` : temps de réflexion, usage des spéciaux, perception, vitesse, seuil de repli.
- Déterminisme : graine dans l'état (`alea.ts`, mulberry32). Même graine + mêmes intentions = même partie.

## Équilibre mesuré (bots contre bots, `npm run equilibrage`, 24 parties par difficulté, 05/11/2026)

| Difficulté | Victoires manifestants | Durée moyenne | Fins |
|---|---|---|---|
| Faciles | 19/24 | 203 s | surtout mobilisation atteinte |
| Normaux | 12/24 | 240 s | mobilisation 12, temps écoulé 9, place dégagée 3 |
| Coriaces | 2/24 | 184 s | place dégagée 15, temps écoulé 7 |

En solo, la difficulté ne touche que les adversaires : ces chiffres bots-contre-bots donnent l'ordre de grandeur, pas l'expérience du joueur.
