# -*- coding: utf-8 -*-
from pathlib import Path
import os
import tempfile
import time

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\walkReassure.ts")
print("exists", p.exists(), "size", p.stat().st_size)
try:
    data = p.read_text(encoding="utf-8")
    print("read ok", len(data))
    print("has transit_bus", "transit_bus" in data)
    print("has bad transit", "transportMode === 'transit'" in data)
except Exception as e:
    print("read fail", type(e), e)

# try write via temp + replace
old = """  if (
    opts.transportMode === 'transit' ||
    opts.transportMode === 'bus' ||
    opts.transportMode === 'train'
  ) {
    return false;
  }"""
new = """  if (
    opts.transportMode === 'transit_bus' ||
    opts.transportMode === 'transit_train'
  ) {
    return false;
  }"""
if old not in data:
    print("OLD NOT FOUND")
else:
    out = data.replace(old, new, 1)
    tmp = p.with_suffix(".ts.tmpwrite")
    try:
        tmp.write_text(out, encoding="utf-8")
        print("tmp write ok", tmp)
        os.replace(tmp, p)
        print("replace ok")
    except Exception as e:
        print("write/replace fail", type(e), e)
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass
