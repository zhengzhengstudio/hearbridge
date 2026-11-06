import math
import sys

import bpy
from mathutils import Vector


def look_at(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat('-Z', 'Y').to_euler()


arguments = sys.argv[sys.argv.index('--') + 1:]
source, output = arguments[0], arguments[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source, import_pack_images=True)

mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
world_corners = [obj.matrix_world @ Vector(corner) for obj in mesh_objects for corner in obj.bound_box]
minimum = Vector((min(point.x for point in world_corners), min(point.y for point in world_corners), min(point.z for point in world_corners)))
maximum = Vector((max(point.x for point in world_corners), max(point.y for point in world_corners), max(point.z for point in world_corners)))
focus = (minimum + maximum) * 0.5
radius = max((maximum - minimum).length * 0.5, 1.0)

world = bpy.context.scene.world or bpy.data.worlds.new('SpaceFight Preview World')
bpy.context.scene.world = world
world.color = (0.004, 0.008, 0.012)
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.003, 0.008, 0.012, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.14

bpy.ops.object.light_add(type='AREA', location=(5, 8, 8))
key = bpy.context.object
key.data.energy = 1150
key.data.shape = 'DISK'
key.data.size = 7
key.data.color = (0.55, 0.82, 1.0)
look_at(key, (0, 0, 0.7))

bpy.ops.object.light_add(type='AREA', location=(-6, 2, -4))
rim = bpy.context.object
rim.data.energy = 900
rim.data.size = 5
rim.data.color = (1.0, 0.34, 0.12)
look_at(rim, (0, 0, 0))

camera_direction = Vector((1.35, -1.55, 1.05)).normalized()
bpy.ops.object.camera_add(location=focus + camera_direction * radius * 2.25)
camera = bpy.context.object
camera.data.lens = 52
look_at(camera, focus)
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.studio_light = 'rim.sl'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = output
scene.render.film_transparent = False
scene.view_settings.look = 'AgX - Medium High Contrast'
bpy.ops.render.render(write_still=True)
