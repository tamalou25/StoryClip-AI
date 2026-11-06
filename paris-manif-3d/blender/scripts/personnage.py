"""Personnages lissés pour le jeu (Quaternius « Ultimate Modular Men », CC0).

Usage (depuis la racine du projet ou d'ailleurs) :
    /opt/blender/blender -b --factory-startup --python blender/scripts/personnage.py

Pour chaque personnage (joueur « manifestant » = Casual_Hoodie, « passant » = Casual_2) :
  1. import du glTF source (scène réglée à 30 i/s, la cadence des clés du pack) ;
  2. on ne garde que les animations Idle, Idle_Neutral, Walk, Run, Wave (noms cherchés par le jeu) ;
  3. maillage : sommets dupliqués soudés (le pack est « à facettes » : chaque quad a ses propres sommets),
     quads reconstruits, puis subdivision Catmull-Clark de niveau 1 PARTIELLE, appliquée au repos :
       - subdivisés : vêtements, peau des bras/jambes/tête, puis chaussures et cheveux si le budget
         de 15 000 triangles le permet (ordre de priorité ci-dessous) ;
       - jamais subdivisés : mains (doigts fins qui « fondent » : -25 % de rayon sur une section carrée),
         yeux, sourcils, oreilles et nez (petits îlots de 12 à 28 faces) ;
       - un CC complet donnerait ~26 000 triangles (hors budget) ;
       - le CC rétrécit les volumes (≈ -7 % de rayon sur un membre à 8 côtés) : la cage est d'abord
         « pré-gonflée » (P* = P - (CC(P) - P), plafonné à 6 mm) pour que la surface lisse repasse par
         les sommets d'origine (mesuré : sans cela la surface rentre de 0,5 mm en moyenne, 5 mm au
         1er centile ; avec, elle bombe de 0,5 mm entre les sommets) ;
       - arêtes vives → pli (crease) : > 60° sur les vêtements (ourlets, poignets, semelles),
         > 75° sur la peau (60° marquait le genou d'un pli parasite) ;
       - jointure étanche entre zones subdivisées et non subdivisées : les sommets de la frontière
         reprennent leur position d'origine et les arêtes frontière côté non subdivisé sont coupées au
         milieu (point d'arête du CC sur un bord = milieu exact), puis soudées ;
       - poids de skinning interpolés par le modificateur, puis limités à 4 influences et normalisés ;
  4. ombrage lisse, arêtes vives au-delà de 60° (tissus) / 80-85° (peau, cheveux) ;
     UV automatiques (Smart UV, échelle 1 UV = 1 m) ;
  5. variation subtile sans texture : couleur de sommet COLOR_0 = occlusion ambiante (lancer de rayons
     sur le personnage au repos) × léger bruit basse fréquence. PlayCanvas multiplie déjà COLOR_0 à la
     couleur diffuse (diffuseVertexColor), recoloration par nom comprise ;
  6. matériaux recréés à l'identique (mêmes noms, mêmes couleurs) : rugosité 0,85 tissus, 0,8 cheveux,
     0,55 peau, métal 0 ;
  7. export GLB (skinning 4 influences, animations échantillonnées nommées d'après les pistes NLA,
     sans caméras ni lumières) vers public/ressources/modeles/<nom>-lisse.glb ;
puis enregistrement de blender/sources/personnages.blend (une scène par personnage).
"""

import json
import math
import os
import random
import re

import bmesh
import bpy
from mathutils import Vector, kdtree, noise
from mathutils.bvhtree import BVHTree

ICI = os.path.dirname(os.path.abspath(__file__))
PROJET = os.path.normpath(os.path.join(ICI, '..', '..'))
SOURCES = os.path.join(PROJET, 'assets-sources', 'quaternius')
MODELES = os.path.join(PROJET, 'public', 'ressources', 'modeles')
BLEND = os.path.join(PROJET, 'blender', 'sources', 'personnages.blend')

PERSONNAGES = [
    {'nom': 'manifestant', 'source': 'Casual_Hoodie.gltf', 'sortie': 'manifestant-lisse.glb'},
    {'nom': 'passant', 'source': 'Casual_2.gltf', 'sortie': 'passant-lisse.glb'},
]
ANIMATIONS = ('Idle', 'Idle_Neutral', 'Walk', 'Run', 'Wave')
IPS = 30  # cadence des clés du pack (Run = 24 images = 0,8 s)

