from pathlib import Path

# specializedFoodMatch steak block
p = Path(r"src/module2/pitch/specializedFoodMatch.ts")
t = p.read_text(encoding="utf-8")
start = t.find("  if (/steak/.test(wt)) {")
if start < 0:
    raise SystemExit("steak block not found")
end = t.find("  if (/\\bd[öo]ner\\b|kebab|kebap/.test(wt)) {", start)
if end < 0:
    raise SystemExit("doner block not found")
new = r'''  if (/steak/.test(wt)) {
    // Metzgerei/Fleischerei ≠ Speiselokal — auch wenn „Steak“ im Namen steht
    const butcherOnly =
      blobHas(b, /\b(fleischerei|metzgerei|metzger|butcher)\b/) &&
      !blobHas(
        b,
        /\b(steakhouse|steak.?haus|grillhaus|restaurant|parrilla|churrasco|meal_takeaway|bistro)\b/,
      );
    if (butcherOnly) return 0;
    if (
      blobHas(
        b,
        /steakhouse|steak.?haus|\bsteaks?\b|prime\s*rib|ribeye|rinderfilet|rumpsteak|hüftsteak|hueftsteak|filetsteak|entrecote|entrecôte|filet.{0,16}gegrillt|gegrilltes?\s+filet/,
      ) &&
      !butcherOnly
    ) {
      return 3;
    }
    // Soft-Fail-Familie: Grill-/Steakhouse-Träger — nie Metzgerei/Döner
    if (
      blobHas(
        b,
        /steakhouse|steak.?haus|grillhaus|\bribs?\b|prime\s*rib|rumpsteak|ribeye|churrasco|asado|parrilla|steak\s*frites/,
      ) &&
      !blobHas(b, /\bd[öo]ner\b|kebab|kebap|shawarma|fleischerei|metzgerei|metzger|butcher/)
    ) {
      return 1;
    }
    return 0;
  }

'''
out = t[:start] + new + t[end:]
Path(r".cursor/_specializedFoodMatch_new.ts").write_text(out, encoding="utf-8")
print("specialized ok", len(out))

# resolveMissionAskBack
p2 = Path(r"src/module2/mission/resolveMissionAskBack.ts")
t2 = p2.read_text(encoding="utf-8")
old2 = """    /\\bwen\\s+genau\\s+(du\\s+)?meinst\\b/iu.test(t) ||
    /\\bfehlt\\s+da\\s+gerade\\s+der\\s+name\\b/iu.test(t) ||
    /\\bauf\\s+die\\s+du\\s+dich\\s+beziehst\\b/iu.test(t) ||"""
new2 = """    /\\bwen\\s+genau\\s+(du\\s+)?meinst\\b/iu.test(t) ||
    /\\bwen\\s+meinst\\s+du\\b/iu.test(t) ||
    /\\bsagt?\\s+mir\\s+kurz,?\\s+wen\\b/iu.test(t) ||
    /\\bfehlt\\s+da\\s+gerade\\s+der\\s+name\\b/iu.test(t) ||
    /\\bmir\\s+fehlt\\s+da\\s+gerade\\b/iu.test(t) ||
    /\\bauf\\s+die\\s+du\\s+dich\\s+beziehst\\b/iu.test(t) ||
    /\\bPerson,?\\s+auf\\s+die\\s+du\\s+dich\\s+beziehst\\b/iu.test(t) ||"""
if old2 not in t2:
    raise SystemExit("askBack old not found")
Path(r".cursor/_resolveMissionAskBack_new.ts").write_text(t2.replace(old2, new2, 1), encoding="utf-8")
print("askBack ok")
