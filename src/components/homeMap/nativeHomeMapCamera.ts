/**
 * Kamera-Vertrags-Typen für NativeHomeMapView.
 * followMode + userView — Restore nur bei GPS-Snap in explore.
 */
export type HomeMapFollowMode = 'gps' | 'explore' | 'nav';

export type HomeMapUserView = {
  lat: number;
  lng: number;
  zoom: number;
  heading: number;
};
