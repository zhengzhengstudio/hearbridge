import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


DETAIL_MARKER = "SF_GeometryV2"


SHIP_PROFILES = {
    "interceptor": {"wing": 0.88, "mass": 0.72, "canopy": 1.0},
    "scout": {"wing": 1.04, "mass": 0.58, "canopy": 0.82},
    "fighter": {"wing": 0.96, "mass": 0.76, "canopy": 0.9},
    "bomber": {"wing": 0.82, "mass": 1.12, "canopy": 0.72},
    "gunship": {"wing": 0.74, "mass": 1.28, "canopy": 0.68},
    "boss": {"wing": 1.08, "mass": 1.42, "canopy": 0.62},
}


def material(name, base, metallic, roughness, emission=None):
    value = bpy.data.materials.new(name)
    value.use_nodes = True
    node = value.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = (*base, 1.0)
    node.inputs["Metallic"].default_value = metallic
    node.inputs["Roughness"].default_value = roughness
    if emission is not None:
        node.inputs["Emission Color"].default_value = (*emission, 1.0)
        node.inputs["Emission Strength"].default_value = 3.2
    return value


def mesh_bounds():
    points = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith("SF_"):
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        raise RuntimeError("Imported GLB does not contain a mesh")
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return minimum, maximum


def finish_object(obj, name, parent, mat, bevel=0.04):
    obj.name = name
    obj.parent = parent
    obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("Edge chamfer", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def box(name, parent, location, dimensions, mat, rotation=(0, 0, 0), bevel=0.04):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.dimensions = dimensions
    return finish_object(obj, name, parent, mat, bevel)


def cylinder(name, parent, location, radius, depth, mat, vertices=16, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    return finish_object(bpy.context.object, name, parent, mat, radius * 0.08)


def wedge(name, parent, location, dimensions, mat, mirror=False):
    width, height, length = dimensions
    sign = -1 if mirror else 1
    vertices = [
        (-width / 2, -height / 2, -length / 2),
        (width / 2, -height / 2, -length / 2),
        (-width * 0.22, -height / 2, length / 2),
        (width * 0.22, -height / 2, length / 2),
        (-width / 2, height / 2, -length / 2),
        (width / 2, height / 2, -length / 2),
        (-width * 0.22, height / 2, length / 2),
        (width * 0.22, height / 2, length / 2),
    ]
    if mirror:
        vertices = [(-x, y, z) for x, y, z in vertices]
    faces = [
        (0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
        (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3),
    ]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.scale.x = sign
    return finish_object(obj, name, parent, mat, min(dimensions) * 0.08)


def add_geometry(ship_name, quality):
    if any(obj.name == DETAIL_MARKER for obj in bpy.context.scene.objects):
        raise RuntimeError("GLB already contains SpaceFight geometry v2")
    profile = SHIP_PROFILES[ship_name]
    minimum, maximum = mesh_bounds()
    size = maximum - minimum
    center = (minimum + maximum) * 0.5
    width = size.x
    height = size.y
    length = size.z
    nose = maximum.z
    rear = minimum.z

    root = bpy.data.objects.new(DETAIL_MARKER, None)
    bpy.context.collection.objects.link(root)
    root["spacefight_geometry_version"] = 2
    root["spacefight_ship_kind"] = ship_name
    root["spacefight_quality"] = quality

    hull = material("SF_Hull", (0.055, 0.075, 0.09), 0.82, 0.3)
    armor = material("SF_Armor", (0.19, 0.24, 0.27), 0.76, 0.26)
    accent = material("SF_Accent", (0.025, 0.48, 0.68), 0.56, 0.22)
    canopy = material("SF_Canopy", (0.018, 0.095, 0.13), 0.3, 0.08)
    engine = material("SF_Engine", (0.02, 0.16, 0.2), 0.24, 0.2, (0.02, 0.7, 1.0))
    warning = material("SF_Warning", (0.76, 0.22, 0.04), 0.42, 0.3)

    mass = profile["mass"]
    wing = profile["wing"]
    canopy_scale = profile["canopy"]
    plate_y = maximum.y - height * 0.12
    rail_z = center.z + length * 0.02
    rail_length = length * (0.48 if ship_name in ("gunship", "boss") else 0.56)
    rail_offset = width * (0.2 if mass > 1 else 0.28)
    for side in (-1, 1):
        box(
            f"SF_ArmorRail_{'L' if side < 0 else 'R'}",
            root,
            (center.x + side * rail_offset, plate_y, rail_z),
            (width * 0.055 * mass, max(height * 0.055, 0.055), rail_length),
            armor,
            rotation=(0, side * math.radians(2.5), 0),
            bevel=max(width * 0.006, 0.025),
        )
        box(
            f"SF_AccentRail_{'L' if side < 0 else 'R'}",
            root,
            (center.x + side * rail_offset, plate_y + height * 0.045, rail_z + length * 0.04),
            (width * 0.022, max(height * 0.018, 0.025), rail_length * 0.72),
            accent,
            bevel=max(width * 0.003, 0.012),
        )
        pod_x = center.x + side * width * (0.37 if mass < 1 else 0.31)
        pod_z = center.z - length * (0.02 if ship_name == "scout" else 0.12)
        box(
            f"SF_WeaponPod_{'L' if side < 0 else 'R'}",
            root,
            (pod_x, center.y - height * 0.1, pod_z),
            (width * 0.11 * mass, height * 0.18, length * 0.24),
            hull,
            rotation=(0, side * math.radians(4), 0),
            bevel=max(width * 0.012, 0.035),
        )
        cylinder(
            f"SF_EngineNozzle_{'L' if side < 0 else 'R'}",
            root,
            (center.x + side * width * 0.19, center.y - height * 0.04, rear + length * 0.045),
            max(width * 0.055 * mass, 0.12),
            max(length * 0.065, 0.18),
            engine,
            vertices=20 if quality == "high" else 12,
        )

    canopy_center = (center.x, maximum.y - height * 0.04, center.z + length * 0.18)
    wedge(
        "SF_CockpitCanopy",
        root,
        canopy_center,
        (width * 0.24 * canopy_scale, height * 0.3, length * 0.19),
        canopy,
    )
    box(
        "SF_CockpitDashboard",
        root,
        (center.x, canopy_center[1] - height * 0.18, canopy_center[2] + length * 0.12),
        (width * 0.3, height * 0.12, length * 0.055),
        hull,
        rotation=(math.radians(-8), 0, 0),
        bevel=max(width * 0.012, 0.03),
    )
    box(
        "SF_DorsalSpine",
        root,
        (center.x, plate_y + height * 0.03, center.z - length * 0.12),
        (width * 0.07 * mass, height * 0.1, length * 0.42),
        armor,
        bevel=max(width * 0.008, 0.025),
    )

    fin_width = width * 0.2 * wing
    for side in (-1, 1):
        fin_x = center.x + side * width * 0.44
        wedge(
            f"SF_WingFence_{'L' if side < 0 else 'R'}",
            root,
            (fin_x, center.y + height * 0.02, center.z - length * 0.1),
            (fin_width, max(height * 0.08, 0.06), length * 0.3),
            armor,
            mirror=side < 0,
        )

    if ship_name in ("bomber", "gunship", "boss"):
        box(
            "SF_DorsalTurretBase",
            root,
            (center.x, maximum.y + height * 0.06, center.z - length * 0.08),
            (width * 0.2, height * 0.15, length * 0.16),
            hull,
            bevel=max(width * 0.012, 0.04),
        )
        for side in (-1, 1):
            cylinder(
                f"SF_DorsalBarrel_{'L' if side < 0 else 'R'}",
                root,
                (center.x + side * width * 0.045, maximum.y + height * 0.13, center.z + length * 0.04),
                max(width * 0.012, 0.035),
                length * 0.25,
                warning,
                vertices=12,
                rotation=(math.radians(90), 0, 0),
            )

    if quality == "high":
        for index, fraction in enumerate((-0.28, -0.08, 0.12, 0.32)):
            box(
                f"SF_HullPlate_{index + 1}",
                root,
                (center.x, plate_y + height * 0.018, center.z + length * fraction),
                (width * (0.34 - abs(fraction) * 0.22), max(height * 0.024, 0.025), length * 0.12),
                armor if index % 2 == 0 else hull,
                bevel=max(width * 0.005, 0.018),
            )
        for side in (-1, 1):
            for index in range(3):
                box(
                    f"SF_ServicePanel_{'L' if side < 0 else 'R'}_{index + 1}",
                    root,
                    (
                        center.x + side * width * (0.18 + index * 0.055),
                        plate_y + height * 0.026,
                        center.z - length * (0.05 + index * 0.13),
                    ),
                    (width * 0.035, max(height * 0.018, 0.018), length * 0.075),
                    accent if index == 1 else armor,
                    bevel=max(width * 0.003, 0.01),
                )

    return root


def refine(input_file, output_file, ship_name, quality):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(input_file), import_pack_images=True)
    add_geometry(ship_name, quality)
    bpy.ops.export_scene.gltf(
        filepath=str(output_file),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--ship", choices=SHIP_PROFILES, required=True)
    parser.add_argument("--quality", choices=("low", "high"), required=True)
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(arguments)
    refine(Path(args.input), Path(args.output), args.ship, args.quality)


if __name__ == "__main__":
    main()
