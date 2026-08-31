from pathlib import Path
tl_path = Path("src/services/flights/flightTimeline.ts")
tl = tl_path.read_text(encoding="utf-8")

# In writeFlightAccessChoiceChips, after building taxiopt / oepnvopt, set choiceSide when both are written (omit is null)
# Safer: always set choiceSide on wish chips so UI can pair them
old_taxi = """      id: `${opts.prefix}taxiopt`,
      title: `Taxi · Los ${clock(opts.taxiLeaveMs)}`,
      plannedStartMs: opts.taxiLeaveMs,
      plannedEndMs: opts.taxiLeaveMs + 12 * 60_000,
      kind: 'wish',
      transport: 'taxi',
      hardAnchor: false,
      userFixedTime: false,
      planPriority: 3,"""

new_taxi = """      id: `${opts.prefix}taxiopt`,
      title: `Taxi · Los ${clock(opts.taxiLeaveMs)}`,
      plannedStartMs: opts.taxiLeaveMs,
      plannedEndMs: opts.taxiLeaveMs + 12 * 60_000,
      kind: 'wish',
      transport: 'taxi',
      hardAnchor: false,
      userFixedTime: false,
      planPriority: 3,
      choiceSide: 'left' as const,
      choiceGroupId: opts.groupId,"""

old_oepnv = """      id: `${opts.prefix}oepnvopt`,
      title: `ÖPNV · Los ${clock(opts.transitLeaveMs)}`,
      plannedStartMs: opts.transitLeaveMs,
      plannedEndMs: opts.transitLeaveMs + 12 * 60_000,
      kind: 'wish',
      transport: 'transit',
      hardAnchor: false,
      userFixedTime: false,
      planPriority: 3,"""

new_oepnv = """      id: `${opts.prefix}oepnvopt`,
      title: `ÖPNV · Los ${clock(opts.transitLeaveMs)}`,
      plannedStartMs: opts.transitLeaveMs,
      plannedEndMs: opts.transitLeaveMs + 12 * 60_000,
      kind: 'wish',
      transport: 'transit',
      hardAnchor: false,
      userFixedTime: false,
      planPriority: 3,
      choiceSide: 'right' as const,
      choiceGroupId: opts.groupId,"""

# Only apply if exact match and not already patched
if "choiceSide: 'left'" in tl[tl.find("function writeFlightAccessChoiceChips"):tl.find("function writeFlightAccessChoiceChips")+2500]:
    print("choiceSide already present")
elif old_taxi in tl and old_oepnv in tl:
    tl = tl.replace(old_taxi, new_taxi, 1).replace(old_oepnv, new_oepnv, 1)
    tl_path.write_text(tl, encoding="utf-8")
    print("choiceSide patched")
else:
    # diagnose
    i = tl.find("taxiopt")
    print("taxiopt block:")
    print(repr(tl[i:i+350]))
    print("SKIP choiceSide — structure differs")

# cleanup temp scripts
for p in Path(".cursor").glob("_patch*") :
    try: p.unlink()
    except: pass
for p in Path(".cursor").glob("_verify*") :
    try: p.unlink()
    except: pass
for p in Path(".cursor").glob("_assert*") :
    try: p.unlink()
    except: pass
print("cleanup done")
