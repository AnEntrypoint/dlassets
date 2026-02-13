import bpy, sys, os, glob

script_dir = os.path.dirname(os.path.abspath(__file__))
downloads_dir = os.path.join(script_dir, "downloads")
output_dir = os.path.join(script_dir, "output")
os.makedirs(output_dir, exist_ok=True)

usdz_files = glob.glob(os.path.join(downloads_dir, "*.usdz"))
if not usdz_files:
    print("No .usdz files found in downloads/")
    sys.exit(1)

for usdz_path in usdz_files:
    name = os.path.splitext(os.path.basename(usdz_path))[0]
    glb_path = os.path.join(output_dir, name + ".glb")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.usd_import(filepath=usdz_path)

    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format='GLB',
        export_image_format='WEBP',
        export_image_add_webp=False,
        export_image_quality=15,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    print(f"DONE: {glb_path}")
