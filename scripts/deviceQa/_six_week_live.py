#!/usr/bin/env python3
"""
6-Wochen Live-QA via Ask-Server (:8791) + Spickzettel-Poll + Button-Taps + Screenshots.
Night100 + Founder-Must + Voice-Feedback → .cursor/live6w/
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "live6w"
ASK_PORT = 8791


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


tw = _load("tw", ROOT / "scripts" / "deviceQa" / "_three_week_marathon.py")
qa = _load("qa", ROOT / "scripts" / "deviceQa" / "_qa40_live.py")
n100 = _load("n100", ROOT / "scripts" / "deviceQa" / "_night100_bank.py")
founder = _load("founder", ROOT / "scripts" / "deviceQa" / "_founder_must_bank.py")
voice = _load("voice", ROOT / "scripts" / "deviceQa" / "_six_week_bank.py")

tw.OUT = OUT
tw.XML = OUT / "ui.xml"
qa.OUT = OUT
qa.EXTRACT = ROOT / ".cursor" / "extract_ui.py"


def merge_scenarios() -> list[dict]:
    by_id: dict[str, dict] = {}
    order: list[str] = []
    for src in (voice.VOICE_FEEDBACK_SCENARIOS, founder.SCENARIOS, n100.SCENARIOS):
        for s in src:
            sid = s["id"]
            if sid not in by_id:
                by_id[sid] = dict(s)
                order.append(sid)
            else:
                for k, v in s.items():
                    if k not in by_id[sid]:
                        by_id[sid][k] = v
    return [by_id[i] for i in order]


SCENARIOS = merge_scenarios()


def tap_action_buttons(tag: str, patterns: list[str] | None) -> list[str]:
    tapped: list[str] = []
    pats = patterns or [
        r"speisekarte",
        r"website",
        r"maps",
        r"route starten",
        r"navigation starten",
        r"ticket",
        r"programm",
    ]
    xml = tw.dump()
    nodes = list(tw.nodes(xml))
    for pat in pats:
        hit = None
        for n in nodes:
            if not n.get("click"):
                continue
            blob = f"{n.get('text','')} {n.get('desc','')}".strip()
            if not blob or len(blob) > 48:
                continue
            # never tap map chrome / dismiss
            if re.search(
                r"karte schlie|schlie(?:ss|ß)en|zentrier|position|einst|"
                r"timeline|bibliothek|orte\b|kompass|mikrofon|abbrechen",
                blob,
                re.I,
            ):
                continue
            if re.search(pat, blob, re.I):
                hit = n
                break
        if not hit:
            continue
        label = (hit.get("text") or hit.get("desc") or pat)[:40]
        tw.tap(hit["cx"], hit["cy"], 0.8)
        time.sleep(1.2)
        safe = re.sub(r"[^\w\-]+", "_", label)[:28]
        tw.shot(f"{tag}-tap-{safe}")
        tapped.append(label)
        tw.adb("shell", "input", "keyevent", "4")
        time.sleep(0.7)
        tw.adb(
            "shell",
            "monkey",
            "-p",
            "de.findus.app",
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        )
        time.sleep(1.8)
        xml = tw.dump()
        nodes = list(tw.nodes(xml))
        if len(tapped) >= 2:
            break
    return tapped


def grab_logs(tag: str) -> str:
    r = tw.adb("logcat", "-d", "-t", "500")
    path = OUT / f"{tag}-log.txt"
    raw = r.stdout or ""
    path.write_text(raw, encoding="utf-8", errors="ignore")
    hits = []
    for ln in raw.splitlines():
        if "ReactNativeJS" not in ln and "Expo" not in ln:
            continue
        if any(
            k in ln
            for k in (
                "[call1]",
                "call2",
                "Call2",
                "ayce",
                "pitch",
                "ERROR",
                "TypeError",
                "devAskPoller",
                "got ask",
                "Dubrovnik",
                "Goldsch",
                "hardMatch",
            )
        ):
            hits.append(ln)
    return "\n".join(hits[-60:])


def card_quality(xml: str) -> int:
    """Higher = better Spickzettel capture (keep best mid-poll dump)."""
    blob = tw._ui_blob(xml).lower()
    score = 0
    if re.search(r"frage an yorro|schreib deine frage", blob):
        return 0
    if "•" in blob or "• " in blob:
        score += 3
    if re.search(r"speisekarte|website|maps|route starten|navigation starten", blob):
        score += 3
    if re.search(r"essen in |alternativen|spickzettel", blob):
        score += 4
    if re.search(r"aktionen schlie|navigation zum restaurant|navigation zum ", blob):
        score += 2
    if re.search(r"buffet|all.?you.?can|ayce|flatrate|schlemmer", blob):
        score += 3
    if "goldschätzchen" in blob or "goldschaetzchen" in blob:
        score -= 2
    return score


def ask_server_capture(tag: str, text: str, wait_s: float) -> str:
    """Queue via askServer; keep best Spickzettel dump during poll."""
    tw.dismiss()
    time.sleep(0.3)
    ensure_reverse()
    try:
        resp = post_ask(text)
        print("queued", tag, (resp or "")[:80], flush=True)
    except Exception as e:
        print("ASK_FAIL", tag, e, flush=True)
        return f"ASK_FAIL:{e}"

    deadline = time.time() + max(25.0, float(wait_s))
    best_xml = tw.dump()
    best_q = card_quality(best_xml)
    mid_at = {15, 35, 55}
    started = time.time()
    while time.time() < deadline:
        xml = tw.dump()
        q = card_quality(xml)
        if q > best_q:
            best_q = q
            best_xml = xml
            tw.shot(f"{tag}-best")
            print(f"card_q={q}", tag, flush=True)
        elapsed = int(time.time() - started)
        if elapsed in mid_at:
            mid_at.discard(elapsed)
            tw.shot(f"{tag}-t{elapsed}")
        # Good enough: pitch title + bullets or action buttons
        if best_q >= 6 or tw.looks_like_spickzettel(xml):
            time.sleep(1.5)
            xml2 = tw.dump()
            q2 = card_quality(xml2)
            if q2 >= best_q:
                best_xml = xml2
                best_q = q2
            break
        time.sleep(1.0)
    if best_q < 4:
        print("NO_CARD_YET", tag, f"q={best_q}", flush=True)
    tw.shot(tag)
    return tw.extract(tag, best_xml)


def parse_args(argv: list[str]):
    only = None
    from_id = None
    batch = None
    size = 12
    args = []
    i = 0
    while i < len(argv):
        if argv[i] == "--from" and i + 1 < len(argv):
            from_id = argv[i + 1]
            i += 2
            continue
        if argv[i] == "--batch" and i + 1 < len(argv):
            batch = int(argv[i + 1])
            i += 2
            continue
        if argv[i] == "--size" and i + 1 < len(argv):
            size = int(argv[i + 1])
            i += 2
            continue
        args.append(argv[i])
        i += 1
    if args:
        only = set(args)
    return only, from_id, batch, size


def scrub_ui_for_score(txt: str) -> str:
    """Drop map chrome / always-on place pins so Prisdorf POIs don't false-fail."""
    lines = []
    for ln in (txt or "").splitlines():
        low = ln.lower().strip()
        if not low:
            continue
        if low.startswith("showing a map") or "maplibre" in low:
            continue
        if low.startswith("auf meine position") or low.startswith("norden oben"):
            continue
        if low in ("kompass kalibrieren", "karte schließen", "aktionen schließen"):
            continue
        if low.startswith("live-anzeige") or "timeline · orte" in low:
            continue
        # Bare map pin without Spickzettel context
        if low.startswith("📍") and "essen" not in low and "•" not in low:
            continue
        lines.append(ln)
    return "\n".join(lines)


