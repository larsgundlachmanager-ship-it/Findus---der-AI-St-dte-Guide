from pathlib import Path
import os, tempfile

def replace(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"FAIL {label}: needle not found in {path}")
    if text.count(old) != 1:
        raise SystemExit(f"FAIL {label}: expected 1 hit, got {text.count(old)}")
    text = text.replace(old, new)
    fd, tmp = tempfile.mkstemp(suffix=".tmp", dir=str(p.parent))
    os.close(fd)
    Path(tmp).write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)
    print("OK", label)

# --- NativeHomeMapView: gesture-only freeze + no camera snap on fog while exploring ---
replace(
    r"src/components/homeMap/NativeHomeMapView.tsx",
    """    /** Fog nach erstem Paint bei freier Erkundung einfrieren — ShapeSource-Churn = Prisdorf-Snap. */
    const fogRevealFrozenRef = useRef<GeoJsonFc>(EMPTY_FC);
    const fogMaskFrozenRef = useRef<GeoJsonFc>(EMPTY_FC);

    const fogFc = useMemo(() => {
      if (
        !fogLayersWanted ||
        !HOME_MAP_FOG_MASK_ENABLED ||
        !mapCoreReady ||
        !viewBounds
      ) {
        return EMPTY_FC;
      }
      const exploring = userHasExploredRef.current;
      if (
        exploring &&
        (fogMaskFrozenRef.current.features?.length ?? 0) > 0
      ) {
        return fogMaskFrozenRef.current;
      }
      // 0 % erkundet: volle Viewport-Maske (Fog sichtbar, nicht erst nach erster Spur).
      const mask = fogMaskFromExplored(viewBounds, exploredFromStore);
      const next = sanitizePolygonFc(fogPolygonsToGeoJSON(mask));
      if (exploring) fogMaskFrozenRef.current = next;
      return next;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapCoreReady, fogStoreTrackKey, fogViewKey, exploredFromStore.length]);

    const revealFc = useMemo(() => {
      if (!fogLayersWanted || !mapCoreReady) return EMPTY_FC;
      // Nur Store (idle forceFogRecompute). Sync-Fallback aus walkTrack =
      // Doppel-Fog + Sekunden Freeze + Kamera-Snap auf Boot-GPS.
      if (exploredFromStore.length === 0) return EMPTY_FC;
      const exploring = userHasExploredRef.current;
      if (
        exploring &&
        (fogRevealFrozenRef.current.features?.length ?? 0) > 0
      ) {
        return fogRevealFrozenRef.current;
      }
      const next = sanitizePolygonFc(fogPolygonsToGeoJSON(exploredFromStore));
      if (exploring) fogRevealFrozenRef.current = next;
      return next;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapCoreReady, fogStoreTrackKey, exploredFromStore.length]);
""",
    """    /**
     * Fog-Snapshot nur während Finger/Geste — sonst live aus Store nachziehen.
     * Früher: nach erstem Pan dauerhaft eingefroren → Spur blieb tot (Video).
     * Follow an: Freeze leeren, damit Reveal/Maske sofort nachziehen.
     */
    const fogRevealFrozenRef = useRef<GeoJsonFc>(EMPTY_FC);
    const fogMaskFrozenRef = useRef<GeoJsonFc>(EMPTY_FC);

    useEffect(() => {
      if (!props.locationFollow) return;
      fogRevealFrozenRef.current = EMPTY_FC;
      fogMaskFrozenRef.current = EMPTY_FC;
    }, [props.locationFollow]);

    const fogFc = useMemo(() => {
      if (
        !fogLayersWanted ||
        !HOME_MAP_FOG_MASK_ENABLED ||
        !mapCoreReady ||
        !viewBounds
      ) {
        return EMPTY_FC;
      }
      const midGesture = fingerDown.current || userGesturing.current;
      if (
        midGesture &&
        (fogMaskFrozenRef.current.features?.length ?? 0) > 0
      ) {
        return fogMaskFrozenRef.current;
      }
      // 0 % erkundet: volle Viewport-Maske (Fog sichtbar, nicht erst nach erster Spur).
      const mask = fogMaskFromExplored(viewBounds, exploredFromStore);
      const next = sanitizePolygonFc(fogPolygonsToGeoJSON(mask));
      fogMaskFrozenRef.current = next;
      return next;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      mapCoreReady,
      fogStoreTrackKey,
      fogViewKey,
      exploredFromStore.length,
      props.locationFollow,
    ]);

    const revealFc = useMemo(() => {
      if (!fogLayersWanted || !mapCoreReady) return EMPTY_FC;
      // Nur Store (idle forceFogRecompute). Sync-Fallback aus walkTrack =
      // Doppel-Fog + Sekunden Freeze + Kamera-Snap auf Boot-GPS.
      if (exploredFromStore.length === 0) return EMPTY_FC;
      const midGesture = fingerDown.current || userGesturing.current;
      if (
        midGesture &&
        (fogRevealFrozenRef.current.features?.length ?? 0) > 0
      ) {
        return fogRevealFrozenRef.current;
      }
      const next = sanitizePolygonFc(fogPolygonsToGeoJSON(exploredFromStore));
      fogRevealFrozenRef.current = next;
      return next;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      mapCoreReady,
      fogStoreTrackKey,
      exploredFromStore.length,
      props.locationFollow,
    ]);
""",
    "native fog freeze",
)

replace(
    r"src/components/homeMap/NativeHomeMapView.tsx",
    """    useEffect(() => {
      if (exploredFromStore.length === 0) return;
      // Follow-Lock: Fog darf Kamera nicht mit setCamera nachziehen (Session-Last).
      if (gpsLockCenterRef.current || locationFollowRef.current) return;
      const t = setTimeout(reassertUserCamera, 0);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fogStoreTrackKey, exploredFromStore.length]);
""",
    """    useEffect(() => {
      if (exploredFromStore.length === 0) return;
      // Follow-Lock: Fog darf Kamera nicht mit setCamera nachziehen (Session-Last).
      if (gpsLockCenterRef.current || locationFollowRef.current) return;
      // Freie Erkundung: User besitzt die Kamera — Fog-Nachzug ohne Snap.
      if (userHasExploredRef.current || userDetached.current) return;
      const t = setTimeout(reassertUserCamera, 0);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fogStoreTrackKey, exploredFromStore.length]);
""",
    "native fog no snap",
)

print("NativeHomeMapView patched")
