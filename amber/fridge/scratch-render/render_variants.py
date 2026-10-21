import bpy, math, sys
from mathutils import Vector
O=bpy.data.objects; sc=bpy.context.scene
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='METAL'; prefs.get_devices()
for d in prefs.devices: d.use=True
sc.cycles.device='GPU'
sc.render.resolution_x=3840; sc.render.resolution_y=2160; sc.render.resolution_percentage=100
sc.cycles.samples=160; sc.cycles.use_denoising=True
sc.render.image_settings.file_format='PNG'
sky=bpy.data.materials["SkyMat"].node_tree
ramp=sky.nodes["SkyRamp"].color_ramp; emit=sky.nodes["SkyEmit"]
bg=next(n for n in sc.world.node_tree.nodes if n.type=="BACKGROUND")
sun=O["Sun"]; fill=O["Fill"]; bulb=O["PendantBulb"]
out="/Users/joelnewton/code/amber/amber-website/scratch-render/"
which=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else ["golden","morning","night"]
def go(name):
    sc.render.filepath=out+f"kitchen-{name}.png"; bpy.ops.render.render(write_still=True); print("DONE",name,flush=True)
for v in which:
    if v=="golden":
        go("golden")
    elif v=="morning":
        d=Vector((1.0,0.75,-0.75)).normalized(); sun.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
        sun.data.energy=7.5; sun.data.color=(1.0,0.9,0.76)
        fill.data.energy=28; fill.data.color=(0.92,0.95,1.0)
        ramp.elements[0].color=(0.95,0.88,0.75,1); ramp.elements[1].color=(0.65,0.8,0.95,1); emit.inputs[1].default_value=1.0
        bg.inputs[1].default_value=0.35
        go("morning")
    elif v=="night":
        sun.data.energy=0.0
        fill.data.energy=2.5; fill.data.color=(0.55,0.62,1.0)
        ramp.elements[0].color=(0.06,0.08,0.18,1); ramp.elements[1].color=(0.02,0.03,0.09,1); emit.inputs[1].default_value=0.6
        bg.inputs[1].default_value=0.05
        bulb.data.energy=55
        go("night")
