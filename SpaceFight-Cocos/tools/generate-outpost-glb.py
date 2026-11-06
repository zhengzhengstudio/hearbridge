import argparse
import math
import sys
from pathlib import Path

import bpy


def material(name, base, metallic, roughness, emission=None):
    value = bpy.data.materials.new(name)
    value.use_nodes = True
    node = value.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = (*base, 1.0)
    node.inputs["Metallic"].default_value = metallic
    node.inputs["Roughness"].default_value = roughness
    if emission is not None:
        node.inputs["Emission Color"].default_value = (*emission, 1.0)
        # Strength 1 stays inside core glTF emissiveFactor and avoids an extension
        # unsupported by the Cocos 3.8 importer.
        node.inputs["Emission Strength"].default_value = 1.0
    return value


def finish(obj, name, mat, bevel=0.08):
    obj.name = name
    obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Functional edge chamfer", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def box(name, location, dimensions, mat, rotation=(0, 0, 0), bevel=0.08):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.dimensions = dimensions
    return finish(obj, name, mat, bevel)


def cylinder(name, location, radius, depth, mat, vertices=20, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    return finish(bpy.context.object, name, mat, min(radius * 0.08, 0.12))


def torus(name, location, major, minor, mat, rotation=(0, 0, 0), segments=32):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=segments,
        minor_segments=10,
        location=location,
        rotation=rotation,
    )
    return finish(bpy.context.object, name, mat, 0.03)


def consolidate_by_material():
    groups = {}
    for obj in [candidate for candidate in bpy.context.scene.objects if candidate.type == "MESH"]:
        material_name = obj.data.materials[0].name if obj.data.materials else "Unassigned"
        groups.setdefault(material_name, []).append(obj)
    for material_name, objects in groups.items():
        for obj in objects:
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            for modifier in list(obj.modifiers):
                bpy.ops.object.modifier_apply(modifier=modifier.name)
            obj.select_set(False)
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        objects[0].name = f"Outpost_{material_name.replace('Outpost_', '')}Geometry"
        objects[0].select_set(False)


