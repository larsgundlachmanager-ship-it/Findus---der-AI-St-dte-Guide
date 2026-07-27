package expo.modules.findusespeak

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

class FindusEspeakModule : Module() {
  private var ready = false
  private var currentVoice = "de"

  companion object {
    init {
      // Offizielle espeak-ng Android-Lib (aus APK extrahiert)
      System.loadLibrary("ttsespeak")
      System.loadLibrary("findus_espeak")
    }

    @JvmStatic external fun nativeInit(dataPath: String, voice: String): Boolean
    @JvmStatic external fun nativeIsReady(): Boolean
    @JvmStatic external fun nativeTextToPhonemes(text: String, voice: String): String
    @JvmStatic external fun nativeGetVoice(): String
  }

  override fun definition() = ModuleDefinition {
    Name("FindusEspeak")

    AsyncFunction("initialize") { dataPath: String, voice: String? ->
      val v = voice ?: "de"
      val path = ensureDataPath(dataPath)
      val ok = nativeInit(path, v)
      ready = ok
      if (ok) currentVoice = v
      ok
    }

    Function("isReady") {
      ready && nativeIsReady()
    }

    AsyncFunction("textToPhonemes") { text: String, voice: String? ->
      if (!ready && !nativeIsReady()) {
        throw Exception("espeak-ng nicht initialisiert — initialize() zuerst aufrufen")
      }
      val v = voice ?: currentVoice
      nativeTextToPhonemes(text, v)
    }

    Function("getVoice") {
      if (nativeIsReady()) nativeGetVoice() else currentVoice
    }

    /**
     * Kopiert eine Datei aus APK-assets/ nach filesDir (zuverlässiger als
     * expo-file-system copyAsync von file:///android_asset/…).
     * assetRelPath z.B. "kokoro/kokoro-martin.onnx" oder "kokoro/voices/de_eva.bin"
     * destAbsPath: absoluter Zielpfad unter filesDir.
     * Gibt die Byte-Größe zurück, oder -1 bei Fehler.
     */
    AsyncFunction("copyAssetFile") { assetRelPath: String, destAbsPath: String ->
      val ctx = appContext.reactContext ?: throw Exception("Kein React Context")
      val clean = assetRelPath.trim().trimStart('/')
      // file:// URI absichern (falls JS den Prefix durchreicht)
      val destPath = destAbsPath
        .trim()
        .removePrefix("file://")
      val dest = File(destPath)
      dest.parentFile?.mkdirs()
      try {
        ctx.assets.open(clean).use { input ->
          FileOutputStream(dest).use { output -> input.copyTo(output, 1024 * 256) }
        }
        if (!dest.exists() || dest.length() < 1000L) {
          android.util.Log.e("FindusEspeak", "copyAssetFile zu klein: $clean → $destPath")
          dest.delete()
          return@AsyncFunction -1L
        }
        android.util.Log.i("FindusEspeak", "copyAssetFile OK: $clean (${dest.length()} B)")
        dest.length()
      } catch (e: Exception) {
        android.util.Log.e("FindusEspeak", "copyAssetFile FAIL: $clean → $destPath", e)
        dest.delete()
        -1L
      }
    }

    /** true wenn Asset in der APK existiert und > minBytes groß ist. */
    AsyncFunction("assetFileSize") { assetRelPath: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction -1L
      val clean = assetRelPath.trim().trimStart('/')
      try {
        ctx.assets.openFd(clean).use { fd ->
          fd.length
        }
      } catch (_: Exception) {
        // Komprimierte Assets haben kein openFd — open + skip
        try {
          ctx.assets.open(clean).use { input ->
            var total = 0L
            val buf = ByteArray(64 * 1024)
            while (true) {
              val n = input.read(buf)
              if (n <= 0) break
              total += n
            }
            total
          }
        } catch (_: Exception) {
          -1L
        }
      }
    }
  }

  /**
   * dataPath kann:
   * - absoluter Pfad zu einem Ordner der `espeak-ng-data` enthält, oder
   * - direkt der `espeak-ng-data`-Ordner sein.
   * Assets werden bei Bedarf nach filesDir extrahiert.
   */
  private fun ensureDataPath(requested: String): String {
    val ctx = appContext.reactContext ?: throw Exception("Kein React Context")
    val asFile = File(requested)
    if (asFile.isDirectory) {
      // Parent of espeak-ng-data OR the data dir itself
      val nested = File(asFile, "espeak-ng-data")
      if (nested.isDirectory) return asFile.absolutePath
      if (asFile.name == "espeak-ng-data") return asFile.parentFile?.absolutePath
        ?: asFile.absolutePath
      if (File(asFile, "phontab").exists() || File(asFile, "de_dict").exists()) {
        return asFile.parentFile?.absolutePath ?: asFile.absolutePath
      }
      return asFile.absolutePath
    }

    // Asset-Name: nach filesDir kopieren
    val destRoot = File(ctx.filesDir, "espeak-ng")
    val destData = File(destRoot, "espeak-ng-data")
    if (!File(destData, "phontab").exists()) {
      copyAssetDir(ctx, "espeak-ng-data", destData)
    }
    return destRoot.absolutePath
  }

  private fun copyAssetDir(ctx: Context, assetDir: String, dest: File) {
    dest.mkdirs()
    val am = ctx.assets
    val children = try {
      am.list(assetDir) ?: emptyArray()
    } catch (_: Exception) {
      emptyArray()
    }
    if (children.isEmpty()) {
      // Einzeldatei?
      try {
        am.open(assetDir).use { input ->
          FileOutputStream(dest).use { output -> input.copyTo(output) }
        }
      } catch (_: Exception) {
        // ignore
      }
      return
    }
    for (name in children) {
      val assetPath = "$assetDir/$name"
      val out = File(dest, name)
      val sub = try {
        am.list(assetPath)
      } catch (_: Exception) {
        null
      }
      if (sub != null && sub.isNotEmpty()) {
        copyAssetDir(ctx, assetPath, out)
      } else {
        out.parentFile?.mkdirs()
        am.open(assetPath).use { input ->
          FileOutputStream(out).use { output -> input.copyTo(output) }
        }
      }
    }
  }
}
