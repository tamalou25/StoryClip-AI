// Application PlayCanvas, caméra et réglages de rendu selon la qualité.
// Haute : anticrénelage, ombres en cascades, occlusion ambiante (SSAO), bloom léger, étalonnage.
// Basse : résolution 1×, une seule cascade d'ombre courte, aucun post-traitement.

import * as pc from 'playcanvas';
import type { Qualite } from './decor';

export type { Qualite };

export function creerApplication(canvas: HTMLCanvasElement, qualite: Qualite): pc.Application {
  const app = new pc.Application(canvas, {
    graphicsDeviceOptions: { antialias: false, powerPreference: 'high-performance', alpha: false },
  });
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.graphicsDevice.maxPixelRatio = qualite === 'haute' ? Math.min(window.devicePixelRatio, 2) : Math.min(window.devicePixelRatio, 1);
  window.addEventListener('resize', () => app.resizeCanvas());
  return app;
}

export function creerCamera(app: pc.Application, qualite: Qualite): { entite: pc.Entity; cadre: pc.CameraFrame | null } {
  const entite = new pc.Entity('camera');
  entite.addComponent('camera', {
    clearColor: new pc.Color(0.8, 0.84, 0.87),
    fov: 55,
    nearClip: 0.08,
    farClip: qualite === 'haute' ? 420 : 260,
    toneMapping: pc.TONEMAP_ACES,
    gammaCorrection: pc.GAMMA_SRGB,
  });
  app.root.addChild(entite);

  if (qualite === 'basse') return { entite, cadre: null };

  const cadre = new pc.CameraFrame(app, entite.camera!);
  cadre.rendering.samples = 4;
  cadre.rendering.toneMapping = pc.TONEMAP_ACES;
  cadre.rendering.renderTargetScale = 1;
  cadre.ssao.type = pc.SSAOTYPE_COMBINE;
  cadre.ssao.intensity = 0.55;
  cadre.ssao.radius = 0.9;
  cadre.ssao.samples = 12;
  cadre.ssao.power = 3;
  cadre.ssao.blurEnabled = true;
  cadre.bloom.intensity = 0.012;
  cadre.bloom.blurLevel = 14;
  cadre.grading.enabled = true;
  cadre.grading.brightness = 0.98;
  cadre.grading.contrast = 1.06;
  cadre.grading.saturation = 0.94;
  cadre.grading.tint = new pc.Color(1, 0.99, 0.96);
  cadre.vignette.intensity = 0.25;
  cadre.vignette.inner = 0.55;
  cadre.vignette.outer = 1.2;
  cadre.vignette.curvature = 0.6;
  cadre.update();
  return { entite, cadre };
}
