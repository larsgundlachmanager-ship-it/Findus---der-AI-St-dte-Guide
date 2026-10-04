from pathlib import Path
p=Path(r'c:/Users/larsf/Findus 2.0/src/components/homeMap/NativeHomeMapView.tsx')
t=p.read_text(encoding='utf-8')
old='    /** Follow-Throttle: kein setCamera-Sturm bei jedem GPS-Tick. */'+chr(10)+'    const lastFollowCamAt = useRef(0);'+chr(10)+'    const lastFollowPos = useRef({ lat: 0, lng: 0 });'
new=old+chr(10)+'    /** Moving: heading setCamera throttle. */'+chr(10)+'    const lastMovingHeadingCamAt = useRef(0);'+chr(10)+'    const MOVING_HEADING_CAM_MIN_MS = 150;'+chr(10)+'    const MOVING_SPEED_MS = 2;'
assert old in t, 'follow missing'
t=t.replace(old,new,1)
tmp=p.with_suffix('.tsx.tmp')
tmp.write_text(t,encoding='utf-8')
tmp.replace(p)
print('follow refs OK')
