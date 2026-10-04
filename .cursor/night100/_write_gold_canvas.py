import json
from pathlib import Path

items = json.loads(Path(".cursor/night100/_gold69_compact.json").read_text(encoding="utf-8"))
payload = json.dumps(items, ensure_ascii=False)

# Check Pill props from SDK mentally: PillTone, no onClick maybe - use Button for filters
canvas = f"""import {{
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  H1,
  Pill,
  Row,
  Spacer,
  Stack,
  Stat,
  Text,
  TextInput,
  useHostTheme,
  useMemo,
  useState,
}} from "cursor/canvas";

type Gold = {{
  n: number;
  k: string;
  legacy: boolean;
  f: string;
  s: string;
  e: string[];
  a: string[];
}};

const ITEMS: Gold[] = {payload};

const FAMILIES = [
  "all",
  "planning",
  "dining",
  "general",
  "knowledge",
  "events",
  "navigation",
  "activity_poi",
  "mobility",
] as const;

export default function OwnerGold69() {{
  useHostTheme();
  const [q, setQ] = useState("");
  const [family, setFamily] = useState<string>("all");

  const counts = useMemo(() => {{
    const m: Record<string, number> = {{}};
    for (const it of ITEMS) m[it.f] = (m[it.f] || 0) + 1;
    return m;
  }}, []);

  const filtered = useMemo(() => {{
    const needle = q.trim().toLowerCase();
    return ITEMS.filter((it) => {{
      if (family !== "all" && it.f !== family) return false;
      if (!needle) return true;
      const hay = [it.k, it.s, it.f, ...it.e, ...it.a].join(" ").toLowerCase();
      return hay.includes(needle);
    }});
  }}, [q, family]);

  return (
    <Stack gap={{16}} style={{{{ padding: 20, maxWidth: 920 }}}}>
      <Stack gap={{6}}>
        <H1>Owner-Gold — 69 Blaupausen</H1>
        <Text tone="secondary">
          Live-Pack aus ownerGold.pack.json. Filter nach Familie oder Stichwort.
        </Text>
      </Stack>

      <Row gap={{12}} style={{{{ flexWrap: "wrap" }}}}>
        <Stat label="Gesamt" value={{String(ITEMS.length)}} />
        <Stat label="Gefiltert" value={{String(filtered.length)}} />
        <Stat
          label="Legacy ohne Key"
          value={{String(ITEMS.filter((x) => x.legacy).length)}}
        />
      </Row>

      <TextInput
        value={{q}}
        onChange={{setQ}}
        placeholder="Suche: situationKey, Summary, expect…"
      />

      <Row gap={{8}} style={{{{ flexWrap: "wrap" }}}}>
        {{FAMILIES.map((f) => {{
          const label =
            f === "all" ? `alle (${{ITEMS.length}})` : `${{f}} (${{counts[f] || 0}})`;
          const active = family === f;
          return (
            <Button
              key={{f}}
              variant={{active ? "primary" : "secondary"}}
              size="small"
              onClick={{() => setFamily(f)}}
            >
              {{label}}
            </Button>
          );
        }})}}
      </Row>

      <Divider />

      <Stack gap={{12}}>
        {{filtered.map((it) => (
          <Card key={{`${{it.n}}-${{it.k}}`}}>
            <CardHeader
              title={{`${{it.n}}. ${{it.k}}`}}
              trailing={{
                <Row gap={{6}}>
                  <Pill size="sm">{{it.f}}</Pill>
                  {{it.legacy ? <Pill size="sm">legacy</Pill> : null}}
                </Row>
              }}
            />
            <CardBody>
              <Stack gap={{10}}>
                <Text>{{it.s}}</Text>
                {{it.e.length > 0 ? (
                  <Stack gap={{4}}>
                    <Text weight="semibold" size="small">
                      Expect
                    </Text>
                    <Row gap={{6}} style={{{{ flexWrap: "wrap" }}}}>
                      {{it.e.map((x) => (
                        <Pill key={{x}} size="sm">
                          {{x}}
                        </Pill>
                      ))}}
                    </Row>
                  </Stack>
                ) : null}}
                {{it.a.length > 0 ? (
                  <Stack gap={{4}}>
                    <Text weight="semibold" size="small">
                      Avoid
                    </Text>
                    <Row gap={{6}} style={{{{ flexWrap: "wrap" }}}}>
                      {{it.a.map((x) => (
                        <Pill key={{x}} size="sm">
                          {{x}}
                        </Pill>
                      ))}}
                    </Row>
                  </Stack>
                ) : null}}
              </Stack>
            </CardBody>
          </Card>
        ))}}
      </Stack>

      <Spacer height={{24}} />
      <Text tone="tertiary" size="small">
        Source: src/module2/blueprints/ownerGold.pack.json · Markdown:
        .cursor/night100/OWNER_GOLD_69.md
      </Text>
    </Stack>
  );
}}
"""

out = Path(r"C:/Users/larsf/.cursor/projects/c-Users-larsf-Findus-2-0/canvases/owner-gold-69.canvas.tsx")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(canvas, encoding="utf-8")
print("wrote", out, "bytes", out.stat().st_size)
