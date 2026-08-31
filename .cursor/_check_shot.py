from PIL import Image
import collections, sys
path = r"C:\Users\larsf\Findus 2.0\.cursor\black-screen-fixed.png"
im = Image.open(path).convert("RGB")
w,h = im.size
# sample center and grid
pixels = []
for y in range(0,h,max(1,h//40)):
  for x in range(0,w,max(1,w//40)):
    pixels.append(im.getpixel((x,y)))
cnt = collections.Counter(pixels)
top = cnt.most_common(5)
total = sum(cnt.values())
dark = sum(c for p,c in cnt.items() if p[0]<=0x28 and p[1]<=0x28 and p[2]<=0x2b)
dark_ratio = dark/total
print(f"size={w}x{h} dark_ratio={dark_ratio:.3f} top={top[:3]}")
# solid #18181B check: >95% near that color = fail
near_18181b = sum(c for p,c in cnt.items() if abs(p[0]-0x18)<=8 and abs(p[1]-0x18)<=8 and abs(p[2]-0x1b)<=8)
near_ratio = near_18181b/total
print(f"near_18181B_ratio={near_ratio:.3f}")
ui_ok = near_ratio < 0.95 and dark_ratio < 0.98
print(f"UI_VISIBLE={ui_ok}")
sys.exit(0 if ui_ok and True else 1)
