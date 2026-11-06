# Piédestal du monument central (fictif), proportions d'un monument commémoratif parisien.
# Exécution : /opt/blender/blender -b --factory-startup --python blender/scripts/monument.py
# Sorties   : public/ressources/modeles/monument-haute.glb, monument-basse.glb ; blender/sources/monument.blend
# La statue (gothic_statue, Poly Haven) est posée par le jeu sur le couronnement (y = 7,25 m).
# Repère Blender : Z vertical, monument centré sur l'origine. Matériaux remplacés par nom dans PlayCanvas :
# granit (emmarchement), pierre_claire (socle, dé, corniches), bronze (plaques, médaillons, guirlandes).

import math
import os

import bmesh
import bpy
from mathutils import Vector

ICI = os.path.dirname(os.path.abspath(__file__))
PROJET = os.path.normpath(os.path.join(ICI, '..', '..'))
SORTIE = os.path.join(PROJET, 'public', 'ressources', 'modeles')
SOURCE = os.path.join(PROJET, 'blender', 'sources', 'monument.blend')

COULEURS = {'granit': (0.45, 0.43, 0.4, 1), 'pierre_claire': (0.85, 0.8, 0.7, 1), 'bronze': (0.25, 0.2, 0.12, 1)}


def materiau(nom):
    m = bpy.data.materials.get(nom)
    if m:
        return m
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = COULEURS[nom]
    p.inputs['Roughness'].default_value = 0.4 if nom == 'bronze' else 0.7
    p.inputs['Metallic'].default_value = 0.8 if nom == 'bronze' else 0.0
    return m


