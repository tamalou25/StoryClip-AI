# Sécurité, réseau et confort

✅ = en place, ⬜ = prévu (incrément indiqué).

## Messages et autorité
- ✅ Intention validée : objet simple, clés connues seulement, nombres finis, longueur ramenée à 1 (`src/sim/intention.ts`, testé).
- ✅ Le client ne transmet jamais position ni score ; la simulation calcule tout (`src/sim/`).
- ✅ Taille maximale des messages : 512 octets (`maxPayload`, fermeture 1009) ; messages invalides avertis puis expulsion (4002) au-delà de 20 en 10 s ; validation clé par clé (`src/reseau/protocole.ts`). Testé (`server/tests/securite.test.ts`).
- ✅ Une intention appliquée par pas et par joueur ; numéro déjà vu ignoré (rejeu), file bornée (8 visés, 16 max), longueur ramenée à 1 par le serveur. Testé (intention de longueur 50, rafale de rejeux).
- ⬜ (5) Temps de recharge et équipements vérifiés côté serveur.

- ✅ Socket morte (ping WebSocket sans réponse) coupée en ≤ 10 s ; client trop lent (> 256 Ko en attente) déconnecté ; une exception dans un salon ne ferme que ce salon.

## Limites de fréquence
- ✅ Connexions simultanées, créations de salon et tentatives de « rejoindre / reprendre » par IP (fenêtres glissantes, `PM3D_*`). Derrière un proxy : dernière entrée de `X-Forwarded-For` seulement. Testé.
- ✅ Seau à jetons par connexion (60 messages, 40/s ; messages de salon 10, 3/s) ; expulsion (4008) au-delà de 100 refus en 10 s. Testé.

## Salons
- ✅ Privés, code de 5 caractères tiré par `crypto.randomInt` (33,5 M de combinaisons, tentatives limitées par IP), suppression des salons vides, 4 joueurs max, bots de complément jusqu'à égalité d'effectif (3 au plus). Une connexion n'agit que sur son salon. Testé (isolation de 4 salons).
- ✅ Départ ou délai dépassé : remplacé par un bot jusqu'à la fin, la partie continue ; reconnexion par jeton de 128 bits (comparé à temps constant) pendant `PM3D_GRACE_S` (30 s). Testé. Détails : [RESEAU.md](RESEAU.md).

## Données
- ✅ Pseudonyme : NFC, caractères de contrôle / bidi / invisibles retirés, 16 caractères, dédoublonné, affiché via `textContent` uniquement (vérifié dans le navigateur avec `Bob <b>`).
- ✅ Aucun secret dans le client ni sur le serveur (aucun n'est nécessaire) ; configuration par variables d'environnement.
- 🟡 Origine vérifiée si `PM3D_ORIGINES` est défini (testé) — **à définir en production**. `wss://` : le client l'utilise automatiquement sur une page `https://` ; TLS à fournir par le proxy de l'hébergeur (non testé, pas encore déployé).
- ✅ Journaux minimaux : une ligne JSON par événement de salon, identifiants de place (`j1`…) seulement, ni pseudonyme ni IP.

## Confort
- ✅ Pas de flash ni de secousse ; `prefers-reduced-motion` respecté pour les boutons.
- ✅ Qualité basse par défaut sur écran tactile (pixel ratio 1, sans ombres ni anticrénelage).
- ⬜ (8) Gaz fictif : opacité limitée, pas de clignotement, option de réduction.

## Cibles à mesurer (non mesurées à ce jour)
30 i/s en qualité basse sur téléphones de référence ; partie 4 joueurs + 8 bots ; jouable sous 150 ms ; aucune partie bloquée par un départ.
