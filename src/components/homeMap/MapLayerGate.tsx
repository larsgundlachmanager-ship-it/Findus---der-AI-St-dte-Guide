import React, { useEffect, useState } from 'react';
import {
  isMapLayerDebugEnabled,
  isMapLayerGroupVisible,
  type MapLayerGroup,
  subscribeMapLayerDebug,
} from '../../services/homeMap/mapLayerDebug';
import { isVectorBasemapEnabled } from '../../services/homeMap/mapTileConfig';

/** Bei Vector-Basemap: keine Legacy-GeoJSON-Welt/Extract (Kamera-Snap). */
const LEGACY_ONLY_GROUPS: MapLayerGroup[] = [
  'extract',
  'regional',
  'world-base',
  'world-labels',
];

type Props = {
  group: MapLayerGroup;
  children: React.ReactNode;
};

export function MapLayerGate({ group, children }: Props) {
  const [, bump] = useState(0);
  useEffect(() => subscribeMapLayerDebug(() => bump((v) => v + 1)), []);
  if (isVectorBasemapEnabled() && LEGACY_ONLY_GROUPS.includes(group)) {
    return null;
  }
  if (isMapLayerDebugEnabled() && !isMapLayerGroupVisible(group)) return null;
  return <>{children}</>;
}
