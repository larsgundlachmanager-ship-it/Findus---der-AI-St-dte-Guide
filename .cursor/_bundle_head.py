from pathlib import Path

bundle = Path(
    r"C:\Users\larsf\Findus 2.0\android\app\build\generated\assets\createBundleReleaseJsAndAssets\index.android.bundle"
)
out = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live6w\bundle_head.txt")
b = bundle.read_bytes()
# decode latin1 to avoid unicode issues
text = b[:2000].decode("latin1", errors="replace")
counts = {}
for needle in [
    b"_$$_REQUIRE",
    b"metroRequire",
    b"__d(function",
    b"dependencyMap",
    b"unknown module",
]:
    counts[needle.decode()] = b.count(needle)
out.write_text(
    text + "\n\nCOUNTS:\n" + "\n".join(f"{k}={v}" for k, v in counts.items()),
    encoding="utf-8",
)
print("ok", counts)
