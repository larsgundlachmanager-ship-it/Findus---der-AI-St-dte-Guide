/**
 * Kamera-Vertrags-Typen für NativeHomeMapView.
 * Google-Maps-Verfassung: Finger = explore (nie GPS-Snap);
 * Follow nur nach Recenter/reattachFollow. Kamera bleibt wo der User sie lässt.
 */
export type HomeMapFollowMode = 'gps' | 'explore' | 'nav';

export type HomeMapUserView = {
  lat: number;
  lng: number;
  zoom: number;
  heading: number;
};
