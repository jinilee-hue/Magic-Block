"""Tutor part weights carried out into the transparent pixels round the picture (user: "여우 끝 꼬리가 잘리는 현상이 있어").

The mesh (src/ui/fox.ts) moves a vertex by the painted weight under it. Outside the silhouette the weights stopped about
20 px out, so when the tail swung outward its tip ran into mesh points that stayed put and was squeezed flat against
them — a straight cut along a grid line. Arms and ears had the same short band. Now each transparent pixel within
REACH takes the weights of the nearest opaque pixel: the band round a part moves with it. Weights on the picture itself
are untouched (the bag, body and legs move exactly as before).

usage: /Users/jini/.hermes/bin/uv run --with pillow --with numpy --with scipy python tools/extend_tutor_weights.py [public/fox]
(build_tutor_rig.py does the same before it saves its maps)
"""
import json
import pathlib
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

REACH = 60          # px at the maps' half size = 120 px of the picture: more than a wagging tip travels (~60) + a grid cell


def extend(w: np.ndarray, opaque: np.ndarray, reach: float = REACH) -> np.ndarray:
    """w: H × W × C weights (0-1), opaque: H × W bool at the same size → the transparent pixels within `reach` take the
    weights of their nearest opaque pixel"""
    d, (iy, ix) = ndimage.distance_transform_edt(~opaque, return_indices=True)
    out = w.copy()
    band = ~opaque & (d <= reach)
    out[band] = w[iy[band], ix[band]]
    return out


def opaque_at(rgba: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """the picture's opaque pixels at a map's size (W, H)"""
    return np.asarray(Image.fromarray(rgba[..., 3]).resize(size, Image.Resampling.BILINEAR)) > 127


def main(fox_dir: pathlib.Path):
    meta = json.loads((fox_dir / 'fox.json').read_text())
    for name, P in meta['poses'].items():
        rgba = np.array(Image.open(fox_dir / P['file']).convert('RGBA'))
        for key in ('wmap', 'emap'):
            f = P['rig'].get(key)
            if not f:
                continue
            im = Image.open(fox_dir / f).convert('RGB')
            w = np.asarray(im).astype(np.float32) / 255
            op = opaque_at(rgba, im.size)
            before = [(w[..., c] > 0.25)[~op].sum() for c in range(3)]
            out = extend(w, op)
            after = [(out[..., c] > 0.25)[~op].sum() for c in range(3)]
            Image.fromarray((out * 255).round().clip(0, 255).astype(np.uint8), 'RGB').save(fox_dir / f, 'WEBP', lossless=True, method=6)
            print(f'{name:6} {f:13} weighted transparent px per channel {before} → {after}')


if __name__ == '__main__':
    main(pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'public/fox'))
