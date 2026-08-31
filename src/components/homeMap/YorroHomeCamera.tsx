/**
 * MapLibre-Camera mit lebendigem native defaultStop.
 *
 * Stock-Camera friert defaultSettings einmal per useState ein. Wenn die native
 * Camera neu an die Map gehÃ¤ngt wird, springt setInitialCamera auf Boot-GPS.
 *
 * Hier: defaultStop folgt der User-View (setNativeProps + React-Prop), damit
 * Re-Attach unsichtbar bleibt â€” kein GPS-RÃ¼cksprung.
 */

import { featureCollection, point } from '@turf/helpers';
import {
  forwardRef,
  memo,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { HostComponent, ViewProps } from 'react-native';
import '@maplibre/maplibre-react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';

/** MapLibre CameraMode (native). */
const Mode = {
  Flight: 1,
  Ease: 2,
  Linear: 3,
  None: 4,
} as const;

type StopIn = {
  centerCoordinate?: [number, number] | number[];
  zoomLevel?: number;
  heading?: number;
  pitch?: number;
  animationDuration?: number;
  animationMode?: 'flyTo' | 'easeTo' | 'linearTo' | 'moveTo';
  bounds?: {
    ne: number[];
    sw: number[];
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
  };
  padding?: {
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
  };
};

export type YorroHomeCameraRef = CameraRef & {
  /** Native + React defaultStop = aktuelle View (Remount ohne GPS-Snap). */
  syncDefaultStop: (stop: {
    centerCoordinate: [number, number];
    zoomLevel: number;
    heading?: number;
  }) => void;
};

type Props = {
  defaultSettings?: {
    centerCoordinate: [number, number];
    zoomLevel: number;
    heading?: number;
  };
};

function modeOf(m?: StopIn['animationMode']): number {
  switch (m) {
    case 'flyTo':
      return Mode.Flight;
    case 'moveTo':
      return Mode.None;
    case 'linearTo':
      return Mode.Linear;
    case 'easeTo':
      return Mode.Ease;
    default:
      return Mode.None;
  }
}

function makeNativeStop(stop?: StopIn): Record<string, unknown> | undefined {
  if (!stop) return undefined;
  const out: Record<string, unknown> = {};
  if (stop.animationDuration !== undefined) out.duration = stop.animationDuration;
  if (stop.animationMode !== undefined) out.mode = modeOf(stop.animationMode);
  if (stop.centerCoordinate) {
    out.centerCoordinate = JSON.stringify(point(stop.centerCoordinate));
  }
  if (stop.heading !== undefined) out.heading = stop.heading;
  if (stop.pitch !== undefined) out.pitch = stop.pitch;
  if (stop.zoomLevel !== undefined) out.zoom = stop.zoomLevel;
  if (stop.bounds?.ne && stop.bounds?.sw) {
    out.bounds = JSON.stringify(
      featureCollection([point(stop.bounds.ne), point(stop.bounds.sw)]),
    );
  }
  const padTop = stop.padding?.paddingTop ?? stop.bounds?.paddingTop;
  const padRight = stop.padding?.paddingRight ?? stop.bounds?.paddingRight;
  const padBottom = stop.padding?.paddingBottom ?? stop.bounds?.paddingBottom;
  const padLeft = stop.padding?.paddingLeft ?? stop.bounds?.paddingLeft;
  if (padTop !== undefined) out.paddingTop = padTop;
  if (padRight !== undefined) out.paddingRight = padRight;
  if (padBottom !== undefined) out.paddingBottom = padBottom;
  if (padLeft !== undefined) out.paddingLeft = padLeft;
  return out;
}

type NativeProps = ViewProps & {
  defaultStop?: Record<string, unknown>;
  stop?: Record<string, unknown>;
};

// MapLibre's package barrel already registers this via Camera.js.
// A second native-view register for MLRNCamera crashes boot (duplicate view name).\r
// In bridgeless RN the host component identity is the registered name string.
const MLRNCamera = 'MLRNCamera' as unknown as HostComponent<NativeProps>;

export const YorroHomeCamera = memo(
  forwardRef<YorroHomeCameraRef, Props>(function YorroHomeCamera(
    { defaultSettings },
    ref,
  ) {
    const nativeRef = useRef<{ setNativeProps: (p: object) => void } | null>(
      null,
    );
    /**
     * Wichtig: nicht nur useState-Freeze. Bei Native-Remount liest Android den
     * React-Prop defaultStop â€” der muss die aktuelle User-View sein, sonst
     * Boot-GPS-Snap. setNativeProps allein reicht nicht (stirbt mit alter View).
     */
    const [defaultStop, setDefaultStop] = useState(() =>
      makeNativeStop(defaultSettings),
    );
    const lastReactSyncAt = useRef(0);
    const pendingReactStop = useRef<Record<string, unknown> | null>(null);
    const reactSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flushReactDefaultStop = () => {
      reactSyncTimer.current = null;
      const pending = pendingReactStop.current;
      if (!pending) return;
      pendingReactStop.current = null;
      lastReactSyncAt.current = Date.now();
      setDefaultStop(pending);
    };

    const setCamera = (config: StopIn | { stops: StopIn[] } = {}) => {
      if ('stops' in config && Array.isArray(config.stops)) {
        nativeRef.current?.setNativeProps({
          stop: {
            stops: config.stops
              .map((s) => makeNativeStop(s))
              .filter(Boolean),
          },
        });
        return;
      }
      const stop = makeNativeStop(config as StopIn);
      if (stop) nativeRef.current?.setNativeProps({ stop });
    };

    useImperativeHandle(ref, () => ({
      setCamera: setCamera as CameraRef['setCamera'],
      fitBounds(ne, sw, padding, animationDuration) {
        const pad: NonNullable<StopIn['padding']> = {};
        if (Array.isArray(padding)) {
          if (padding.length === 2) {
            pad.paddingTop = padding[0];
            pad.paddingBottom = padding[0];
            pad.paddingLeft = padding[1];
            pad.paddingRight = padding[1];
          } else if (padding.length === 4) {
            pad.paddingTop = padding[0];
            pad.paddingRight = padding[1];
            pad.paddingBottom = padding[2];
            pad.paddingLeft = padding[3];
          }
        } else if (typeof padding === 'number') {
          pad.paddingLeft = padding;
          pad.paddingRight = padding;
          pad.paddingTop = padding;
          pad.paddingBottom = padding;
        }
        setCamera({
          bounds: { ne, sw },
          padding: pad,
          animationDuration,
          animationMode: 'easeTo',
        });
      },
      flyTo(coordinates, animationDuration = 2000) {
        setCamera({
          centerCoordinate: coordinates,
          animationDuration,
          animationMode: 'flyTo',
        });
      },
      moveTo(coordinates, animationDuration = 0) {
        setCamera({
          centerCoordinate: coordinates,
          animationDuration,
          animationMode: 'easeTo',
        });
      },
      zoomTo(zoomLevel, animationDuration = 2000) {
        setCamera({
          zoomLevel,
          animationDuration,
          animationMode: 'flyTo',
        });
      },
      syncDefaultStop(stop) {
        const native = makeNativeStop({
          ...stop,
          animationDuration: 0,
          animationMode: 'moveTo',
        });
        if (!native) return;
        // Sofort auf lebende Native-View â€” Ã¼berlebt Gesten ohne Re-Render.
        nativeRef.current?.setNativeProps({ defaultStop: native });
        // React-Prop nachziehen (Remount liest das) â€” gedrosselt.
        pendingReactStop.current = null;
        if (reactSyncTimer.current) {
          clearTimeout(reactSyncTimer.current);
          reactSyncTimer.current = null;
        }
        lastReactSyncAt.current = Date.now();
        setDefaultStop(native);
      },
    }));

    return (
      <MLRNCamera
        // @ts-expect-error native ref
        ref={nativeRef}
        testID="Camera"
        defaultStop={defaultStop}
      />
    );
  }),
);
