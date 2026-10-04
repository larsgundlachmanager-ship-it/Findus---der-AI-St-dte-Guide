from pathlib import Path
import os

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\weather\rainWarnSessionGate.ts")
text = p.read_text(encoding="utf-8")
if "import AsyncStorage from" not in text:
    print("no hard import")
else:
    text = text.replace(
        "import AsyncStorage from '@react-native-async-storage/async-storage';\n\n",
        "",
    )
    helper = '''
type AsyncStorageLike = {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
};

function getAsyncStorage(): AsyncStorageLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-async-storage/async-storage').default;
  } catch {
    return null;
  }
}

'''
    text = text.replace(
        "let hydrateStarted = false;\n\nfunction scheduleHydrate",
        "let hydrateStarted = false;\n" + helper + "\nfunction scheduleHydrate",
        1,
    )
    text = text.replace(
        "hydrateStarted = true;\n  void AsyncStorage.getItem(STORAGE_KEY)",
        "hydrateStarted = true;\n  const AsyncStorage = getAsyncStorage();\n  if (!AsyncStorage) return;\n  void AsyncStorage.getItem(STORAGE_KEY)",
        1,
    )
    text = text.replace(
        "function persist(): void {\n  void AsyncStorage.setItem(",
        "function persist(): void {\n  const AsyncStorage = getAsyncStorage();\n  if (!AsyncStorage) return;\n  void AsyncStorage.setItem(",
        1,
    )
    tmp = p.with_suffix(".ts.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, p)
    print("soft async ok")