def ask_health() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{ASK_PORT}/health", timeout=3) as res:
            return res.status == 200
    except Exception:
        return False


def post_ask(q: str) -> str:
    body = json.dumps({"ask": q}).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{ASK_PORT}/ask",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=8) as res:
        return res.read().decode("utf-8", errors="ignore")


def ensure_reverse() -> None:
    tw.adb("reverse", f"tcp:{ASK_PORT}", f"tcp:{ASK_PORT}")
    tw.adb("reverse", "tcp:8081", "tcp:8081")


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    OUT.mkdir(parents=True, exist_ok=True)
    only, from_id, batch, size = parse_args(sys.argv[1:])

    if not ask_health():
        print(
            "ERROR: askServer not on :8791 — start: node scripts/deviceQa/askServer.mjs",
            flush=True,
        )
        return 2

    ensure_reverse()

    scenarios = list(SCENARIOS)
    if batch is not None:
        start = batch * size
        scenarios = scenarios[start : start + size]
        print(f"BATCH {batch} size={len(scenarios)} start={start}", flush=True)

    report = {
        "at": datetime.now(timezone.utc).isoformat(),
        "device": tw.adb("get-serialno").stdout.strip(),
        "label": "six_week_ask_server",
        "n": len(scenarios),
        "results": [],
    }
    print(f"TOTAL_MERGED={len(SCENARIOS)} RUNNING={len(scenarios)}", flush=True)

    started = from_id is None
    for s in scenarios:
        if only and s["id"] not in only:
            continue
        if from_id and not started:
            if s["id"] == from_id:
                started = True
            else:
                continue

        print(f"\n=== {s['id']} ===", flush=True)
        print("Q:", s["q"], flush=True)
        is_fu = ("_fu_" in s["id"]) or s["id"].endswith("_fu") or s.get("chain")
        if s.get("reset_before") or not is_fu:
            tw.reset_app()
            ensure_reverse()
            # Poller startet nach Boot — auf Log warten
            ready = False
            for _ in range(40):
                lr = tw.adb("logcat", "-d", "-t", "80")
                if "[devAskPoller] started" in (lr.stdout or ""):
                    ready = True
                    break
                time.sleep(0.8)
            if not ready:
                print("WARN poller_not_seen", flush=True)
                time.sleep(5.0)
            else:
                time.sleep(1.5)
        else:
            tw.dismiss()
            time.sleep(0.8)

        tw.adb("logcat", "-c")
        wait = max(float(s.get("wait") or 45), 50.0)
        if s.get("family") in ("dining_ayce", "dining_specialty", "activity_expand"):
            wait = max(wait, 75.0)
        txt = ask_server_capture(s["id"], s["q"], wait)
        if not txt or len(txt.strip()) < 40 or str(txt).startswith("ASK_FAIL"):
            time.sleep(8)
            tw.shot(f"{s['id']}-retry")
            txt2 = tw.extract(f"{s['id']}-retry", tw.dump())
            if len((txt2 or "").strip()) > len((txt or "").strip()):
                txt = txt2

        logs = grab_logs(s["id"])
        tapped: list[str] = []
        if txt and len(txt.strip()) >= 40 and not str(txt).startswith("ASK_FAIL"):
            try:
                tapped = tap_action_buttons(s["id"], s.get("tap_btns"))
            except Exception as e:
                print("TAP_ERR", e, flush=True)

        if not txt or str(txt).startswith("ASK_FAIL") or len(txt.strip()) < 40:
            row = {
                "id": s["id"],
                "q": s["q"],
                "family": s.get("family"),
                "verdict": "FAIL",
                "error": "NO_CAPTURE" if not txt else "ASK_FAIL",
                "fails": ["no_capture"],
                "snippet": (txt or "")[:220],
                "tapped": tapped,
                "log_hits": logs[:400],
            }
        elif not re.search(
            r"(spickzettel|aktionen schlie|^\s*•\s|essen in |alternativen|"
            r"speisekarte|route starten|navigation starten|"
            r"programm|ticket|cineplex|stay\.com|maps öffnen|anrufen|"
            r"wecker|gestellt|restaurant|ayce|buffet|dinosaur|museum|"
            r"taxi|uber|croque|all.?you.?can|hotel für|unterkunft)",
            scrub_ui_for_score(txt),
            re.I | re.M,
        ):
            row = {
                "id": s["id"],
                "q": s["q"],
                "family": s.get("family"),
                "verdict": "FAIL",
                "error": "NO_SPICKZETTEL",
                "fails": ["no_spickzettel"],
                "snippet": txt[:220],
                "tapped": tapped,
                "log_hits": logs[:400],
            }
        else:
            sc = qa.score(scrub_ui_for_score(txt), s.get("checks") or {})
            fails = list(sc.get("fails") or [])
            low = scrub_ui_for_score(txt).lower()
            if re.search(
                r"in\s+\d+\s*km\s+nichts|online erweitert|soll ich weiter suchen|ringweise",
                low,
            ):
                fails.append("search_process_meta")
                sc["verdict"] = "FAIL"
            row = {
                "id": s["id"],
                "q": s["q"],
                "family": s.get("family"),
                "verdict": sc["verdict"],
                "bridge_ok": sc.get("bridge_ok"),
                "call2_ok": sc.get("call2_ok"),
                "bullets_ok": sc.get("bullets_ok"),
                "buttons_ok": sc.get("buttons_ok"),
                "buttons_found": sc.get("buttons_found"),
                "fails": fails,
                "snippet": sc.get("snippet"),
                "tapped": tapped,
                "log_hits": logs[:500],
            }

        report["results"].append(row)
        print(
            row["verdict"],
            row.get("fails"),
            "tapped=",
            tapped,
            (row.get("snippet") or "")[:160],
            flush=True,
        )
        (OUT / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    failed = [r for r in report["results"] if r["verdict"] != "PASS"]
    summary = {
        "pass": sum(1 for r in report["results"] if r["verdict"] == "PASS"),
        "fail": len(failed),
        "failed_ids": [r["id"] for r in failed],
        "at": report["at"],
        "n": len(report["results"]),
    }
    report["summary"] = summary
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    md = [
        f"# 6-Wochen Live-QA (Tippfeld) — {report['at'][:19]}Z",
        "",
        f"**Pass:** {summary['pass']}/{summary['n']} · **Fail:** {summary['fail']}",
        "",
        "| ID | Family | Verdict | Fails | Tapped |",
        "|---|---|---|---|---|",
    ]
    for r in report["results"]:
        md.append(
            f"| `{r['id']}` | {r.get('family')} | **{r['verdict']}** | "
            f"{', '.join(r.get('fails') or []) or '—'} | "
            f"{', '.join(r.get('tapped') or []) or '—'} |"
        )
    (OUT / "report.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\nSUMMARY", summary, flush=True)
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