BUDGET_TRIANGLES = 15000
# Catégories subdivisées, par ordre de priorité (ajoutées tant que le budget le permet).
PRIORITES = ('vetements', 'peau', 'chaussures', 'cheveux')
PETIT_ILOT = 40  # faces (après reconstruction des quads) : oreilles, nez → jamais subdivisés
OS_MAIN = re.compile(r'^(Wrist|Thumb|Index|Middle|Ring|Pinky)\d*\.(L|R)$')
GONFLEMENT = 1.0  # compensation du rétrécissement CC (0 = CC brut)
GONFLEMENT_MAX = 0.006  # m : au-delà (ourlets repliés cachés), on ne compense pas tout
# Arêtes plus vives que ça : pli (crease) conservé par le CC.
ANGLE_PLI = {'vetements': math.radians(60), 'chaussures': math.radians(60),
             'peau': math.radians(75), 'cheveux': math.radians(75)}
# Arêtes plus vives que ça : normales séparées (ombrage). Tissus 60° (ourlets nets) ; peau et cheveux
# non subdivisés (mains, nez, oreilles, mèches) adoucis davantage pour effacer les facettes.
ANGLE_VIF = {'Hair': math.radians(85),
             'Skin': math.radians(80), 'Skin_Darker': math.radians(80)}
ANGLE_VIF_DEFAUT = math.radians(60)

RUGOSITE = {'Skin': 0.55, 'Skin_Darker': 0.6, 'Hair': 0.8, 'Eyebrows': 0.85, 'Eye': 0.3}
RUGOSITE_TISSU = 0.85  # Purple, LightBlue, White, LightBrown, Red_Dark…

AO_DISTANCE = 0.12  # m
AO_RAYONS = 48
AO_FORCE = 0.55  # assombrissement maximal (1 = noir dans les creux)
BRUIT_AMPLITUDE = 0.05
BRUIT_FREQUENCE = 9.0  # 1/m (motif d'environ 11 cm)


def journal(*args):
    print('[personnage]', *args, flush=True)


# ---------------------------------------------------------------------------------------------------
# Scène, import, animations, matériaux
# ---------------------------------------------------------------------------------------------------

def reinitialiser():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = PERSONNAGES[0]['nom']
    sc.render.fps = IPS
    sc.render.fps_base = 1.0
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0


def couleurs_source(chemin):
    """Couleurs de base des matériaux, lues directement dans le JSON du glTF source."""
    with open(chemin, encoding='utf-8') as f:
        j = json.load(f)
    return {m['name']: tuple(m['pbrMetallicRoughness']['baseColorFactor']) for m in j['materials']}


def materiau(nom, couleur):
    """Matériau propre (Principled seul, couleur unie), partagé entre personnages s'il existe déjà."""
    m = bpy.data.materials.get(nom)
    if m is not None and m.get('pm3d'):
        bsdf = m.node_tree.nodes['Principled BSDF']
        deja = tuple(bsdf.inputs['Base Color'].default_value)
        if max(abs(a - b) for a, b in zip(deja, couleur)) > 1e-4:
            raise RuntimeError(f'Matériau {nom} : couleurs différentes entre personnages ({deja} / {couleur})')
        return m
    if m is not None:
        m.name = nom + '.import'
    m = bpy.data.materials.new(nom)
    m['pm3d'] = True
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = couleur
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = RUGOSITE.get(nom, RUGOSITE_TISSU)
    m.diffuse_color = couleur
    m.roughness = bsdf.inputs['Roughness'].default_value
    m.metallic = 0.0
    return m


