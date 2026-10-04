from pathlib import Path
p = Path(r"C:\Users\larsf\Findus 2.0\App.tsx")
t = p.read_text(encoding="utf-8")
old = """  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <View style={styles.root}>
          {content}
          {!splashDone ? (
            <View style={styles.splashOverlay} pointerEvents="box-none">
              <SplashScreenController
                onFinish={handleSplashFinish}
                priorityVoiceId={bootVoiceId}
              />
            </View>
          ) : null}
          {/* Overlays im selben Root — kein RN-Modal (Android-Fragmente) */}
          <LocationProminentDisclosureHost />
          <CitySwitchPromptHost />
        </View>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}"""
new = """  // Splash weg + Boot noch nicht ready → kein leerer Dunkel-Root (wirkt wie Blackscreen).
  const showBootFallback = splashDone && !content && phase !== 'error';

  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <View style={styles.root}>
          {content}
          {showBootFallback ? (
            <View style={styles.bootFallback} pointerEvents="none">
              <Text style={styles.errorTitle}>Yorro startet…</Text>
              <Text style={styles.errorText}>Einen Moment noch.</Text>
              <StatusBar style="light" />
            </View>
          ) : null}
          {!splashDone ? (
            <View style={styles.splashOverlay} pointerEvents="box-none">
              <SplashScreenController
                onFinish={handleSplashFinish}
                priorityVoiceId={bootVoiceId}
              />
            </View>
          ) : null}
          {/* Overlays im selben Root — kein RN-Modal (Android-Fragmente) */}
          <LocationProminentDisclosureHost />
          <CitySwitchPromptHost />
        </View>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}"""
if old not in t:
    raise SystemExit("App block not found")
tmp = p.with_suffix(".tsx.new")
tmp.write_text(t.replace(old, new, 1), encoding="utf-8", newline="\n")
tmp.replace(p)
print("App.tsx boot fallback ok")
