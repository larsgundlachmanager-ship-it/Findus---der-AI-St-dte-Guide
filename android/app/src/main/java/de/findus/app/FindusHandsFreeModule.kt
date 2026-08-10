package de.findus.app

import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

/**
 * Hands-free: Home-Screen-Shortcut pinnen (findus://voice/listen).
 */
class FindusHandsFreeModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "FindusHandsFree"

  private fun shortcutManager(): ShortcutManager? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    return reactContext.getSystemService(ShortcutManager::class.java)
  }

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    try {
      val map = WritableNativeMap()
      val sm = shortcutManager()
      map.putBoolean("pinShortcutSupported", sm?.isRequestPinShortcutSupported == true)
      map.putBoolean("hasStaticListenShortcut", true)
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("handsfree_cap", e.message, e)
    }
  }

  @ReactMethod
  fun requestPinListenShortcut(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        promise.resolve(false)
        return
      }
      val sm = shortcutManager()
      if (sm == null || !sm.isRequestPinShortcutSupported) {
        promise.resolve(false)
        return
      }
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("findus://voice/listen")).apply {
        setClass(reactContext, MainActivity::class.java)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
      val shortcut = ShortcutInfo.Builder(reactContext, "findus_listen_pin")
        .setShortLabel("Sprechen")
        .setLongLabel("Findus zuhören")
        .setIcon(Icon.createWithResource(reactContext, R.mipmap.ic_launcher))
        .setIntent(intent)
        .build()
      val ok = sm.requestPinShortcut(shortcut, null)
      promise.resolve(ok)
    } catch (e: Exception) {
      promise.reject("handsfree_pin", e.message, e)
    }
  }
}
