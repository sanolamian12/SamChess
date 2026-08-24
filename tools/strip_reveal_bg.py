"""Remove baked-in backgrounds from assets/market/reveal-{s,a,b,e}.jpg and
write transparent PNGs next to them.

Two cases, detected automatically per file:

- Plain black canvas (reveal-s/a/e): these are digital paintings of a glow
  effect on a solid black background. The standard extraction for this kind
  of "additive glow" art is alpha = max(R,G,B) (screen/additive assumption),
  then unpremultiply the color by that alpha so it doesn't go dim/gray after
  compositing.

- Baked-in checkerboard preview (reveal-b): some earlier tool already ran
  background removal and then flattened the transparency preview (its
  checkerboard) into a JPEG, so the real alpha is lost. We know the exact
  per-pixel checker value (deterministic 30px grid of two grays), subtract
  it directly, estimate alpha with the same screen/additive assumption as
  above, then remove the residual checker-period bias with a Gaussian blur
  (alpha) and a frequency-notch filter (color) -- see
  history/2026-08-24_상점_이펙트_배경제거.md for why the naive per-tile
  two-background matting this started as didn't work.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import gaussian_filter

MARKET_DIR = Path(__file__).resolve().parent.parent / "assets" / "market"


def strip_black_bg(arr: np.ndarray) -> np.ndarray:
    """arr: HxWx3 float32 0-255. Returns HxWx4 uint8."""
    alpha = arr.max(axis=2)  # 0-255
    safe_alpha = np.clip(alpha, 1, 255)
    fg = np.clip(arr / safe_alpha[..., None] * 255.0, 0, 255)
    fg = np.where(alpha[..., None] > 0, fg, 0)
    out = np.dstack([fg, alpha]).astype(np.uint8)
    return out


def strip_checker_bg(
    arr: np.ndarray, tile: int = 30, bg_low: float = 72.0, bg_high: float = 108.0
) -> np.ndarray:
    """arr: HxWx3 float32 0-255, checkerboard baked in on a `tile`-px grid.

    Because the checker pattern is a deterministic function of (x, y), the
    exact background value is known at every pixel (not just estimated per
    tile). Subtracting it directly cancels the checkerboard almost exactly
    in flat background regions (leaving only small JPEG ringing), which is
    far more robust than averaging over 30px tiles when the foreground has
    fine detail (thin rays, petal outlines) that violates a "same
    foreground per tile" assumption.
    """
    h, w, _ = arr.shape
    type_full = (
        (np.arange(w)[None, :] // tile + np.arange(h)[:, None] // tile) % 2
    )
    bg_full = np.where(type_full == 0, bg_low, bg_high).astype(np.float32)  # (h,w)

    effective = arr - bg_full[..., None]  # (h,w,3), can be negative
    pos = np.clip(effective, 0, None)

    # displayed = fg*a + bg*(1-a), assuming (like the plain-black-bg files)
    # the source art always saturates its brightest channel to 255 wherever
    # a > 0. Then (displayed-bg).max() == a*(255-bg), so:
    scale = 255.0 - bg_full  # (h,w), headroom to white -- differs by tile type
    raw_alpha = np.clip(pos.max(axis=2) / scale, 0.0, 1.0)

    # Reconstruct color using this *raw*, per-pixel alpha -- it's derived
    # from the same `pos` value it's about to divide, so the two stay
    # self-consistent even though raw_alpha itself is biased by up to ~20%
    # depending on checker tile type (see below). Dividing by a smoothed
    # alpha instead (tried first) decouples color from the pos it came
    # from: for a channel that sits near its own background level (e.g.
    # the red channel of a blue glow), that reintroduced the checkerboard
    # as color banding even after the alpha channel itself was clean.
    raw_alpha_safe = np.clip(raw_alpha, 0.06, 1.0)[..., None]
    fg = np.clip(bg_full[..., None] + effective / raw_alpha_safe, 0, 255)

    # That still leaves a residual checkerboard bias in fg (raw_alpha's own
    # ~20% type-dependent error doesn't cancel against bg_full unless it's
    # exactly right). Rather than chase a better alpha model, notch the
    # checkerboard's fundamental frequency directly out of fg: demodulate
    # by the +1/-1 tile-type signal, lowpass (killing everything except the
    # slowly-varying bias envelope), remodulate, and subtract. This only
    # touches content that alternates at exactly the 30px checker period --
    # real brushwork (diagonal rays, round petals) isn't aligned to that
    # axis-locked grid and passes through untouched.
    checker_sign = (1.0 - 2.0 * type_full).astype(np.float64)  # +1 / -1
    for c in range(3):
        bias = gaussian_filter(fg[..., c] * checker_sign, sigma=tile)
        fg[..., c] = np.clip(fg[..., c] - checker_sign * bias, 0, 255)

    # The type-dependent scale above is only exactly correct where the true
    # unpremultiplied color saturates to 255; wherever it doesn't, the
    # bg=72 and bg=108 tiles disagree by ~20%, which is a checkerboard
    # ghost in *alpha*. Blur just the alpha channel at ~1.5 tiles to average
    # that step out -- the glow shapes here are large and soft, so losing
    # crispness at this radius isn't visible, while it kills the 30px
    # period artifact.
    alpha_img = Image.fromarray((raw_alpha * 255).astype(np.uint8), mode="L")
    alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(radius=tile * 1.5))
    alpha = np.array(alpha_img, dtype=np.float64) / 255.0

    # JPEG ringing around the checker edges leaves a faint residual even in
    # pure background tiles; black-point it out to fully flatten to 0.
    black_point = 35.0 / 255.0
    alpha = np.clip(alpha - black_point, 0, None) * (1.0 / (1.0 - black_point))
    alpha = np.clip(alpha, 0.0, 1.0)

    out = np.dstack([fg, alpha * 255.0]).astype(np.uint8)
    return out


def is_checker_bg(arr: np.ndarray) -> bool:
    corner = arr[:20, :20].reshape(-1, 3).mean(axis=0)
    return corner.mean() > 20  # black-bg files sample ~0 here


def process(path: Path) -> Path:
    im = Image.open(path).convert("RGB")
    arr = np.array(im).astype(np.float32)
    if is_checker_bg(arr):
        out = strip_checker_bg(arr)
    else:
        out = strip_black_bg(arr)
    out_path = path.with_suffix(".png")
    Image.fromarray(out, mode="RGBA").save(out_path)
    return out_path


def main(argv):
    names = argv[1:] or ["reveal-s", "reveal-a", "reveal-b", "reveal-e"]
    for name in names:
        src = MARKET_DIR / f"{name}.jpg"
        if not src.exists():
            print(f"skip (missing): {src}")
            continue
        out_path = process(src)
        print(f"wrote {out_path}")


if __name__ == "__main__":
    main(sys.argv)
