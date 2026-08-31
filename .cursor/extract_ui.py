import re, html, sys
p = sys.argv[1]
t = open(p, encoding="utf-8").read()
texts = re.findall(r'text="([^"]*)"', t)
descs = re.findall(r'content-desc="([^"]*)"', t)
seen = set()
out = []
for x in texts + descs:
    x = html.unescape(x).strip()
    if x and x not in seen:
        seen.add(x)
        out.append(x)
open(p.replace(".xml", "-text.txt"), "w", encoding="utf-8").write("\n".join(out))
print("wrote", len(out), "strings")
