#!/usr/bin/env python3
import re, subprocess, time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
S = "00143157P001105"
PKG = "de.findus.app"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\phase76_nothing")

def adb(*a):
    return subprocess.run([ADB,"-s",S,*a], capture_output=True, text=True, encoding="utf-8", errors="replace")

def dump():
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell","uiautomator","dump","/sdcard/Download/ui.xml")
    adb("pull","/sdcard/Download/ui.xml", str(OUT/"ui.xml"))
    return (OUT/"ui.xml").read_text(encoding="utf-8", errors="ignore")

def shot(t):
    data=subprocess.check_output([ADB,"-s",S,"exec-out","screencap","-p"])
    (OUT/f"{t}.png").write_bytes(data)
    print("shot", t, flush=True)

def nodes(xml):
    for n in re.findall(r"<node\b[^>]*>", xml):
        text=re.search(r'\btext="([^"]*)"', n)
        desc=re.search(r'\bcontent-desc="([^"]*)"', n)
        bounds=re.search(r'\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not bounds: continue
        x1,y1,x2,y2=map(int,bounds.groups())
        yield {"text":text.group(1) if text else "","desc":desc.group(1) if desc else "","cx":(x1+x2)//2,"cy":(y1+y2)//2,"click":'clickable="true"' in n}

def blob(xml):
    return "\n".join(x for n in nodes(xml) for x in (n["text"],n["desc"]) if x.strip())

adb("shell","am","force-stop",PKG)
time.sleep(2)
adb("shell","am","start","-n",f"{PKG}/.MainActivity")
time.sleep(6)
# deeplink twice
for i in range(2):
    adb("shell","am","start","-a","android.intent.action.VIEW","-d","findus://reisebuero",PKG)
    time.sleep(3)
xml=dump(); shot("probe_rb")
print("---BLOB---")
print(blob(xml)[:800])
print("---CLICKABLES---")
for n in nodes(xml):
    if n["click"] and (n["text"] or n["desc"]):
        t=f"{n['text']}|{n['desc']}"
        if len(t)<80:
            print(f"  {n['cx']},{n['cy']} {t}")
