from pathlib import Path
p=Path(r'c:/Users/larsf/Findus 2.0/src/components/homeMap/NativeHomeMapView.tsx')
t=p.read_text(encoding='utf-8')
old='    const applyMapBearing = (bearing: number) => {'+chr(10)+'      const b = ((bearing % 360) + 360) % 360;'+chr(10)+'      displayBearingRef.current = b;'+chr(10)+'      camLiveRef.current = { ...camLiveRef.current, heading: b };'+chr(10)+'      markProgrammaticBearing();'
new='    const applyMapBearing = (bearing: number) => {'+chr(10)+'      const b = ((bearing % 360) + 360) % 360;'+chr(10)+'      displayBearingRef.current = b;'+chr(10)+'      camLiveRef.current = { ...camLiveRef.current, heading: b };'+chr(10)+'      // While moving: throttle setCamera heading (JS-thread bike starvation).'+chr(10)+'      try {'+chr(10)+'        const { getSmoothedSpeedMs } = require(\'../../services/navigation/transportMode\') as {'+chr(10)+'          getSmoothedSpeedMs: () => number;'+chr(10)+'        };'+chr(10)+'        const speed = getSmoothedSpeedMs();'+chr(10)+'        if (typeof speed === \'number\' && speed >= MOVING_SPEED_MS) {'+chr(10)+'          const nowH = Date.now();'+chr(10)+'          if ('+chr(10)+'            lastMovingHeadingCamAt.current > 0 &&'+chr(10)+'            nowH - lastMovingHeadingCamAt.current < MOVING_HEADING_CAM_MIN_MS'+chr(10)+'          ) {'+chr(10)+'            postBearingUi(b);'+chr(10)+'            return;'+chr(10)+'          }'+chr(10)+'          lastMovingHeadingCamAt.current = nowH;'+chr(10)+'        }'+chr(10)+'      } catch {'+chr(10)+'        /* soft */'+chr(10)+'      }'+chr(10)+'      markProgrammaticBearing();'
assert old in t, 'applyMapBearing missing'
t=t.replace(old,new,1)
tmp=p.with_suffix('.tsx.tmp')
tmp.write_text(t,encoding='utf-8')
tmp.replace(p)
print('applyMapBearing OK')
