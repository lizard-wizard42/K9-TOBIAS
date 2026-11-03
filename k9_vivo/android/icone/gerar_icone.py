"""Gera o ícone adaptativo do app K9 (camadas PNG por densidade). Uso: python3 icone/gerar_icone.py (precisa de Pillow).
Marca Lizard Wizard: fundo tinta, K em papel, 9 em coral, filete oliva. A área segura do Android é o círculo central de 66/108."""
import os
from PIL import Image, ImageDraw, ImageFont

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "src", "main", "res")
FONTE = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
PAPEL, CORAL, OLIVA = (232, 231, 227, 255), (239, 89, 63, 255), (120, 147, 83, 255)
DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}   # 108 dp * fator

def camada(px, cores):
    """Foreground 108dp: 'K9' centralizado dentro da área segura; cores=(cor do K, cor do 9, cor do filete) (None = sem filete)."""
    s = px / 108.0
    im = Image.new("RGBA", (px, px), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONTE, int(46 * s))
    kb, nb = d.textbbox((0, 0), "K", font=f), d.textbbox((0, 0), "9", font=f)
    folga = int(1.5 * s)
    larg = (kb[2] - kb[0]) + folga + (nb[2] - nb[0]); alto = max(kb[3] - kb[1], nb[3] - nb[1])
    x0 = (px - larg) // 2; y0 = (px - alto) // 2 - int(3 * s)
    d.text((x0 - kb[0], y0 - kb[1]), "K", font=f, fill=cores[0])
    d.text((x0 + (kb[2] - kb[0]) + folga - nb[0], y0 - nb[1]), "9", font=f, fill=cores[1])
    if cores[2]:
        yb = y0 + alto + int(5 * s); d.rounded_rectangle([x0, yb, x0 + larg, yb + int(2.6 * s)], radius=int(1.3 * s), fill=cores[2])
    return im

for nome, fator in DENS.items():
    px = int(108 * fator); pasta = os.path.join(RAIZ, f"mipmap-{nome}"); os.makedirs(pasta, exist_ok=True)
    camada(px, (PAPEL, CORAL, OLIVA)).save(os.path.join(pasta, "ic_launcher_foreground.png"))
    camada(px, ((255,) * 4, (255,) * 4, None)).save(os.path.join(pasta, "ic_launcher_monochrome.png"))   # ícone temático do Android 13+

os.makedirs(os.path.join(RAIZ, "mipmap-anydpi-v26"), exist_ok=True)
xml = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background" />\n    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n</adaptive-icon>\n'
for n in ("ic_launcher", "ic_launcher_round"):
    open(os.path.join(RAIZ, "mipmap-anydpi-v26", n + ".xml"), "w").write(xml)
open(os.path.join(RAIZ, "values", "colors.xml"), "w").write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0E1110</color>\n</resources>\n')

# prévia 512 (como a Play Store mostra): fundo + camada, recortada num círculo e num quadrado arredondado
base = Image.new("RGBA", (432, 432), (14, 17, 16, 255)); base.alpha_composite(camada(432, (PAPEL, CORAL, OLIVA)))
prev = Image.new("RGBA", (1000, 520), (40, 44, 42, 255)); a = base.resize((440, 440), Image.LANCZOS)
m1 = Image.new("L", (440, 440), 0); ImageDraw.Draw(m1).ellipse([0, 0, 439, 439], fill=255)
m2 = Image.new("L", (440, 440), 0); ImageDraw.Draw(m2).rounded_rectangle([0, 0, 439, 439], radius=110, fill=255)
prev.paste(a, (30, 40), m1); prev.paste(a, (530, 40), m2); prev.convert("RGB").save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "previa-icone-k9.png"))
print("ok")