def importer(cfg):
    chemin = os.path.join(SOURCES, cfg['source'])
    col = bpy.data.collections.new(cfg['nom'])
    bpy.context.scene.collection.children.link(col)
    vl = bpy.context.view_layer
    vl.active_layer_collection = vl.layer_collection.children[col.name]
    avant = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=chemin, disable_bone_shape=True, merge_vertices=False)
    nouveaux = [o for o in bpy.data.objects if o not in avant]
    arm = next(o for o in nouveaux if o.type == 'ARMATURE')
    maillages = sorted((o for o in nouveaux if o.type == 'MESH'), key=lambda o: o.name)
    for o in nouveaux:
        if o.type not in ('ARMATURE', 'MESH'):
            bpy.data.objects.remove(o)

    # Matériaux : on remplace les matériaux importés (éventuellement suffixés .001) par des matériaux
    # propres portant exactement le nom du glTF.
    couleurs = couleurs_source(chemin)
    base_de = {}
    for o in maillages:
        for slot in o.material_slots:
            m = slot.material
            base = re.sub(r'\.\d{3}$', '', m.name)
            base_de[m] = base if base in couleurs else m.name
    propres = {base: materiau(base, couleurs[base]) for base in sorted(set(base_de.values()))}
    for o in maillages:
        for slot in o.material_slots:
            slot.material = propres[base_de[slot.material]]
    importes = set(base_de)
    for m in importes:
        if m.users == 0:
            bpy.data.materials.remove(m)
    return arm, maillages


def filtrer_animations(arm, nom):
    ad = arm.animation_data
    ad.action = None
    gardees = {}
    for piste in list(ad.nla_tracks):
        action = piste.strips[0].action if piste.strips else None
        if piste.name in ANIMATIONS and action is not None:
            gardees[piste.name] = action
            piste.mute = False
        else:
            ad.nla_tracks.remove(piste)
            if action is not None and action.users == 0:
                bpy.data.actions.remove(action)
    manquantes = set(ANIMATIONS) - set(gardees)
    if manquantes:
        raise RuntimeError(f'Animations absentes du source : {manquantes}')
    # Actions d'autres personnages ou orphelines : supprimées.
    for a in list(bpy.data.actions):
        if a.users == 0:
            bpy.data.actions.remove(a)
    for piste in ad.nla_tracks:
        # L'importateur place les bandes à l'image 1 : l'export échantillonnerait 1→fin+1 (une image
        # de trop, boucle décalée). On cale chaque bande sur l'image 0 = début de l'action.
        bande = piste.strips[0]
        bande.frame_start_ui = bande.action_frame_start
    for anim, action in gardees.items():
        action.name = f'{nom}_{anim}'  # le nom exporté est celui de la piste NLA (= anim)
        action.use_fake_user = False
    return {p.name: (p.strips[0].frame_start, p.strips[0].frame_end) for p in ad.nla_tracks}


# ---------------------------------------------------------------------------------------------------
# Géométrie
# ---------------------------------------------------------------------------------------------------

def preparer(ob):
    """Soude les sommets dupliqués (ombrage plat du pack) et reconstruit les quads."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.join_triangles(bm, faces=bm.faces[:], cmp_seam=False, cmp_sharp=False, cmp_uvs=False,
                             cmp_vcols=False, cmp_materials=True,
                             angle_face_threshold=math.radians(40), angle_shape_threshold=math.radians(40))
    n1 = len(bm.verts)
    bm.to_mesh(ob.data)
    bm.free()
    return n0, n1


def ilots(bm):
    taille = {}
    vus = set()
    for f in bm.faces:
        if f.index in vus:
            continue
        pile, groupe = [f], []
        vus.add(f.index)
        while pile:
            g = pile.pop()
            groupe.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in vus:
                        vus.add(h.index)
                        pile.append(h)
        for g in groupe:
            taille[g.index] = len(groupe)
    return taille


def categoriser(ob, bm):
    """Catégorie de chaque face : 'fixe' (jamais subdivisée) ou une entrée de PRIORITES."""
    bm.faces.ensure_lookup_table()
    mats = [m.name for m in ob.data.materials]
    dl = bm.verts.layers.deform.active
    os_main = {vg.index for vg in ob.vertex_groups if OS_MAIN.match(vg.name)}
    taille = ilots(bm)
    cat = {}
    for f in bm.faces:
        mat = mats[f.material_index]
        poids_main = sum(sum(w for g, w in v[dl].items() if g in os_main) for v in f.verts) / len(f.verts)
        if mat in ('Eye', 'Eyebrows') or taille[f.index] < PETIT_ILOT:
            cat[f.index] = 'fixe'
        elif mat.startswith('Skin') and poids_main > 0.5:
            cat[f.index] = 'fixe'  # main
        elif 'Feet' in ob.name:
            cat[f.index] = 'chaussures'
        elif mat == 'Hair':
            cat[f.index] = 'cheveux'
        elif mat.startswith('Skin'):
            cat[f.index] = 'peau'
        else:
            cat[f.index] = 'vetements'
    return cat


def estimer_triangles(maillages, inclus):
    """Triangles exportés si l'on subdivise les catégories `inclus` (calcul exact, avant export)."""
    total = 0
    for ob in maillages:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        cat = categoriser(ob, bm)
        for f in bm.faces:
            n = len(f.verts)
            total += 2 * n if cat[f.index] in inclus else n - 2
        for e in bm.edges:  # arête frontière : +1 sommet sur la face non subdivisée → +1 triangle
            c = {cat[f.index] in inclus for f in e.link_faces}
            if c == {True, False}:
                total += 1
        bm.free()
    return total


