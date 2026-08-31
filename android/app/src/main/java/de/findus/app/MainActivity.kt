package de.findus.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    normalizeAssistIntent(intent)
    super.onCreate(null)
    ensureLocationGuardStarted()
  }

  override fun onResume() {
    super.onResume()
    ensureLocationGuardStarted()
    mainHandler.removeCallbacks(recoverEmptySurfaceRunnable)
    mainHandler.postDelayed(recoverEmptySurfaceRunnable, RECOVER_EMPTY_SURFACE_MS)
    mainHandler.postDelayed(recoverEmptySurfaceRunnable, RECOVER_MARK_MOUNTED_MS)
  }

  /** Guard-Service empfängt onTaskRemoved auch wenn nur noch der Standort-FGS lebt. */
  private fun ensureLocationGuardStarted() {
    try {
      startService(Intent(this, FindusLocationGuardService::class.java))
    } catch (e: Exception) {
      Log.w(TAG, "FindusLocationGuardService start failed", e)
    }
  }

  override fun onPause() {
    mainHandler.removeCallbacks(recoverEmptySurfaceRunnable)
    super.onPause()
  }

  override fun onDestroy() {
    mainHandler.removeCallbacks(recoverEmptySurfaceRunnable)
    super.onDestroy()
  }

  // Recents-Wisch: onTaskRemoved lebt in FindusLocationGuardService (Activity hat das nicht).

  override fun onNewIntent(intent: Intent?) {
    normalizeAssistIntent(intent)
    super.onNewIntent(intent)
    setIntent(intent)
  }

  /**
   * ASSIST öffnet oft ohne URL — mappe auf findus://voice/listen,
   * damit Linking + Hands-free-Bus greifen.
   */
  private fun normalizeAssistIntent(intent: Intent?) {
    if (intent == null) return
    if (intent.action != Intent.ACTION_ASSIST) return
    intent.action = Intent.ACTION_VIEW
    if (intent.data == null) {
      intent.data = Uri.parse("findus://voice/listen")
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
   * Default-Zurück nur, wenn JS den Event nicht konsumiert hat
   * (z. B. zweites Zurück auf dem Home-Screen). Nie hart finishen —
   * App in den Hintergrund, damit ein versehentlicher Wisch nicht „schließt“.
   */
  override fun invokeDefaultOnBackPressed() {
      if (!moveTaskToBack(false)) {
          // Kein Task → erst dann System-Default
          super.invokeDefaultOnBackPressed()
      }
  }

  /**
   * Bridgeless: Activity-Destroy bei lebendem Prozess (Kompass / Background-GPS)
   * lässt eine leere Surface zurück — schwarzer Bildschirm, JS läuft weiter.
   * Wenn wir schon einmal UI hatten und Content danach leer ist: JS neu mounten.
   */
  private val recoverEmptySurfaceRunnable: Runnable = Runnable { recoverEmptySurface() }

  private fun recoverEmptySurface() {
    if (isFinishing || isDestroyed) return
    val empty = isReactContentEmpty()
    if (!empty) {
      everMountedUi = true
      recoveringEmptySurface = false
      recoverAttempts = 0
      return
    }
    if (!everMountedUi || recoveringEmptySurface || recoverAttempts >= 2) return
    recoveringEmptySurface = true
    recoverAttempts += 1
    Log.w(TAG, "empty RN surface after resume — reloading JS (try $recoverAttempts)")
    try {
      val host: ReactHost? = (application as ReactApplication).reactHost
      if (host == null) {
        recoveringEmptySurface = false
        Log.e(TAG, "reload skipped: reactHost is null")
        return
      }
      host.reload("empty-surface-after-resume")
      mainHandler.postDelayed({
        recoveringEmptySurface = false
        recoverEmptySurface()
      }, RECOVER_AFTER_RELOAD_MS)
    } catch (e: Exception) {
      recoveringEmptySurface = false
      Log.e(TAG, "reload failed", e)
    }
  }

  private fun isReactContentEmpty(): Boolean {
    val content = findViewById<ViewGroup>(android.R.id.content) ?: return true
    return viewCount(content) <= EMPTY_SURFACE_VIEW_MAX
  }

  private fun viewCount(view: View, depth: Int = 8): Int {
    if (depth <= 0) return 1
    if (view !is ViewGroup) return 1
    var n = 1
    for (i in 0 until view.childCount) {
      n += viewCount(view.getChildAt(i), depth - 1)
      if (n > EMPTY_SURFACE_VIEW_MAX) return n
    }
    return n
  }

  companion object {
    private const val TAG = "FindusBoot"
    private const val RECOVER_EMPTY_SURFACE_MS = 900L
    private const val RECOVER_MARK_MOUNTED_MS = 5000L
    private const val RECOVER_AFTER_RELOAD_MS = 2800L
    private const val EMPTY_SURFACE_VIEW_MAX = 8
    @Volatile private var everMountedUi = false
    @Volatile private var recoveringEmptySurface = false
    @Volatile private var recoverAttempts = 0
  }
}
