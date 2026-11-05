"""The fox tutor from the user's character sheet (jenga_tutor.png, a Gemini render): four poses cut out, cleaned,
upscaled 4x, aligned on one frame, with the data the game needs to draw talking mouths on them.

    U2NET_HOME=<models> uv run --with "rembg[cpu]" --with pillow --with numpy --with scipy --with opencv-python-headless \
        python tools/build_tutor.py <sheet.png> [--from N]

Stages (cached in $TUTOR_CACHE, default the scratch dir; --from N redoes stage N and later):
  1 crop each pose + matte (rembg birefnet-general)
  2 keep the fox (largest piece + what touches it: drops labels, arrows, the block icon, the sparkle), decontaminate
    the soft edge against the plain sheet background, bleed colour into the transparent area
  3 upscale RGB and alpha 4x (Real-ESRGAN x4plus-anime, ncnn binary), alpha kept inside the original silhouette
  4 measure eyes / nose / mouth / ground, scale the rows to one size, place every pose on one frame, paint the mouth
    out into a 'muzzle' patch per pose → public/fox/<pose>.webp, muzzle.webp, fox.json
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get('TUTOR_CACHE', '/Users/jini/.hermes/cache/scratch/jenga/tutor/cache'))
ESR = Path(os.environ.get('ESRGAN_DIR', os.path.expanduser('~/.cache/g-learning/realesrgan')))
OUT = ROOT / 'public' / 'fox'

# pose → crop box in the 2752x1536 sheet. front (T-pose model view), side and back views are not used.
POSES = {
    'teach': (2180, 905, 2692, 1450),   # presenting with a star wand → idle / talk / point
    'read': (985, 900, 1422, 1450),     # glasses, holding blocks → say (the read-aloud moment)
    'jump': (2150, 205, 2645, 860),     # jumping, arms up, eyes open → happy / the title wave
    'great': (1500, 900, 1910, 1428),   # eyes shut, arms up ("Great job!") → cheer (the tail reaches x≈1885; the
                                        # label right of it doesn't touch the fox, stage 2 drops it)
}


def log(*a):
    print(*a, flush=True)


def stage1(sheet: Image.Image):
    from rembg import new_session, remove
    sess = new_session('birefnet-general')
    for name, box in POSES.items():
        dst = CACHE / f'{name}_1_matte.png'
        crop = sheet.crop(box)
        crop.save(CACHE / f'{name}_0_crop.png')
        m = remove(crop, session=sess, only_mask=True)
        m.save(dst)
        log('matte', name, crop.size)


def bleed(rgb: np.ndarray, known: np.ndarray, rounds=60) -> np.ndarray:
    """fill unknown pixels with the colour of the nearest known ones (3x3 growth)"""
    out = rgb.astype(np.float32).copy()
    filled = known.copy()
    h, w = filled.shape
    for _ in range(rounds):
        if filled.all():
            break
        acc = np.pad(out * filled[..., None], ((1, 1), (1, 1), (0, 0)), mode='edge')
        wt = np.pad(filled.astype(np.float32), 1, mode='edge')
        s_acc = sum(acc[dy:dy + h, dx:dx + w] for dy in range(3) for dx in range(3))
        s_w = sum(wt[dy:dy + h, dx:dx + w] for dy in range(3) for dx in range(3))
        grow = (~filled) & (s_w > 0)
        out[grow] = s_acc[grow] / s_w[grow][:, None]
        filled |= grow
    return out


def stage2():
    from scipy import ndimage as ndi
    for name in POSES:
        crop = np.asarray(Image.open(CACHE / f'{name}_0_crop.png').convert('RGB')).astype(np.float32)
        a = np.asarray(Image.open(CACHE / f'{name}_1_matte.png').convert('L')).astype(np.float32) / 255
        # the fox = the largest confident piece + soft pixels touching it
        lab, n = ndi.label(a > 0.5)
        if n == 0:
            raise SystemExit(f'{name}: empty matte')
        sizes = ndi.sum(np.ones_like(a), lab, range(1, n + 1))
        core = lab == (1 + int(np.argmax(sizes)))
        soft_lab, _ = ndi.label(a > 0.02)
        keep_ids = np.unique(soft_lab[core])
        keep = np.isin(soft_lab, keep_ids[keep_ids > 0])
        dropped = int(((a > 0.5) & ~core).sum())
        a = np.where(keep, a, 0)
        # holes inside the fox that the model left semi-transparent: none expected on a plain sheet, report them
        holes = ndi.binary_fill_holes(a > 0.5) & (a < 0.5)
        # background colour behind each pixel: normalised blur of the clearly-background pixels
        bgm = (a < 0.01).astype(np.float32)
        Bk = np.stack([ndi.gaussian_filter(crop[..., c] * bgm, 25) for c in range(3)], -1)
        Wk = ndi.gaussian_filter(bgm, 25)[..., None]
        B = Bk / np.maximum(Wk, 1e-4)
        # decontaminate: F = B + (I - B) / a on the soft edge; very soft pixels take the nearby fox colour instead
        F = crop.copy()
        edge = (a > 0.02) & (a < 0.98)
        aa = np.maximum(a, 0.05)[..., None]
        F_edge = np.clip(B + (crop - B) / aa, 0, 255)
        F[edge] = F_edge[edge]
        inner = bleed(crop, a > 0.85)
        w = np.clip((a - 0.15) / 0.35, 0, 1)[..., None]          # a<0.15 → interior colour, a>0.5 → decontaminated
        F = np.where(edge[..., None], w * F + (1 - w) * inner, F)
        F = bleed(F, a > 0.02)                                    # colour under the transparent area (for upscaling)
        rgba = np.dstack([np.clip(F, 0, 255).astype(np.uint8), (a * 255).round().astype(np.uint8)])
        Image.fromarray(rgba, 'RGBA').save(CACHE / f'{name}_2_rgba.png')
        log('clean', name, 'dropped (labels/icons) px:', dropped, '| enclosed soft holes px:', int(holes.sum()))


def esrgan(src: Path, dst: Path):
    r = subprocess.run([str(ESR / 'realesrgan-ncnn-vulkan'), '-i', str(src), '-o', str(dst), '-n', 'realesrgan-x4plus-anime', '-s', '4',
                        '-m', str(ESR / 'models')], capture_output=True, text=True)
    if r.returncode != 0 or not dst.exists():
        raise SystemExit(f'esrgan failed for {src}: {r.stderr[-400:]}')


def stage3():
    for name in POSES:
        im = np.asarray(Image.open(CACHE / f'{name}_2_rgba.png').convert('RGBA'))
        a = im[..., 3]
        p_rgb, p_a = CACHE / f'{name}_3_rgb.png', CACHE / f'{name}_3_a.png'
        Image.fromarray(im[..., :3], 'RGB').save(p_rgb)
        Image.fromarray(np.dstack([a, a, a]), 'RGB').save(p_a)
        o_rgb, o_a = CACHE / f'{name}_3_rgb4.png', CACHE / f'{name}_3_a4.png'
        esrgan(p_rgb, o_rgb)
        esrgan(p_a, o_a)
        up_rgb = Image.open(o_rgb).convert('RGB')
        up_a = Image.open(o_a).convert('L')
        ref = Image.fromarray(a, 'L').resize(up_a.size, Image.Resampling.LANCZOS).filter(ImageFilter.MaxFilter(5))
        up_a = Image.fromarray(np.minimum(np.asarray(up_a), np.asarray(ref)), 'L')
        out = up_rgb.copy()
        out.putalpha(up_a)
        out.save(CACHE / f'{name}_3_x4.png')
        log('x4', name, out.size)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    sheet = Image.open(sys.argv[1]).convert('RGB')
    if sheet.size != (2752, 1536):
        raise SystemExit(f'unexpected sheet size {sheet.size}: re-measure POSES')
    start = int(sys.argv[sys.argv.index('--from') + 1]) if '--from' in sys.argv else 1
    CACHE.mkdir(parents=True, exist_ok=True)
    stages = {1: lambda: stage1(sheet), 2: stage2, 3: stage3}
    for k in sorted(stages):
        if k >= start:
            stages[k]()
    if 4 >= start:
        import build_tutor_assemble  # noqa: F401  (stage 4 lives next to this file)
        build_tutor_assemble.run(CACHE, OUT, POSES)


if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).parent))
    main()
