from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "marketing" / "demo" / "assets"
FRAME_DIR = OUT_DIR / "frames"
FPS = 12
WIDTH = 1280
HEIGHT = 720
DURATION = 48


def font(path: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


FONT_REG = font(r"C:\Windows\Fonts\segoeui.ttf", 30)
FONT_BOLD = font(r"C:\Windows\Fonts\segoeuib.ttf", 40)
FONT_MONO = font(r"C:\Windows\Fonts\consola.ttf", 24)
FONT_MONO_BOLD = font(r"C:\Windows\Fonts\consolab.ttf", 24)
FONT_SMALL = font(r"C:\Windows\Fonts\segoeui.ttf", 22)


COLORS = {
    "bg": (11, 15, 20),
    "panel": (18, 24, 32),
    "panel2": (24, 31, 42),
    "border": (61, 77, 98),
    "text": (231, 238, 245),
    "muted": (144, 157, 174),
    "green": (76, 217, 137),
    "blue": (99, 179, 237),
    "yellow": (245, 203, 92),
    "purple": (184, 148, 246),
    "red": (255, 118, 117),
}


SCENES = [
    {
        "start": 0,
        "end": 6,
        "headline": "Build apps AI coding agents can actually understand.",
        "sub": "ForgeOS turns code into contracts, maps, runtime boundaries, and verification workflows.",
        "lines": [
            ("All from code.", "green"),
            ("No dashboards.", "blue"),
            ("No hidden state.", "purple"),
        ],
    },
    {
        "start": 6,
        "end": 16,
        "title": "Create an agent-native app",
        "cmd": "npm create forgeos-app@alpha notes-app -- --template minimal-web",
        "out": [
            ("create-forgeos-app@alpha", "muted"),
            ("[ok] minimal-web template copied", "green"),
            ("[ok] Forge provider and generated bridge ready", "green"),
            ("[ok] no dashboard setup required", "green"),
        ],
    },
    {
        "start": 16,
        "end": 27,
        "title": "Inspect the app contract",
        "cmd": "npm run forge -- inspect all --json",
        "out": [
            ('"agentContract": "generated"', "blue"),
            ('"appMap": "generated"', "blue"),
            ('"runtimeBoundaries": ["commands", "queries", "actions", "workflows"]', "purple"),
            ('"frontend": { "routes": 3, "bindings": "generated" }', "yellow"),
            ('"sourceControlled": true', "green"),
        ],
    },
    {
        "start": 27,
        "end": 36,
        "title": "Give agents a safe tool surface",
        "cmd": "npm run forge -- inspect agent-tools --json",
        "out": [
            ('"tools": ["createNote", "listNotes", "updateNote"]', "blue"),
            ('"approval": "declared in code"', "green"),
            ('"risk": "metadata visible to agents"', "yellow"),
            ('"guessing": false', "green"),
        ],
    },
    {
        "start": 36,
        "end": 45,
        "title": "Verify changes before handoff",
        "cmd": "npm run forge -- verify --standard",
        "out": [
            ("ok generate-check", "green"),
            ("ok forge-check", "green"),
            ("ok typecheck", "green"),
            ("ok impact-tests", "green"),
            ("ForgeOS app verified from code.", "blue"),
        ],
    },
    {
        "start": 45,
        "end": 48,
        "headline": "ForgeOS",
        "sub": "Agent-native TypeScript apps. Inspectable. Modifiable. Verifiable.",
        "lines": [
            ("All from code.", "green"),
            ("No dashboards.", "blue"),
        ],
    },
]


def rounded(draw: ImageDraw.ImageDraw, xy: tuple[int, int, int, int], radius: int, fill, outline=None, width=1) -> None:
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def text_width(draw: ImageDraw.ImageDraw, text: str, fnt) -> int:
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0]


def draw_gradient(draw: ImageDraw.ImageDraw) -> None:
    for y in range(HEIGHT):
        ratio = y / HEIGHT
        r = int(11 + ratio * 9)
        g = int(15 + ratio * 13)
        b = int(20 + ratio * 19)
        draw.line([(0, y), (WIDTH, y)], fill=(r, g, b))


def current_scene(t: float) -> dict:
    for scene in SCENES:
        if scene["start"] <= t < scene["end"]:
            return scene
    return SCENES[-1]


def scene_progress(scene: dict, t: float) -> float:
    return max(0.0, min(1.0, (t - scene["start"]) / (scene["end"] - scene["start"])))


def typewriter(text: str, progress: float, start: float = 0.05, end: float = 0.22) -> str:
    if progress <= start:
        return ""
    local = min(1.0, (progress - start) / (end - start))
    count = max(0, min(len(text), math.floor(len(text) * local)))
    cursor = "_" if local < 1.0 and int(progress * 12) % 2 == 0 else ""
    return text[:count] + cursor


def visible_output(lines: list[tuple[str, str]], progress: float) -> list[tuple[str, str]]:
    visible: list[tuple[str, str]] = []
    base = 0.30
    span = 0.56
    for i, line in enumerate(lines):
        threshold = base + (i / max(1, len(lines))) * span
        if progress >= threshold:
            visible.append(line)
    return visible