def points_sommets_cc(bm, S, pli, frontiere):
    """Position d'un sommet après un niveau de Catmull-Clark (règles lisse, pli/bord, coin)."""
    nouv = {}
    for v in {v for f in S for v in f.verts}:
        if v in frontiere:
            continue
        faces = [f for f in v.link_faces if f in S]
        aretes = [e for e in v.link_edges if any(f in S for f in e.link_faces)]
        vives = [e for e in aretes if sum(1 for f in e.link_faces if f in S) == 1 or e in pli]
        p = v.co
        if len(vives) == 2:
            a, b = (e.other_vert(v).co for e in vives)
            nouv[v] = (a + b + 6 * p) / 8
        elif len(vives) > 2:
            nouv[v] = p.copy()
        else:
            n = len(aretes)
            q = sum((f.calc_center_median() for f in faces), Vector()) / len(faces)
            r = sum(((e.verts[0].co + e.verts[1].co) / 2 for e in aretes), Vector()) / n
            nouv[v] = (q + 2 * r + (n - 3) * p) / n
    return nouv


def appliquer_subsurf(ob_modele, me):
    """Applique un CC niveau 1 sur le maillage `me` (objet temporaire, mêmes groupes de sommets)."""
    tmp = bpy.data.objects.new('tmp_subsurf', me)
    for vg in ob_modele.vertex_groups:
        if vg.name not in tmp.vertex_groups:
            tmp.vertex_groups.new(name=vg.name)
    bpy.context.scene.collection.objects.link(tmp)
    mod = tmp.modifiers.new('CC', 'SUBSURF')
    mod.subdivision_type = 'CATMULL_CLARK'
    mod.levels = mod.render_levels = 1
    mod.quality = 3
    mod.use_limit_surface = False  # positions du niveau 1 (pas projetées sur la surface limite)
    mod.use_creases = True
    mod.boundary_smooth = 'ALL'
    mod.uv_smooth = 'PRESERVE_BOUNDARIES'
    vl = bpy.context.view_layer
    vl.objects.active = tmp
    with bpy.context.temp_override(object=tmp, active_object=tmp, selected_objects=[tmp]):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(tmp)
    return me