class Maillage:
    def __init__(self, nom):
        self.nom = nom
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.mats = []

    def mat(self, nom):
        if nom not in self.mats:
            self.mats.append(nom)
        return self.mats.index(nom)

    def anneaux(self, profil, mat, segments_coin=0):
        """Moulure carrée : profil [(demi-côté, z), …] de bas en haut, révolu en carré (angles en onglet)."""
        idx = self.mat(mat)
        anneaux = []
        for (a, z) in profil:
            pts = [(-a, -a, z), (a, -a, z), (a, a, z), (-a, a, z)]
            anneaux.append([self.bm.verts.new(p) for p in pts])
        for r0, r1 in zip(anneaux, anneaux[1:]):
            for k in range(4):
                f = self.bm.faces.new([r0[k], r0[(k + 1) % 4], r1[(k + 1) % 4], r1[k]])
                f.material_index = idx
        return anneaux

    def couvercle(self, anneau, mat, haut=True):
        f = self.bm.faces.new(anneau if haut else list(reversed(anneau)))
        f.material_index = self.mat(mat)

    def pave(self, x0, x1, y0, y1, z0, z1, mat, biseau=0.0, segments=1):
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        for v in tmp.verts:
            v.co.x = x0 if v.co.x < 0 else x1
            v.co.y = y0 if v.co.y < 0 else y1
            v.co.z = z0 if v.co.z < 0 else z1
        if biseau > 0:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=biseau, segments=segments, affect='EDGES', profile=0.5)
        self.fusionner(tmp, mat)

    def tore(self, centre, axe, rayon, epaisseur, mat, n=24, m=8):
        """Couronne (laurier stylisé) : tore dans le plan perpendiculaire à l'axe."""
        tmp = bmesh.new()
        bmesh.ops.create_circle(tmp, segments=n, radius=rayon)
        # Construit le tore à la main pour rester léger.
        tmp.free()
        tmp = bmesh.new()
        anneaux = []
        for i in range(n):
            t = 2 * math.pi * i / n
            c = Vector((math.cos(t) * rayon, math.sin(t) * rayon, 0))
            r = Vector((math.cos(t), math.sin(t), 0))
            anneaux.append([tmp.verts.new(c + r * math.cos(2 * math.pi * j / m) * epaisseur + Vector((0, 0, math.sin(2 * math.pi * j / m) * epaisseur))) for j in range(m)])
        for i in range(n):
            a, b = anneaux[i], anneaux[(i + 1) % n]
            for j in range(m):
                tmp.faces.new([a[j], b[j], b[(j + 1) % m], a[(j + 1) % m]])
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)  # tore fermé : orientation fiable
        rot = Vector((0, 0, 1)).rotation_difference(Vector(axe)).to_matrix().to_4x4()
        bmesh.ops.transform(tmp, matrix=rot, verts=tmp.verts)
        bmesh.ops.translate(tmp, vec=Vector(centre), verts=tmp.verts)
        self.fusionner(tmp, mat)

    def fusionner(self, tmp, mat):
        idx = self.mat(mat)
        corr = {v: self.bm.verts.new(v.co) for v in tmp.verts}
        for f in tmp.faces:
            nf = self.bm.faces.new([corr[v] for v in f.verts])
            nf.material_index = idx
        tmp.free()

    def objet(self):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        for f in self.bm.faces:  # UV en mètres selon l'orientation de la face
            n = f.normal
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            for loop in f.loops:
                c = loop.vert.co
                loop[self.uv].uv = (c.y, c.z) if ax >= ay and ax >= az else (c.x, c.z) if ay >= az else (c.x, c.y)
        me = bpy.data.meshes.new(self.nom)
        self.bm.to_mesh(me)
        self.bm.free()
        for nom in self.mats:
            me.materials.append(materiau(nom))
        ob = bpy.data.objects.new(self.nom, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def piedestal(detail):
    M = Maillage('monument')
    # Emmarchement : trois marches à nez arrondi (granit).
    z = 0.0
    for (cote, h) in ((9.0, 0.37), (8.2, 0.37), (7.4, 0.36)):
        a = cote / 2
        M.pave(-a, a, -a, a, z, z + h, 'granit', 0.035 if detail else 0.0, 2 if detail else 1)
        z += h
    # Socle mouluré (pierre claire) : plinthe, tore, cavet, puis dé.
    s = 2.6
    profil_socle = [(s, z), (s, z + 0.35), (s - 0.05, z + 0.4), (s - 0.12, z + 0.48), (s - 0.25, z + 0.58), (s - 0.3, z + 0.7)]
    if not detail:
        profil_socle = [(s, z), (s, z + 0.4), (s - 0.3, z + 0.7)]
    M.anneaux(profil_socle, 'pierre_claire')
    z += 0.7
    de = 2.0
    M.anneaux([(s - 0.3, z), (de + 0.08, z), (de + 0.08, z + 0.12), (de, z + 0.18)], 'pierre_claire')
    z += 0.18
    z_de = z
    h_de = 3.3
    # Dé : faces avec panneaux en creux et plaques de bronze encadrées.
    M.anneaux([(de, z), (de, z + h_de)], 'pierre_claire')
    for k in range(4):
        ang = k * math.pi / 2
        c, s_ = math.cos(ang), math.sin(ang)

        def rep(x, y, zz):
            return (x * c - y * s_, x * s_ + y * c, zz)

        # Cadre mouluré en saillie autour de la plaque (face avant y = −de).
        w, hz0, hz1 = 1.2, z_de + 0.7, z_de + 2.7
        for (x0, x1, za, zb) in ((-w - 0.14, -w, hz0 - 0.14, hz1 + 0.14), (w, w + 0.14, hz0 - 0.14, hz1 + 0.14),
                                 (-w, w, hz0 - 0.14, hz0), (-w, w, hz1, hz1 + 0.14)):
            tmp = bmesh.new()
            bmesh.ops.create_cube(tmp, size=1.0)
            for v in tmp.verts:
                v.co.x = x0 if v.co.x < 0 else x1
                v.co.y = -de - 0.06 if v.co.y < 0 else -de + 0.01
                v.co.z = za if v.co.z < 0 else zb
            if detail:
                bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=0.015, segments=1, affect='EDGES', profile=0.5)
            for v in tmp.verts:
                v.co = Vector(rep(v.co.x, v.co.y, v.co.z))
            M.fusionner(tmp, 'pierre_claire')
        # Plaque de bronze (légère saillie) et médaillon à couronne.
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        for v in tmp.verts:
            v.co.x = -w if v.co.x < 0 else w
            v.co.y = -de - 0.03 if v.co.y < 0 else -de + 0.01
            v.co.z = hz0 if v.co.z < 0 else hz1
        for v in tmp.verts:
            v.co = Vector(rep(v.co.x, v.co.y, v.co.z))
        M.fusionner(tmp, 'bronze')
        if detail:
            centre = Vector(rep(0, -de - 0.06, (hz0 + hz1) / 2))
            axe = Vector(rep(0, -1, 0)) - Vector(rep(0, 0, 0))
            M.tore(centre, axe, 0.55, 0.06, 'bronze')
            M.tore(centre, axe, 0.42, 0.035, 'bronze')
    # Chaînes d'angle (pilastres) aux quatre coins du dé.
    for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        M.pave(sx * de - 0.22 if sx > 0 else -de - 0.04, sx * de + 0.04 if sx > 0 else -de + 0.22,
               sy * de - 0.22 if sy > 0 else -de - 0.04, sy * de + 0.04 if sy > 0 else -de + 0.22,
               z_de, z_de + h_de, 'pierre_claire', 0.012 if detail else 0.0)
    z = z_de + h_de
    # Corniche du dé.
    prof = [(de, z), (de + 0.1, z + 0.08), (de + 0.12, z + 0.16), (de + 0.3, z + 0.26), (de + 0.32, z + 0.38), (de + 0.32, z + 0.45)]
    if not detail:
        prof = [(de, z), (de + 0.32, z + 0.3), (de + 0.32, z + 0.45)]
    anneaux = M.anneaux(prof, 'pierre_claire')
    z += 0.45
    # Attique en retrait puis couronnement.
    att = 1.5
    M.anneaux([(de + 0.32, z), (att, z)], 'pierre_claire')
    M.anneaux([(att, z), (att, z + 1.15)], 'pierre_claire')
    z += 1.15
    prof2 = [(att, z), (att + 0.08, z + 0.06), (att + 0.2, z + 0.16), (att + 0.2, z + 0.25)]
    top = M.anneaux(prof2, 'pierre_claire')
    z += 0.25
    M.couvercle(top[-1], 'pierre_claire')
    print(f'couronnement à z = {z:.3f} m')
    return M.objet()


