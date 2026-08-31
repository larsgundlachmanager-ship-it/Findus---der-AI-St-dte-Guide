package de.findus.app

import android.content.Context
import android.content.Intent
import android.util.Log
import expo.modules.interfaces.taskManager.TaskServiceProviderHelper

/**
 * Beendet Hintergrund-GPS, wenn die App wirklich geschlossen wird
 * (aus den letzten Apps gewischt) — nicht bei Home/Sperrbildschirm.
 *
 * Expo-Location-FGS allein (killServiceOnDestroy) stoppt nur die Notification;
 * der TaskManager-PendingIntent würde sonst weiter tracken und die App headless wecken.
 */
object FindusLocationShutdown {
  private const val TAG = "FindusLocation"
  private const val TASK_PREFS = "TaskManagerModule"

  fun stopBackgroundLocationOnAppClosed(context: Context) {
    val appCtx = context.applicationContext
    try {
      val taskService = TaskServiceProviderHelper.getTaskServiceImpl(appCtx)
      if (taskService != null) {
        val prefs = appCtx.getSharedPreferences(TASK_PREFS, Context.MODE_PRIVATE)
        val scopeKeys = LinkedHashSet<String>()
        scopeKeys.addAll(prefs.all.keys)
        scopeKeys.add(appCtx.packageName)
        if (scopeKeys.isEmpty()) {
          Log.i(TAG, "no TaskManager scopes — nothing to unregister")
        }
        for (scopeKey in scopeKeys) {
          try {
            taskService.unregisterAllTasksForAppScopeKey(scopeKey)
            Log.i(TAG, "unregistered TaskManager tasks ($scopeKey) — app closed")
          } catch (e: Exception) {
            Log.w(TAG, "unregister scope=$scopeKey failed", e)
          }
        }
      } else {
        Log.w(TAG, "TaskService missing — clearing TaskManager prefs")
        appCtx.getSharedPreferences(TASK_PREFS, Context.MODE_PRIVATE).edit().clear().apply()
      }
    } catch (e: Exception) {
      Log.w(TAG, "stopBackgroundLocationOnAppClosed failed", e)
    }

    try {
      val serviceClass =
        Class.forName("expo.modules.location.services.LocationTaskService")
      appCtx.stopService(Intent(appCtx, serviceClass))
    } catch (e: Exception) {
      Log.w(TAG, "stop LocationTaskService failed", e)
    }

    try {
      appCtx.stopService(Intent(appCtx, FindusLocationGuardService::class.java))
    } catch (e: Exception) {
      Log.w(TAG, "stop FindusLocationGuardService failed", e)
    }
  }
}