def build_outpost(output_file, detail):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    hull = material("Outpost_Hull", (0.09, 0.12, 0.14), 0.82, 0.32)
    armor = material("Outpost_Armor", (0.31, 0.37, 0.39), 0.7, 0.28)
    interior = material("Outpost_Interior", (0.46, 0.5, 0.5), 0.55, 0.5)
    dark = material("Outpost_Dark", (0.025, 0.038, 0.045), 0.88, 0.35)
    glass = material("Outpost_Glass", (0.02, 0.18, 0.23), 0.34, 0.12, (0.01, 0.15, 0.22))
    cyan = material("Outpost_Guidance", (0.015, 0.45, 0.62), 0.3, 0.22, (0.02, 0.72, 1.0))
    amber = material("Outpost_Warning", (0.72, 0.24, 0.025), 0.32, 0.3, (1.0, 0.22, 0.01))

    cylinder("StationCore", (0, 0, 0), 3.2, 8.4, hull, 28)
    torus("HabitatRing", (0, 0, 0.8), 8.1, 0.7, armor, segments=40)
    torus("ServiceRing", (0, 0, -2.5), 5.8, 0.42, cyan, rotation=(math.radians(16), 0, 0), segments=32)

    for side in (-1, 1):
        box(f"StationArmorShell_{side}", (side * 4.5, 0.3, 0), (5.4, 5.8, 4.2), armor,
            rotation=(0, 0, side * math.radians(5)), bevel=0.18)
        box(f"ArmorRail_{side}", (side * 6.1, 0.4, 1.8), (0.45, 7.0, 0.5), dark, bevel=0.06)

    for index in range(4):
        angle = index * math.pi / 2
        x = math.cos(angle) * 7.4
        y = math.sin(angle) * 7.4
        box(f"ConnectedTruss_{index}", (x * 0.62, y * 0.62, 0), (6.5, 0.55, 0.55), dark,
            rotation=(0, 0, angle), bevel=0.05)
        box(f"DockModule_{index}", (x, y, 0), (3.2, 3.8, 2.7), armor,
            rotation=(0, 0, angle), bevel=0.16)
        box(f"Radiator_{index}", (x, y, 2.3), (4.8, 0.16, 2.0), dark,
            rotation=(0, 0, angle), bevel=0.03)
        for light_index in (-1, 1):
            cylinder(f"DockBeacon_{index}_{light_index}",
                     (x + math.cos(angle + math.pi / 2) * 1.2 * light_index,
                      y + math.sin(angle + math.pi / 2) * 1.2 * light_index, -1.25),
                     0.12, 0.24, amber, 10)

    box("CommandDeck", (0, 1.2, 4.7), (5.2, 3.2, 1.35), glass, bevel=0.22)
    box("CommandDeckBrow", (0, -0.1, 5.35), (6.3, 0.55, 0.42), armor, bevel=0.07)
    cylinder("AntennaMast", (0, 0, 7.4), 0.18, 5.0, dark, 12)
    for height, radius in ((8.1, 1.7), (9.0, 1.15)):
        torus(f"AntennaArray_{height}", (0, 0, height), radius, 0.09, cyan,
              rotation=(math.radians(90), 0, 0), segments=24)

    # Traversable-looking hangar and cutaway interior, open toward negative Y.
    box("InteriorDeck", (0, -5.2, -2.35), (8.4, 13.5, 0.42), interior, bevel=0.05)
    box("InteriorCeiling", (0, -3.6, 2.35), (8.4, 10.2, 0.34), dark, bevel=0.04)
    for side in (-1, 1):
        box(f"HangarMouthFrame_{side}", (side * 4.05, -11.7, 0), (0.58, 0.75, 5.2), armor, bevel=0.08)
        box(f"InteriorCorridorWall_{side}", (side * 4.05, -5.8, 0), (0.42, 11.6, 4.7), hull, bevel=0.08)
        box(f"HangarGuidance_{side}", (side * 3.35, -11.8, -2.05), (0.18, 0.7, 0.12), cyan, bevel=0.02)
    box("HangarMouthHeader", (0, -11.7, 2.35), (8.6, 0.72, 0.55), armor, bevel=0.08)
    box("HangarThreshold", (0, -11.7, -2.22), (8.6, 0.85, 0.32), dark, bevel=0.04)

    for rib_index, y in enumerate((-10.0, -7.6, -5.2, -2.8)):
        box(f"InteriorRibTop_{rib_index}", (0, y, 2.0), (8.0, 0.24, 0.32), armor, bevel=0.03)
        for side in (-1, 1):
            box(f"InteriorRib_{rib_index}_{side}", (side * 3.75, y, 0), (0.28, 0.25, 4.1), armor, bevel=0.03)
            box(f"InteriorGuidance_{rib_index}_{side}", (side * 3.0, y, -2.08), (0.65, 0.12, 0.08), cyan, bevel=0.015)

    for side in (-1, 1):
        box(f"InteriorBulkheadDoor_{side}", (side * 1.45, 0.1, -0.25), (2.7, 0.38, 4.1), dark, bevel=0.08)
        box(f"DoorWarning_{side}", (side * 2.72, -0.13, -0.25), (0.12, 0.12, 3.5), amber, bevel=0.01)

    cargo_positions = [(-2.5, -8.5), (2.35, -6.7), (-2.25, -4.5), (2.45, -2.4)]
    for index, (x, y) in enumerate(cargo_positions):
        box(f"InteriorCover_{index}", (x, y, -1.55), (1.7, 1.55, 1.35),
            armor if index % 2 else dark, rotation=(0, 0, math.radians(index * 9)), bevel=0.1)
        box(f"CargoLatch_{index}", (x, y - 0.7, -1.55), (0.7, 0.12, 0.18), amber, bevel=0.02)

    # Break large surfaces into readable functional panels.
    for index in range(6):
        x = -3.2 + index * 1.28
        box(f"DeckPanel_{index}", (x, -5.4, -2.1), (0.92, 7.8, 0.08),
            dark if index % 2 else interior, bevel=0.015)

    if detail == "high":
        # High-tier silhouette detail: these are structural modules rather than
        # surface noise, so the station remains readable at combat distance.
        for index in range(8):
            angle = index * math.tau / 8
            x = math.cos(angle) * 8.15
            y = math.sin(angle) * 8.15
            box(f"HabitatModule_{index}", (x, y, 0.85), (2.7, 1.45, 1.65),
                armor if index % 2 else hull,
                rotation=(0, 0, angle), bevel=0.14)
            box(f"HabitatWindow_{index}", (x * 1.02, y * 1.02, 1.2), (1.25, 0.18, 0.42),
                glass, rotation=(0, 0, angle), bevel=0.03)

        for side in (-1, 1):
            for index in range(3):
                box(f"PowerSpine_{side}_{index}",
                    (side * (5.4 + index * 1.35), 1.2, -3.7),
                    (0.95, 4.8, 0.72), dark, bevel=0.07)
                box(f"RadiatorFin_{side}_{index}",
                    (side * (5.4 + index * 1.35), 1.2, -4.35),
                    (0.72, 4.2, 0.12), cyan, bevel=0.02)

        for index, angle in enumerate((0, math.pi / 2, math.pi, math.pi * 1.5)):
            x = math.cos(angle) * 10.2
            y = math.sin(angle) * 10.2
            cylinder(f"DefenseMount_{index}", (x, y, 1.6), 0.72, 1.1,
                     armor, 16, rotation=(math.radians(90), 0, angle))
            cylinder(f"DefenseBarrel_{index}",
                     (x + math.cos(angle) * 0.85, y + math.sin(angle) * 0.85, 1.6),
                     0.13, 2.2, dark, 10,
                     rotation=(0, math.radians(90), angle))

        for side in (-1, 1):
            cylinder(f"ServiceTank_{side}", (side * 3.8, 2.4, -4.3), 1.05, 3.4,
                     interior, 20, rotation=(math.radians(90), 0, 0))
            for index in range(3):
                box(f"TankBrace_{side}_{index}",
                    (side * 3.8, 1.25 + index * 1.1, -4.3),
                    (2.5, 0.12, 0.16), amber if index == 1 else dark, bevel=0.02)

        # The runtime keeps its functional hangar and interior modules when this
        # detailed exterior is installed. Remove their baked visual duplicates to
        # prevent z-fighting and keep the approach opening readable.
        interior_prefixes = (
            "Interior", "Hangar", "DoorWarning", "CargoLatch", "DeckPanel"
        )
        for obj in list(bpy.context.scene.objects):
            if obj.type == "MESH" and obj.name.startswith(interior_prefixes):
                bpy.data.objects.remove(obj, do_unlink=True)

    consolidate_by_material()
    root = bpy.data.objects.new(
        "SF_Outpost_HighV2" if detail == "high" else "SF_Outpost_LowV2", None)
    bpy.context.collection.objects.link(root)
    root["spacefight_environment_version"] = 2
    root["spacefight_detail_tier"] = detail
    root["supports_visible_interior"] = True
    root["exterior_shell_only"] = detail == "high"
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH":
            obj.parent = root

    output_file.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output_file),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--detail", choices=("low", "high"), default="low")
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(arguments)
    build_outpost(Path(args.output), args.detail)


if __name__ == "__main__":
    main()
