# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
p = ROOT / "src/components/homeMap/NativeHomeMapView.tsx"
t = p.read_text(encoding="utf-8")

old_jsx = """            <View style={styles.navChipWrap} pointerEvents=\"box-none\">
              <View style={styles.navChip} pointerEvents=\"box-none\">
                <Text style={styles.navChipTitle} numberOfLines={2}>
                  {title}
                </Text>
                {pin.chip?.sub ? (
                  <Text style={styles.navChipSub} numberOfLines={2}>
                    {pin.chip.sub}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityLabel=\"Chip schließen\"
                  hitSlop={8}
                  onPress={() =>
                    setDismissedRouteChips((prev) => ({ ...prev, [key]: true }))
                  }
                  style={styles.navChipClose}
                >
                  <Text style={styles.navChipCloseText}>×</Text>
                </Pressable>
              </View>
            </View>"""

new_jsx = """            <View style={styles.navChipWrap} pointerEvents=\"box-none\">
              <View style={styles.navChip} pointerEvents=\"box-none\">
                <View style={styles.navChipBody}>
                  <Text style={styles.navChipTitle} numberOfLines={1}>
                    {title}
                  </Text>
                  {pin.chip?.sub ? (
                    <Text style={styles.navChipSub} numberOfLines={1}>
                      {pin.chip.sub}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityLabel=\"Chip schließen\"
                  hitSlop={8}
                  onPress={() =>
                    setDismissedRouteChips((prev) => ({ ...prev, [key]: true }))
                  }
                  style={styles.navChipClose}
                >
                  <Text style={styles.navChipCloseText}>×</Text>
                </Pressable>
              </View>
            </View>"""

if "navChipBody" in t and "flexDirection: 'row'" in t[t.find("navChip:"):t.find("navChip:")+400]:
    print("jsx/styles already?")
else:
    if old_jsx not in t:
        raise SystemExit("jsx block not found")
    t = t.replace(old_jsx, new_jsx, 1)
    print("jsx OK")

old_styles = """  navChip: {
    maxWidth: 280,
    minWidth: 72,
    backgroundColor: '#0C100E',
    borderColor: 'rgba(255,255,255,0.22)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 12,
    paddingRight: 24,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  navChipWrap: {
    paddingTop: 16,
  },
  navPinMarker: {
    width: 36,
    height: 44,
    resizeMode: 'contain',
  },
  navChipTitle: {
    color: '#F4F1EA',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  navChipSub: {
    color: 'rgba(244,241,234,0.85)',
    fontSize: 11,
    marginTop: 2,
    lineHeight: 14,
  },
  navChipClose: {
    position: 'absolute',
    top: 2,
    right: 4,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navChipCloseText: {
    color: '#F2F5F3',
    fontSize: 14,
    lineHeight: 16,
    opacity: 0.75,
  },
});"""

new_styles = """  // Inhaltshuggend — MarkerView darf den Chip nicht auf volle Breite ziehen.
  navChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: 200,
    backgroundColor: '#0C100E',
    borderColor: 'rgba(255,255,255,0.22)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 4,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  navChipWrap: {
    paddingTop: 14,
    alignItems: 'center',
  },
  navChipBody: {
    flexShrink: 1,
    maxWidth: 160,
    paddingRight: 2,
  },
  navPinMarker: {
    width: 36,
    height: 44,
    resizeMode: 'contain',
  },
  navChipTitle: {
    color: '#F4F1EA',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  navChipSub: {
    color: 'rgba(244,241,234,0.85)',
    fontSize: 11,
    marginTop: 1,
    lineHeight: 14,
  },
  navChipClose: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  navChipCloseText: {
    color: '#F2F5F3',
    fontSize: 14,
    lineHeight: 16,
    opacity: 0.75,
  },
});"""

if old_styles not in t:
    raise SystemExit("styles block not found")
t = t.replace(old_styles, new_styles, 1)
print("styles OK")

tmp = p.with_suffix(".tsx.tmpwrite")
tmp.write_text(t, encoding="utf-8")
os.replace(tmp, p)
print("written")
