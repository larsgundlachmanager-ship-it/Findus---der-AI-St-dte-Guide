# Patch ResearchTheater: no drift, plane emoji offset, counter-rotate compare labels
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\components\reisebuero\ResearchTheater.tsx")
t = p.read_text(encoding="utf-8")

# Remove DRIFT_MS constant usage - keep const but disable loop
old_drift = """  const drift = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(pct)).current;
  const completeOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: DRIFT_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: DRIFT_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);
"""

new_drift = """  const bar = useRef(new Animated.Value(pct)).current;
  const completeOpacity = useRef(new Animated.Value(0)).current;
"""

if old_drift not in t:
    raise SystemExit("drift block missing")
t = t.replace(old_drift, new_drift, 1)

old_map = """  const mapScale = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [crop.scale * 1.02, crop.scale * 1.08],
  });
  const mapTX = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [
      (0.5 - crop.anchorX) * width * crop.scale - width * 0.01,
      (0.5 - crop.anchorX) * width * crop.scale + width * 0.01,
    ],
  });
  const mapTY = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [
      (0.5 - crop.anchorY) * height * crop.scale - height * 0.008,
      (0.5 - crop.anchorY) * height * crop.scale + height * 0.008,
    ],
  });
"""

new_map = """  const mapScale = crop.scale;
  const mapTX = (0.5 - crop.anchorX) * width * crop.scale;
  const mapTY = (0.5 - crop.anchorY) * height * crop.scale;
"""

if old_map not in t:
    raise SystemExit("map transform missing")
t = t.replace(old_map, new_map, 1)

# Fix Animated.View map wrap - was Animated with interpolate, now static numbers work with View too
# Keep Animated.View for simplicity - transform with numbers is fine

old_angle = """  const angleDeg = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
"""
new_angle = """  // ✈️ emoji points ~NE; +offset so nose follows the route
  const angleDeg = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI + 45;
"""
if old_angle not in t:
    raise SystemExit("angle missing")
t = t.replace(old_angle, new_angle, 1)

# CompareOrbit: counter-rotate labels
old_node = """            <View
              key={n.id}
              style={[
                styles.compareNode,
                tone,
                {
                  transform: [{ translateX: x }, { translateY: y }, { scale: size }],
                },
              ]}
            >
              <Text style={styles.compareEmoji}>{n.emoji}</Text>
              <Text style={styles.compareLabel} numberOfLines={1}>
                {n.label}
              </Text>
              {n.hint ? (
                <Text style={styles.compareHint} numberOfLines={1}>
                  {n.hint}
                </Text>
              ) : null}
            </View>
"""

new_node = """            <View
              key={n.id}
              style={[
                styles.compareNode,
                tone,
                {
                  transform: [{ translateX: x }, { translateY: y }, { scale: size }],
                },
              ]}
            >
              <Animated.View style={{ transform: [{ rotate: counterRotate }] }}>
                <Text style={styles.compareEmoji}>{n.emoji}</Text>
                <Text style={styles.compareLabel} numberOfLines={1}>
                  {n.label}
                </Text>
                {n.hint ? (
                  <Text style={styles.compareHint} numberOfLines={1}>
                    {n.hint}
                  </Text>
                ) : null}
              </Animated.View>
            </View>
"""

if old_node not in t:
    raise SystemExit("compare node missing")
t = t.replace(old_node, new_node, 1)

# Add counterRotate after rotate interpolate
old_rot = """  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
"""
new_rot = """  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const counterRotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-360deg'],
  });
"""
if old_rot not in t:
    raise SystemExit("rotate missing")
t = t.replace(old_rot, new_rot, 1)

# Hide yellow stage vibe title during non-compare - show only checklist rail + short status
# Change HUD to not show long vibe as yellow "Unterkünfte" - use stage title only when compare
old_hud = """      <View style={styles.hud} pointerEvents="none">
        <Text style={styles.kicker}>{heroStage}</Text>
        <Text style={styles.vibe} numberOfLines={2}>
          {heroTitle}
        </Text>
      </View>

      {!showCompare && scene.pills.length ? (
        <View style={styles.pillRow} pointerEvents="none">
          {scene.pills.map((p) => (
            <View
              key={p.id}
              style={[
                styles.pill,
                p.tone === 'flight' ? styles.pillFlight : null,
                p.tone === 'stay' ? styles.pillStay : null,
              ]}
            >
              <Text
                style={[styles.pillText, p.tone === 'flight' ? styles.pillTextFlight : null]}
                numberOfLines={1}
              >
                {pillCaption(p)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
"""

new_hud = """      <View style={styles.hud} pointerEvents="none">
        <Text style={styles.kicker}>Recherche</Text>
        <Text style={styles.vibe} numberOfLines={2}>
          {showCompare ? 'Jetzt die Pakete gegeneinander…' : heroTitle}
        </Text>
      </View>

      {/* Palette/Pills erst im Vergleich — während Suche nur Checkliste */}
      {showCompare && scene.pills.length ? (
        <View style={styles.pillRow} pointerEvents="none">
          {scene.pills.map((p) => (
            <View
              key={p.id}
              style={[
                styles.pill,
                p.tone === 'flight' ? styles.pillFlight : null,
                p.tone === 'stay' ? styles.pillStay : null,
              ]}
            >
              <Text
                style={[styles.pillText, p.tone === 'flight' ? styles.pillTextFlight : null]}
                numberOfLines={1}
              >
                {pillCaption(p)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
"""

if old_hud not in t:
    raise SystemExit("hud missing")
t = t.replace(old_hud, new_hud, 1)

p.write_text(t, encoding="utf-8")
print("ResearchTheater patched")