def subdiviser(ob, inclus):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    # Toutes les couches d'abord : en ajouter une invalide les références Python déjà prises.
    creases = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
    zone = bm.faces.layers.int.new('zone')
    marque = bm.edges.layers.int.new('frontiere')
    cat = categoriser(ob, bm)
    bm.faces.ensure_lookup_table()
    S = {f for f in bm.faces if cat[f.index] in inclus}
    if not S:
        bm.free()
        return {'subdivisees': 0}
    aretes_frontiere = [e for e in bm.edges if {f in S for f in e.link_faces} == {True, False}]
    frontiere = {v for e in aretes_frontiere for v in e.verts}
    # Plis : arêtes intérieures à S plus vives que le seuil de leur catégorie (le plus haut des deux).
    pli = {e for e in bm.edges if len(e.link_faces) == 2 and all(f in S for f in e.link_faces)
           and e.calc_face_angle(0.0) > max(ANGLE_PLI[cat[f.index]] for f in e.link_faces)}
    for e in bm.edges:
        e[creases] = 1.0 if e in pli else 0.0

    # Pré-gonflement : P* = P - k (CC(P) - P), la frontière restant à sa place.
    cc = points_sommets_cc(bm, S, pli, frontiere)
    retrait = [(cc[v] - v.co).length for v in cc]
    bords_avant = sum(1 for e in bm.edges if e.is_boundary and all(f in S for f in e.link_faces))
    bords_fixes = sum(1 for e in bm.edges if e.is_boundary and not any(f in S for f in e.link_faces))
    for v, p in cc.items():
        d = GONFLEMENT * (p - v.co)
        if d.length > GONFLEMENT_MAX:
            d *= GONFLEMENT_MAX / d.length
        v.co = v.co - d

    for f in bm.faces:
        f[zone] = 1 if f in S else 0
    for e in aretes_frontiere:
        e[marque] = 1
    pos_frontiere = [v.co.copy() for v in frontiere]

    # A : partie subdivisée ; B : partie conservée.
    bm_a, bm_b = bm.copy(), bm.copy()
    bm.free()
    zone_a = bm_a.faces.layers.int['zone']
    bmesh.ops.delete(bm_a, geom=[f for f in bm_a.faces if f[zone_a] == 0], context='FACES')
    zone_b = bm_b.faces.layers.int['zone']
    bmesh.ops.delete(bm_b, geom=[f for f in bm_b.faces if f[zone_b] == 1], context='FACES')
    marque_b = bm_b.edges.layers.int['frontiere']
    coupes = [e for e in bm_b.edges if e[marque_b] == 1]
    for e in coupes:
        bmesh.utils.edge_split(e, e.verts[0], 0.5)

    me_a = ob.data.copy()
    bm_a.to_mesh(me_a)
    bm_a.free()
    appliquer_subsurf(ob, me_a)

    final = bmesh.new()
    final.from_mesh(me_a)
    bpy.data.meshes.remove(me_a)
    # Sommets de la frontière : retour exact à la position d'origine (le point d'arête est déjà au milieu).
    bords = [v for v in final.verts if v.is_boundary]
    arbre = kdtree.KDTree(len(bords))
    for i, v in enumerate(bords):
        arbre.insert(v.co, i)
    arbre.balance()
    ecart_max = 0.0
    for p in pos_frontiere:
        _, i, d = arbre.find(p)
        ecart_max = max(ecart_max, d)
        bords[i].co = p
    me_b = ob.data.copy()
    bm_b.to_mesh(me_b)
    bm_b.free()
    final.from_mesh(me_b)  # ajoute la partie B au maillage
    bpy.data.meshes.remove(me_b)
    nv = len(final.verts)
    bmesh.ops.remove_doubles(final, verts=[v for v in final.verts if v.is_boundary], dist=1e-6)
    soudes = nv - len(final.verts)
    for nom in ('zone',):
        if nom in final.faces.layers.int:
            final.faces.layers.int.remove(final.faces.layers.int[nom])
    for nom in ('frontiere',):
        if nom in final.edges.layers.int:
            final.edges.layers.int.remove(final.edges.layers.int[nom])
    if 'crease_edge' in final.edges.layers.float:
        final.edges.layers.float.remove(final.edges.layers.float['crease_edge'])
    bords_apres = sum(1 for e in final.edges if e.is_boundary)
    final.to_mesh(ob.data)
    final.free()
    # Contrôle d'étanchéité : chaque bord ouvert subdivisé devient 2 arêtes, rien d'autre ne s'ouvre.
    if bords_apres != 2 * bords_avant + bords_fixes:
        raise RuntimeError(f'{ob.name} : trou à la jointure ({bords_apres} arêtes de bord, '
                           f'attendu {2 * bords_avant + bords_fixes})')
    return {
        'bords': bords_apres,
        'subdivisees': len(S), 'frontiere_aretes': len(aretes_frontiere), 'soudes': soudes,
        'attendus': len(frontiere) + len(aretes_frontiere), 'ecart_frontiere_mm': round(ecart_max * 1000, 2),
        'plis': len(pli), 'retrait_cc_moyen_mm': round(1000 * sum(retrait) / max(1, len(retrait)), 2),
        'retrait_cc_max_mm': round(1000 * max(retrait, default=0), 2),
    }