def exporter(ob, chemin):
    for o in bpy.context.scene.objects:
        o.select_set(o == ob)
    bpy.ops.export_scene.gltf(filepath=chemin, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='NONE',
                              export_cameras=False, export_lights=False, export_animations=False)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print(f'EXPORT {os.path.basename(chemin)} : {tris} triangles, {os.path.getsize(chemin) // 1024} ko, matériaux {[m.name for m in ob.data.materials]}')


def apercu(chemin):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 24; sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 900, 900
    sc.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('ciel'); sc.world = w; w.use_nodes = True
    ciel = w.node_tree.nodes.new('ShaderNodeTexSky'); ciel.sun_elevation = math.radians(38)
    w.node_tree.links.new(ciel.outputs['Color'], w.node_tree.nodes['Background'].inputs['Color'])
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
    l = bpy.data.lights.new('soleil', 'SUN'); l.energy = 4; so = bpy.data.objects.new('soleil', l)
    so.rotation_euler = (math.radians(52), 0, math.radians(-35)); sc.collection.objects.link(so)
    c = bpy.data.cameras.new('cam'); c.lens = 35; co = bpy.data.objects.new('cam', c); sc.collection.objects.link(co)
    co.location = (-9, -11, 4); co.rotation_euler = (Vector((0, 0, 4.2)) - co.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    sc.render.filepath = chemin
    bpy.ops.render.render(write_still=True)
    print('APERCU', chemin)


bpy.ops.wm.read_factory_settings(use_empty=True)
os.makedirs(SORTIE, exist_ok=True)
haute = piedestal(True)
exporter(haute, os.path.join(SORTIE, 'monument-haute.glb'))
if os.environ.get('APERCU_MONUMENT'):
    apercu(os.environ['APERCU_MONUMENT'])
bpy.ops.wm.save_as_mainfile(filepath=SOURCE)
bpy.ops.wm.read_factory_settings(use_empty=True)
basse = piedestal(False)
exporter(basse, os.path.join(SORTIE, 'monument-basse.glb'))