def draw_brand(draw: ImageDraw.ImageDraw) -> None:
    draw.text((72, 48), "ForgeOS", font=FONT_BOLD, fill=COLORS["text"])
    pill = (238, 50, 438, 88)
    rounded(draw, pill, 19, COLORS["panel2"], COLORS["border"])
    draw.text((258, 57), "no dashboards", font=FONT_SMALL, fill=COLORS["blue"])


def draw_title_scene(draw: ImageDraw.ImageDraw, scene: dict, progress: float) -> None:
    headline = scene["headline"]
    sub = scene["sub"]
    y = 188
    draw.text((72, y), headline, font=FONT_BOLD, fill=COLORS["text"])
    draw.text((74, y + 66), sub, font=FONT_REG, fill=COLORS["muted"])
    x = 74
    y2 = y + 135
    for text, color in scene["lines"]:
        w = text_width(draw, text, FONT_REG) + 44
        rounded(draw, (x, y2, x + w, y2 + 54), 12, COLORS["panel"], COLORS["border"])
        draw.text((x + 22, y2 + 10), text, font=FONT_REG, fill=COLORS[color])
        x += w + 18


def draw_terminal_scene(draw: ImageDraw.ImageDraw, scene: dict, progress: float) -> None:
    x1, y1, x2, y2 = 72, 130, 1208, 604
    rounded(draw, (x1, y1, x2, y2), 16, COLORS["panel"], COLORS["border"], 2)
    rounded(draw, (x1, y1, x2, y1 + 54), 16, COLORS["panel2"], COLORS["border"], 1)
    for i, color in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        draw.ellipse((x1 + 22 + i * 28, y1 + 18, x1 + 36 + i * 28, y1 + 32), fill=color)
    draw.text((x1 + 120, y1 + 15), scene["title"], font=FONT_SMALL, fill=COLORS["muted"])

    y = y1 + 88
    draw.text((x1 + 34, y), "$", font=FONT_MONO_BOLD, fill=COLORS["green"])
    cmd = typewriter(scene["cmd"], progress)
    draw.text((x1 + 64, y), cmd, font=FONT_MONO_BOLD, fill=COLORS["text"])

    y += 54
    for text, color in visible_output(scene["out"], progress):
        draw.text((x1 + 64, y), text, font=FONT_MONO, fill=COLORS[color])
        y += 43

    caption = "programmatic app contracts - source controlled - no manual control panel"
    draw.text((x1 + 34, y2 - 48), caption, font=FONT_SMALL, fill=COLORS["muted"])


def draw_footer(draw: ImageDraw.ImageDraw, frame_idx: int, total: int) -> None:
    x1, x2, y = 72, 1208, 650
    draw.line((x1, y, x2, y), fill=(42, 54, 70), width=4)
    progress = frame_idx / max(1, total - 1)
    draw.line((x1, y, x1 + int((x2 - x1) * progress), y), fill=COLORS["blue"], width=4)
    draw.text((72, 666), "agent-native TypeScript - inspect / modify / verify - all from code", font=FONT_SMALL, fill=COLORS["muted"])


def render_frame(frame_idx: int, total: int) -> None:
    t = frame_idx / FPS
    scene = current_scene(t)
    progress = scene_progress(scene, t)
    image = Image.new("RGB", (WIDTH, HEIGHT), COLORS["bg"])
    draw = ImageDraw.Draw(image)
    draw_gradient(draw)
    draw_brand(draw)
    if "cmd" in scene:
        draw_terminal_scene(draw, scene, progress)
    else:
        draw_title_scene(draw, scene, progress)
    draw_footer(draw, frame_idx, total)
    image.save(FRAME_DIR / f"frame_{frame_idx:04d}.png")


def run(command: list[str]) -> None:
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if FRAME_DIR.exists():
        shutil.rmtree(FRAME_DIR)
    FRAME_DIR.mkdir(parents=True)
    total = DURATION * FPS
    for frame_idx in range(total):
        render_frame(frame_idx, total)

    mp4 = OUT_DIR / "forgeos-demo-short.mp4"
    gif = OUT_DIR / "forgeos-demo-short.gif"
    palette = OUT_DIR / "palette.png"

    run([
        "ffmpeg",
        "-y",
        "-framerate",
        str(FPS),
        "-i",
        str(FRAME_DIR / "frame_%04d.png"),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(mp4),
    ])
    run([
        "ffmpeg",
        "-y",
        "-i",
        str(mp4),
        "-vf",
        "fps=12,scale=960:-1:flags=lanczos,palettegen",
        str(palette),
    ])
    run([
        "ffmpeg",
        "-y",
        "-i",
        str(mp4),
        "-i",
        str(palette),
        "-lavfi",
        "fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4",
        str(gif),
    ])
    shutil.rmtree(FRAME_DIR)
    palette.unlink(missing_ok=True)
    print(mp4)
    print(gif)


if __name__ == "__main__":
    main()
