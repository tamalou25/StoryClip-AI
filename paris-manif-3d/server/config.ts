// Lecture de la configuration depuis les variables d'environnement (voir docs/RESEAU.md).

import { OPTIONS_DEFAUT, type OptionsServeur } from './serveur';

function nombre(env: NodeJS.ProcessEnv, nom: string, defaut: number, min: number, max: number): number {
  const brut = env[nom];
  if (brut === undefined || brut === '') return defaut;
  const n = Number(brut);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${nom} invalide : ${brut} (attendu entre ${min} et ${max})`);
  return n;
}

export function configDepuisEnv(env: NodeJS.ProcessEnv = process.env): Partial<OptionsServeur> {
  const origines = (env.PM3D_ORIGINES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    port: nombre(env, 'PM3D_PORT', env.PORT ? Number(env.PORT) : OPTIONS_DEFAUT.port, 0, 65535),
    hote: env.PM3D_HOTE || OPTIONS_DEFAUT.hote,
    origines: origines.length > 0 ? origines : null,
    statique: env.PM3D_STATIQUE || null,
    dureePartieS: nombre(env, 'PM3D_DUREE_PARTIE_S', OPTIONS_DEFAUT.dureePartieS, 5, 3600),
    compteS: nombre(env, 'PM3D_COMPTE_S', OPTIONS_DEFAUT.compteS, 0, 30),
    graceS: nombre(env, 'PM3D_GRACE_S', OPTIONS_DEFAUT.graceS, 1, 600),
    salonsMax: nombre(env, 'PM3D_SALONS_MAX', OPTIONS_DEFAUT.salonsMax, 1, 10000),
    connexionsParIp: nombre(env, 'PM3D_CONNEXIONS_PAR_IP', OPTIONS_DEFAUT.connexionsParIp, 1, 1000),
    creationsParMinute: nombre(env, 'PM3D_CREATIONS_PAR_MINUTE', OPTIONS_DEFAUT.creationsParMinute, 1, 1000),
    tentativesParMinute: nombre(env, 'PM3D_TENTATIVES_PAR_MINUTE', OPTIONS_DEFAUT.tentativesParMinute, 1, 10000),
    confianceProxy: env.PM3D_CONFIANCE_PROXY === '1',
  };
}
