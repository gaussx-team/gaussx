"""Run with Blender --background --disable-autoexec --python this_file -- --help.

Only the JSON config/audit may be written. The source .blend is never saved.
Distance anchors remain untouched; each preset receives its own surface pins.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def sha256(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def point(value):
    return [round(float(component), 7) for component in value]


def bounds(objects):
    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (Vector([min(v[i] for v in corners) for i in range(3)]),
            Vector([max(v[i] for v in corners) for i in range(3)]))


def first_target_hit(objects, origin, direction):
    hits = []
    for obj in objects:
        inverse = obj.matrix_world.inverted()
        local_direction = (inverse.to_3x3() @ direction).normalized()
        hit, location, normal, face = obj.ray_cast(inverse @ origin, local_direction)
        if hit:
            world = obj.matrix_world @ location
            hits.append({
                'object': obj.name, 'position': world,
                'normal': (inverse.transposed().to_3x3() @ normal).normalized(),
                'face': face, 'distance': (world - origin).length,
                'surfaceError': ((obj.matrix_world @ obj.closest_point_on_mesh(location)[1]) - world).length,
            })
    return min(hits, key=lambda hit: hit['distance']) if hits else None


def occluder(scene, depsgraph, origin, hit):
    direction = (hit['position'] - origin).normalized()
    start = origin.copy()
    # Hidden helper meshes do not count as visible obstructions.
    for _ in range(32):
        remaining = (hit['position'] - start).dot(direction)
        if remaining <= 0.002:
            return None
        found, position, _, _, obj, _ = scene.ray_cast(depsgraph, start, direction, distance=remaining + 0.002)
        if not found or (position - origin).length >= hit['distance'] - 0.002:
            return None
        if not obj.hide_render:
            return obj.name
        start = position + direction * 0.002
    raise ValueError('Too many hidden helper intersections')


def in_region(hit, target, minimum, maximum):
    for axis, (low, high) in enumerate(target.get('region', [[0, 1]] * 3)):
        span = maximum[axis] - minimum[axis]
        fraction = (hit['position'][axis] - minimum[axis]) / span if span else 0.5
        if not low - 0.001 <= fraction <= high + 0.001:
            return False
    return 'normal' not in target or hit['normal'].dot(Vector(target['normal'])) >= target.get('normalMinDot', 0.5)


def surface_pin(scene, depsgraph, origin, anchor, target, objects):
    minimum, maximum = bounds(objects)
    if 'anchorOffset' in target:
        aim = Vector(anchor['position']) + Vector(target['anchorOffset'])
    else:
        aim = Vector([minimum[i] + (maximum[i] - minimum[i]) * target['aimFraction'][i] for i in range(3)])
    attempts = []
    for offset in target.get('searchOffsets', [[0, 0, 0]]):
        candidate = aim + Vector(offset)
        direction = (candidate - origin).normalized()
        hit = first_target_hit(objects, origin, direction)
        if not hit or not in_region(hit, target, minimum, maximum):
            attempts.append({'aim': point(candidate), 'reason': 'no hit in requested equipment region'})
            continue
        blocker = occluder(scene, depsgraph, origin, hit)
        record = {**hit, 'position': point(hit['position']), 'normal': point(hit['normal']), 'aim': point(candidate)}
        if blocker:
            attempts.append({**record, 'reason': 'occluded', 'occluder': blocker})
            continue
        if hit['surfaceError'] > 0.0001:
            raise ValueError('Ray hit does not lie on the evaluated mesh surface')
        return record, attempts
    return None, attempts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--blend', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--targets', type=Path, default=Path(__file__).with_name('card-pin-targets.json'))
    parser.add_argument('--audit', type=Path, required=True)
    parser.add_argument('--write', action='store_true', help='Write preset pinPositions to the JSON config')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.blend = args.blend.resolve(strict=True)
    args.config = args.config.resolve(strict=True)
    args.audit = args.audit.resolve()
    if args.config.suffix != '.json' or args.audit.suffix != '.json' or args.config == args.audit:
        raise ValueError('Config and audit must be distinct JSON files')
    config = json.loads(args.config.read_text(encoding='utf-8-sig'))
    targets = json.loads(args.targets.read_text(encoding='utf-8-sig'))
    if targets['schema'] != 'blender-card-pin-targets-v1':
        raise ValueError('Unsupported pin target mapping schema')
    if config['coordinateSystem'] != targets['coordinateSystem'] or config['coordinateSystem'] != 'Blender Z-up meters':
        raise ValueError('Expected identical Blender Z-up meter coordinates')
    if config.get('metadata', {}).get('coordinateTransform') != 'identity':
        raise ValueError('Non-identity model transforms need an explicit coordinate conversion first')
    before = sha256(args.blend)
    anchors_before = json.dumps(config['anchors'], sort_keys=True)
    bpy.ops.wm.open_mainfile(filepath=str(args.blend), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    if scene.unit_settings.system != 'METRIC' or abs(scene.unit_settings.scale_length - 1.0) > 1e-8:
        raise ValueError('Source Blender scene must use metric units at scale 1')
    depsgraph = bpy.context.evaluated_depsgraph_get()
    prepared = {}
    coordinate_errors = {}
    for equipment, target in targets['equipment'].items():
        anchor = next(item for item in config['anchors'] if item['id'] == equipment)
        reference = scene.objects.get(target['referenceObject'])
        if reference is None:
            raise ValueError(f'Missing coordinate reference: {target["referenceObject"]}')
        error = math.dist(reference.matrix_world.translation, anchor['position'])
        if error > 0.0001:
            raise ValueError(f'Blender/config coordinates differ for {equipment}: {error}m')
        coordinate_errors[equipment] = error
        objects = []
        for name in target['objects']:
            obj = scene.objects.get(name)
            if obj is None or obj.type != 'MESH' or obj.hide_render:
                raise ValueError(f'Missing visible target mesh: {name}')
            objects.append(obj.evaluated_get(depsgraph))
        prepared[equipment] = (anchor, target, objects)
    records = {}
    for preset, camera in config['presets'].items():
        matrix = camera['matrix']
        if len(matrix) != 4 or any(len(row) != 4 or not all(math.isfinite(x) for x in row) for row in matrix):
            raise ValueError(f'Invalid camera-to-world matrix: {preset}')
        origin = Vector([matrix[i][3] for i in range(3)])
        pins = {}
        records[preset] = {}
        for equipment, (anchor, target, objects) in prepared.items():
            hit, attempts = surface_pin(scene, depsgraph, origin, anchor, target, objects)
            pins[equipment] = hit['position'] if hit else None
            records[preset][equipment] = {'hit': hit, 'attempts': attempts}
        camera['pinPositions'] = pins
    missing = [(preset, equipment) for preset, ids in targets.get('requiredViews', {}).items()
               if preset in config['presets'] for equipment in ids
               if config['presets'][preset]['pinPositions'].get(equipment) is None]
    after = sha256(args.blend)
    if before != after or json.dumps(config['anchors'], sort_keys=True) != anchors_before:
        raise ValueError('Read-only source or distance-anchor invariant was violated')
    audit = {
        'schema': 'blender-card-pin-audit-v1', 'blend': str(args.blend),
        'sourceSha256Before': before, 'sourceSha256After': after, 'sourceUnchanged': True,
        'coordinateSystem': config['coordinateSystem'], 'referenceErrorsMeters': coordinate_errors,
        'distanceAnchorsUnchanged': True, 'requiredMissing': missing, 'presets': records,
    }
    args.audit.parent.mkdir(parents=True, exist_ok=True)
    args.audit.write_text(json.dumps(audit, indent=2) + '\n', encoding='utf-8')
    if missing:
        raise ValueError(f'Required visible surface pins missing; inspect audit: {missing}')
    config.setdefault('metadata', {})['surfacePins'] = {
        'schema': 'blender-camera-raycast-v1', 'sourceBlendSha256': before,
        'targetsSha256': sha256(args.targets), 'coordinateSystem': config['coordinateSystem'],
        'sourceBlend': '/'.join(args.blend.parts[-3:]),
        'distanceAnchorsUnchanged': True,
    }
    config['metadata']['anchorLimit'] = 'anchors는 설비 간 기준 거리용; 화면 핀은 presets.*.pinPositions의 카메라별 실제 표면점이며 가려지면 null'
    if args.write:
        temporary = args.config.with_suffix('.json.pin-tmp')
        try:
            temporary.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            temporary.replace(args.config)
        finally:
            temporary.unlink(missing_ok=True)
    hit_count = sum(hit['hit'] is not None for view in records.values() for hit in view.values())
    print(json.dumps({'status': 'written' if args.write else 'audited', 'presets': len(records),
                      'surfacePins': hit_count, 'sourceUnchanged': True, 'audit': str(args.audit)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Surface pin export failed: {error}', file=sys.stderr)
        raise
