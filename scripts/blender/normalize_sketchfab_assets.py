import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSETS = {
    "isometric_rooms": 13.0,
    "kitchen_furniture": 4.8,
    "patterned_rugs": 3.0,
    "toilet": 1.55,
    "old_fridge": 2.05,
    "electric_fan": 1.45,
    "cartoon_hammer": 1.45,
    "jump_pad": 1.25,
    "beach_ball": 1.55,
    "duck_soap_dish": 0.62,
    "standing_fan": 1.45,
    "refrigerator": 2.05,
}


def source_for(sources, name):
    packed = sources / f"{name}.glb"
    if packed.exists():
        return packed
    downloaded = sources / f"{name}_download" / "scene.gltf"
    if downloaded.exists():
        return downloaded
    raise FileNotFoundError(packed)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.images):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def bounds(objects):
    corners = []
    for obj in objects:
        if obj.type == "MESH":
            corners.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not corners:
        raise RuntimeError("Imported asset contains no mesh geometry")
    minimum = Vector((min(p.x for p in corners), min(p.y for p in corners), min(p.z for p in corners)))
    maximum = Vector((max(p.x for p in corners), max(p.y for p in corners), max(p.z for p in corners)))
    return minimum, maximum


def normalize(source, target, target_size):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(source))
    scene_objects = list(bpy.context.scene.objects)
    for obj in list(scene_objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    scene_objects = list(bpy.context.scene.objects)
    minimum, maximum = bounds(scene_objects)
    extent = maximum - minimum
    scale = target_size / max(extent.x, extent.y, extent.z)
    root = bpy.data.objects.new("ASSET_ROOT", None)
    bpy.context.scene.collection.objects.link(root)
    for obj in scene_objects:
        if obj.parent is None:
            matrix = obj.matrix_world.copy()
            obj.parent = root
            obj.matrix_world = matrix
    root.scale = (scale, scale, scale)
    root.location = (
        -((minimum.x + maximum.x) * 0.5) * scale,
        -((minimum.y + maximum.y) * 0.5) * scale,
        -minimum.z * scale,
    )
    # Browser delivery is the target. Cap source textures before packing the GLB;
    # several free downloads ship with 4K maps that add tens of megabytes without
    # visible benefit at obstacle-game camera distance.
    for image in bpy.data.images:
        width, height = image.size
        largest = max(width, height)
        if largest > 1024:
            ratio = 1024 / largest
            image.scale(max(1, round(width * ratio)), max(1, round(height * ratio)))
    for obj in scene_objects:
        if obj.type == "MESH":
            obj.select_set(True)
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(target),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_animations=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
    )


def render_preview(model, output):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(model))
    objects = list(bpy.context.scene.objects)
    minimum, maximum = bounds(objects)
    center = (minimum + maximum) * 0.5
    extent = maximum - minimum
    camera = bpy.data.cameras.new("ReviewCamera")
    camera.type = "ORTHO"
    camera.ortho_scale = max(extent.x, extent.y, extent.z) * 1.55
    camera_object = bpy.data.objects.new("ReviewCamera", camera)
    bpy.context.scene.collection.objects.link(camera_object)
    camera_object.location = center + Vector((3.8, -5.8, 3.1)) * max(extent.length, 1.0)
    camera_object.rotation_euler = ((center - camera_object.location).to_track_quat("-Z", "Y")).to_euler()
    bpy.context.scene.camera = camera_object
    world = bpy.context.scene.world or bpy.data.worlds.new("ReviewWorld")
    bpy.context.scene.world = world
    world.color = (0.055, 0.065, 0.11)
    key_data = bpy.data.lights.new("Key", "AREA")
    key_data.energy = 900
    key_data.shape = "DISK"
    key_data.size = 5
    key = bpy.data.objects.new("Key", key_data)
    key.location = center + Vector((-3, -4, 6))
    bpy.context.scene.collection.objects.link(key)
    fill_data = bpy.data.lights.new("Fill", "AREA")
    fill_data.energy = 500
    fill_data.size = 4
    fill = bpy.data.objects.new("Fill", fill_data)
    fill.location = center + Vector((4, 1, 3))
    bpy.context.scene.collection.objects.link(fill)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(output)
    scene.view_settings.look = "AgX - Medium High Contrast"
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--names", nargs="*")
    script_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    args = parser.parse_args(script_args)
    root = Path(args.root)
    sources = root / "assets" / "source" / "sketchfab"
    outputs = root / "public" / "assets" / "models"
    previews = root / "artifacts" / "asset-review"
    selected = args.names or list(ASSETS)
    for name in selected:
        if name not in ASSETS:
            raise ValueError(f"Unknown asset: {name}")
        target_size = ASSETS[name]
        source = source_for(sources, name)
        target = outputs / f"{name}.glb"
        normalize(source, target, target_size)
        render_preview(target, previews / f"{name}.png")
        print(f"normalized {name}")


if __name__ == "__main__":
    main()
