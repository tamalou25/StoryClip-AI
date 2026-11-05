# Sécurité, réseau et confort (plan)

✅ = en place, ⬜ = prévu (incrément indiqué).

## Messages et autorité
- ✅ Intention validée : objet simple, clés connues seulement, nombres finis, longueur ramenée à 1 (`src/sim/intention.ts`, testé).
- ✅ Le client ne transmet jamais position ni score ; la simulation calcule tout (`src/sim/`).
- ⬜ (4) Taille maximale des messages (ex. 256 octets), rejet + compteur, déconnexion après abus.
- ⬜ (4) Une intention par pas et par joueur au maximum ; surplus ignoré.
- ⬜ (5) Temps de recharge et équipements vérifiés côté serveur.

## Limites de fréquence
- ⬜ (7) Connexions et créations de salon par IP (fenêtre glissante).
- ⬜ (7) Actions par joueur (déjà bornées par la simulation à pas fixe).

## Salons
- ⬜ (7) Privés, code aléatoire non devinable, expiration, suppression des salons vides, 4 joueurs max, 8 bots max au total.
- ⬜ (7) Départ d'un joueur : remplacé par un bot, la partie continue ; reconnexion limitée dans le temps.

## Données
- ⬜ (7) Pseudonyme : texte non fiable, longueur bornée, affiché via `textContent` uniquement, jamais en HTML.
- ✅ Aucun secret dans le client (aucun n'existe). ⬜ Secrets serveur en variables d'environnement.
- ⬜ (7) Production : `wss://` (TLS) uniquement, origine vérifiée.
- ⬜ Journaux minimaux : événements de salon, erreurs ; ni pseudonyme complet ni IP en clair au-delà du nécessaire.

## Confort
- ✅ Pas de flash ni de secousse ; `prefers-reduced-motion` respecté pour les boutons.
- ✅ Qualité basse par défaut sur écran tactile (pixel ratio 1, sans ombres ni anticrénelage).
- ⬜ (8) Gaz fictif : opacité limitée, pas de clignotement, option de réduction.

## Cibles à mesurer (non mesurées à ce jour)
30 i/s en qualité basse sur téléphones de référence ; partie 4 joueurs + 8 bots ; jouable sous 150 ms ; aucune partie bloquée par un départ.
