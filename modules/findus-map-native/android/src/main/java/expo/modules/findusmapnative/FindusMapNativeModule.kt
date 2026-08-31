package expo.modules.findusmapnative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Off-main-thread read of large *.map.json files.
 * Android compass remains in de.findus.app.FindusMapCompassModule.
 */
class FindusMapNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FindusMapNative")

    AsyncFunction("parseMapExtractFile") { filePath: String ->
      val f = File(filePath)
      if (!f.isFile) throw Exception("map file missing: $filePath")
      f.readText()
    }
  }
}
