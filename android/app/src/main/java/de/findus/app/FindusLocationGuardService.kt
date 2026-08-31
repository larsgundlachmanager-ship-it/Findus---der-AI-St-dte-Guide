package de.findus.app

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log

/**
 * Läuft mit der App mit und fängt Recents-Wisch ab, auch wenn die Activity
 * schon destroyed ist und nur noch der Standort-FGS den Prozess hält.
 */
class FindusLocationGuardService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    return START_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    Log.i(TAG, "app task removed — stop background GPS")
    FindusLocationShutdown.stopBackgroundLocationOnAppClosed(this)
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  companion object {
    private const val TAG = "FindusLocation"
  }
}
