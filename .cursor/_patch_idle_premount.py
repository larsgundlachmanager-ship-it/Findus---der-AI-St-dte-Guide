from pathlib import Path
p = Path(r"src/services/ui/idlePrefetch.ts")
text = p.read_text(encoding="utf-8")
text2 = text
text2 = text2.replace("CHROME_PREMOUNT_AFTER_SETTLED_MS", "CHROME_PREMOUNT_AFTER_SPLASH_MS")
text2 = text2.replace("= 800;", "= 160;")
# remove waitUntilInteractiveSettled wrap around premount
old = """  const arm = () => {
    void waitUntilInteractiveSettled().then(() => {
      setTimeout(() => premountOverlayHosts(), CHROME_PREMOUNT_AFTER_SPLASH_MS);
      setTimeout(
        () => premountOverlayHosts(),
        CHROME_PREMOUNT_AFTER_SPLASH_MS + 400,
      );
    });
  };"""
new = """  const arm = () => {
    setTimeout(() => premountOverlayHosts(), CHROME_PREMOUNT_AFTER_SPLASH_MS);
    setTimeout(
      () => premountOverlayHosts(),
      CHROME_PREMOUNT_AFTER_SPLASH_MS + 400,
    );
  };"""
if old not in text2:
    raise SystemExit("arm block not found: " + repr(text2[text2.find("const arm"):text2.find("const arm")+350]))
text2 = text2.replace(old, new, 1)
text2 = text2.replace(
    "Host-Premount erst nach Interactive-Settle (+ Grace),\n * nie parallel zu MapLibre-Mount (Android Fabric sonst SoftException/Blackscreen).",
    "Host-Premount kurz nach Splash-Interactive\n * (Chrome/Mic zuerst — nicht hinter Hydrate/Settle warten).",
)
text2 = text2.replace(
    "Extra-Atemzug NACH Interactive-Window — nie parallel zu MapLibre-Mount.\n * Früher 100 ms nach Splash → Fabric MountItemDispatcher SoftException\n * („setState too many times during mounting“) → leerer Root / Blackscreen nach Mic.",
    "Kurz nach Splash-Lift — JS-Host warm, Native-Tree bleibt !visible → null\n * (Fabric/MapLibre). Nicht hinter Interactive-Settle (Hydrate) parken.",
)
text2 = text2.replace(
    "Bundle sofort; Host-Premount erst nach Interactive-Settle + Grace.\n * Nie unter Splash/Map-Boot (Android Fabric sonst leerer Root).",
    "Bundle sofort; Host-Premount kurz nach Splash-Interactive.\n * Heavy Hydrate weiter erst nach Interactive-Settle.",
)
text2 = text2.replace(
    "// Bundle früh; Host-Premount erst nach Interactive-Settle (nicht unter Map-Boot).",
    "// Bundle früh; Host-Premount direkt nach Splash-Interactive (Chrome zuerst).",
)
text2 = text2.replace(
    "// Chrome-Premount nach Splash-Interactive + Settle-Grace.\n  scheduleChromePremountAfterSplash();",
    "scheduleChromePremountAfterSplash();",
)
p.write_text(text2, encoding="utf-8")
print("patched idlePrefetch")
