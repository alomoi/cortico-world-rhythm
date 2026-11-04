from PIL import Image, ImageDraw, ImageFont

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角深蓝夜空
bg = (27, 35, 64, 255)
d.rounded_rectangle([0, 0, S, S], radius=210, fill=bg)
# 柔和的上下渐变
grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / S
    gd.line([(0, y), (S, y)], fill=(70, 92, 150, int(70 * (1 - t))))
img = Image.alpha_composite(img, grad)
d = ImageDraw.Draw(img)

# 星星
for (x, y, r, a) in [(170, 170, 7, 150), (860, 420, 6, 120), (250, 360, 5, 110),
                     (760, 640, 5, 90), (140, 520, 4, 80), (900, 180, 5, 130)]:
    d.ellipse([x - r, y - r, x + r, y + r], fill=(220, 230, 255, a))

# 月亮
d.ellipse([700, 120, 900, 320], fill=(246, 226, 158, 255))
d.ellipse([745, 105, 940, 300], fill=(27, 35, 64, 255))

# Zzz
try:
    font_big = ImageFont.truetype("arialbd.ttf", 96)
    font_mid = ImageFont.truetype("arialbd.ttf", 70)
    font_small = ImageFont.truetype("arialbd.ttf", 50)
except Exception:
    font_big = font_mid = font_small = ImageFont.load_default()
d.text((575, 300), "Z", font=font_big, fill=(190, 205, 240, 220))
d.text((665, 240), "z", font=font_mid, fill=(170, 190, 230, 180))
d.text((735, 196), "z", font=font_small, fill=(150, 175, 220, 150))

# 鱼身
body = [200, 360, 800, 830]
d.ellipse(body, fill=(92, 170, 200, 255))
# 肚皮
d.ellipse([250, 520, 760, 830], fill=(246, 231, 200, 255))
# 尾巴
d.polygon([(205, 560), (90, 470), (110, 660), (205, 610)], fill=(72, 145, 178, 255))
# 背鳍
d.polygon([(420, 372), (520, 300), (600, 385)], fill=(72, 145, 178, 255))
# 侧鳍

# 闭眼
d.arc([360, 480, 450, 540], start=20, end=160, fill=(38, 55, 80, 255), width=12)
d.arc([560, 480, 650, 540], start=20, end=160, fill=(38, 55, 80, 255), width=12)
# 腮红
d.ellipse([330, 570, 400, 610], fill=(240, 150, 150, 150))
d.ellipse([610, 570, 680, 610], fill=(240, 150, 150, 150))
# 小嘴
d.arc([470, 600, 545, 650], start=20, end=160, fill=(60, 85, 110, 255), width=10)

# 缩放到 256，圆角外透明
img = img.resize((256, 256), Image.LANCZOS)
mask = Image.new("L", (256, 256), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, 256, 256], radius=52, fill=255)
img.putalpha(mask)
img.save("icon.png")
print("saved icon.png")