def nettoyer_poids(ob, max_influences=4, seuil=0.005):
    """Au plus 4 influences par sommet (limite glTF/PlayCanvas), somme = 1."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    dl = bm.verts.layers.deform.active
    nmax = 0
    for v in bm.verts:
        d = v[dl]
        items = sorted(((g, w) for g, w in d.items() if w > seuil), key=lambda x: -x[1])
        nmax = max(nmax, len(items))
        items = items[:max_influences]
        tot = sum(w for _, w in items)
        d.clear()
        for g, w in items:
            d[g] = w / tot
    bm.to_mesh(ob.data)
    bm.free()
    return nmax


def ombrer(ob):
    """Ombrage lisse ; arête vive si son angle dépasse le seuil du matériau (le plus bas des deux)."""
    me = ob.data
    me.shade_smooth()
    mats = [m.name for m in me.materials]
    bm = bmesh.new()
    bm.from_mesh(me)
    for e in bm.edges:
        if len(e.link_faces) != 2:
            e.smooth = True
            continue
        seuil = min(ANGLE_VIF.get(mats[f.material_index], ANGLE_VIF_DEFAUT) for f in e.link_faces)
        e.smooth = e.calc_face_angle(0.0) <= seuil
    bm.to_mesh(me)
    bm.free()


def uv_auto(ob):
    """Smart UV Project, puis mise à l'échelle 1 unité UV = 1 m (densité uniforme, îlots disjoints)."""
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='UVMap')
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    ob.select_set(True)
    vl.objects.active = ob
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob],
                                   selected_editable_objects=[ob]):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    uv = me.uv_layers.active.data
    aire_3d = sum(p.area for p in me.polygons)
    aire_uv = 0.0
    for p in me.polygons:
        pts = [uv[i].uv for i in p.loop_indices]
        aire_uv += abs(sum(pts[i].x * pts[i - 1].y - pts[i - 1].x * pts[i].y for i in range(len(pts)))) / 2
    k = math.sqrt(aire_3d / aire_uv) if aire_uv > 0 else 1.0
    for d in uv:
        d.uv = d.uv * k
    return k


