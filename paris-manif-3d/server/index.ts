// Point d'entrée du serveur de jeu.
// Développement : npm run serveur   ·   Production : npm run serveur:build && npm run serveur:start

import { configDepuisEnv } from './config';
import { demarrerServeur } from './serveur';

const serveur = await demarrerServeur(configDepuisEnv());

let arret = false;
async function arreter(signal: string): Promise<void> {
  if (arret) return;
  arret = true;
  console.log(JSON.stringify({ t: new Date().toISOString(), evenement: 'arret', signal }));
  await serveur.fermer();
  process.exit(0);
}
process.on('SIGINT', () => void arreter('SIGINT'));
process.on('SIGTERM', () => void arreter('SIGTERM'));