def couleurs_sommets(maillages):
    """COLOR_0 = occlusion ambiante (rayons sur tout le personnage au repos) × bruit léger."""
    sommets, polys, decal = [], [], 0
    for ob in maillages:
        me = ob.data
        sommets += [ob.matrix_world @ v.co for v in me.vertices]
        polys += [[decal + i for i in p.vertices] for p in me.polygons]
        decal += len(me.vertices)
    arbre = BVHTree.FromPolygons(sommets, polys, all_triangles=False)
    # Directions en cosinus sur l'hémisphère (spirale de Fibonacci), tournées aléatoirement par sommet.
    dirs = []
    for i in range(AO_RAYONS):
        u = (i + 0.5) / AO_RAYONS
        r, phi = math.sqrt(u), i * math.pi * (3 - math.sqrt(5))
        dirs.append((r * math.cos(phi), r * math.sin(phi), math.sqrt(max(0.0, 1 - u))))
    alea = random.Random(1789)
    stats = []
    for ob in maillages:
        me = ob.data
        for nom in [a.name for a in me.color_attributes]:
            me.color_attributes.remove(me.color_attributes[nom])
        attr = me.color_attributes.new(name='Couleur', type='FLOAT_COLOR', domain='POINT')
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        normales = me.vertex_normals
        for i, v in enumerate(me.vertices):
            p = ob.matrix_world @ v.co
            n = (ob.matrix_world.to_3x3() @ normales[i].vector).normalized()
            t = n.orthogonal().normalized()
            b = n.cross(t)
            a = alea.random() * 2 * math.pi
            ca, sa = math.cos(a), math.sin(a)
            t, b = t * ca + b * sa, b * ca - t * sa
            occ = 0.0
            depart = p + n * 0.0005
            for dx, dy, dz in dirs:
                d = t * dx + b * dy + n * dz
                hit, _, _, dist = arbre.ray_cast(depart, d, AO_DISTANCE)
                if hit is not None:
                    occ += 1.0 - dist / AO_DISTANCE
            occ /= AO_RAYONS
            f = 1.0 - AO_FORCE * occ
            f *= 1.0 + BRUIT_AMPLITUDE * noise.noise(p * BRUIT_FREQUENCE)
            f = max(0.0, min(1.0, f))
            attr.data[i].color = (f, f, f, 1.0)
            stats.append(f)
    stats.sort()
    return {'min': round(stats[0], 3), 'mediane': round(stats[len(stats) // 2], 3), 'max': round(stats[-1], 3)}


def triangles(maillages):
    total = 0
    for ob in maillages:
        ob.data.calc_loop_triangles()
        total += len(ob.data.loop_triangles)
    return total


# ---------------------------------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------------------------------

def exporter(arm, maillages, chemin):
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    for o in [arm, *maillages]:
        o.select_set(True)
    vl.objects.active = arm
    arm.animation_data.action = None
    arm.data.pose_position = 'POSE'
    bpy.ops.export_scene.gltf(
        filepath=chemin, export_format='GLB', use_selection=True,
        export_cameras=False, export_lights=False, export_extras=False, export_yup=True,
        export_apply=False, export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials='EXPORT', export_image_format='NONE',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_skins=True, export_influence_nb=4, export_all_influences=False, export_def_bones=False,
        export_rest_position_armature=True, export_morph=False,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_frame_step=1, export_anim_slide_to_zero=True, export_optimize_animation_size=True,
    )


def traiter(cfg):
    nom = cfg['nom']
    journal(f'=== {nom} ({cfg["source"]})')
    arm, maillages = importer(cfg)
    plages = filtrer_animations(arm, nom)
    journal('animations', {a: (p[1] - p[0]) / IPS for a, p in plages.items()})
    tri_source = triangles(maillages)
    for ob in maillages:
        n0, n1 = preparer(ob)
        journal(f'{ob.name} : sommets {n0} -> {n1} après soudure')

    # Budget : on ajoute les catégories par priorité tant que le total reste ≤ BUDGET_TRIANGLES.
    inclus = set()
    for c in PRIORITES:
        essai = estimer_triangles(maillages, inclus | {c})
        if essai <= BUDGET_TRIANGLES:
            inclus.add(c)
        journal(f'budget : + {c} → {essai} triangles', 'gardé' if c in inclus else 'refusé')
    for ob in maillages:
        info = subdiviser(ob, inclus)
        nmax = nettoyer_poids(ob)
        ombrer(ob)
        k = uv_auto(ob)
        journal(f'{ob.name} : {info}, influences max avant limite {nmax}, échelle UV {k:.2f}')
    journal('couleurs de sommets', couleurs_sommets(maillages))
    tri = triangles(maillages)
    journal(f'triangles : {tri_source} -> {tri} (subdivisé : {sorted(inclus)})')
    if tri > BUDGET_TRIANGLES:
        raise RuntimeError(f'Budget dépassé : {tri} triangles')

    chemin = os.path.join(MODELES, cfg['sortie'])
    # Le nœud racine s'appelle CharacterArmature dans chaque GLB (Blender suffixe le second en .001).
    autres = [o for o in bpy.data.objects if o.name == 'CharacterArmature' and o is not arm]
    for o in autres:
        o.name = 'CharacterArmature.autre'
    ancien = arm.name
    arm.name = 'CharacterArmature'
    exporter(arm, maillages, chemin)
    journal(f'export : {chemin} ({os.path.getsize(chemin) / 1024:.0f} Kio)')
    return arm, maillages, ancien, autres


def main():
    reinitialiser()
    resultats = []
    for cfg in PERSONNAGES:
        arm, maillages, ancien, autres = traiter(cfg)
        resultats.append((cfg, arm, maillages))
        arm.name = ancien  # libère le nom avant de le rendre au personnage précédent
        for o in autres:
            o.name = 'CharacterArmature'
    # Fichier source : une scène par personnage (les deux sont à l'origine).
    principale = bpy.context.scene
    for cfg, arm, maillages in resultats[1:]:
        sc = bpy.data.scenes.new(cfg['nom'])
        sc.render.fps = IPS
        col = bpy.data.collections[cfg['nom']]
        sc.collection.children.link(col)
        principale.collection.children.unlink(col)
    for cfg, arm, _ in resultats:
        arm.data.pose_position = 'POSE'
    os.makedirs(os.path.dirname(BLEND), exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0  # pas de copie personnages.blend1
    bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
    journal(f'enregistré : {BLEND}')


if __name__ == '__main__':
    main()
