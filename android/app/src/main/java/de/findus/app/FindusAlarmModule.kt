package de.findus.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Build
import android.provider.AlarmClock
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * Primär: AlarmManager.setAlarmClock — interner Android-Systemwecker
 * (Statusleisten-Uhr-Icon, zuverlässig, mehrere Alarme möglich).
 *
 * Optional: Clock-App still mitziehen — nur wenn ein echter Handler existiert.
 * Nie implizites SET_ALARM ohne Handler → kein Dialog
 * „Diese Aktion kann von keiner App ausgeführt werden“.
 */
class FindusAlarmModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "FindusAlarm"

  /**
   * Tier-2 Einstieg: AlarmClock.ACTION_SET_ALARM mit SKIP_UI.
   * Feuert den OEM-Wecker still im Hintergrund (kein UI wenn unterstützt).
   */
  @ReactMethod
  fun setAlarmClockIntent(hour: Int, minute: Int, message: String, promise: Promise) {
    try {
      if (hour !in 0..23 || minute !in 0..59) {
        promise.reject("bad_time", "Ungültige Uhrzeit")
        return
      }
      val label = message.take(60).ifBlank { "Findus" }
      val synced = trySilentClockSync(hour, minute, label)
      if (synced) {
        promise.resolve(
          resultMap(
            "alarm_clock",
            true,
            "AlarmClock SKIP_UI auf %02d:%02d".format(hour, minute),
          ),
        )
        return
      }
      promise.resolve(
        resultMap(
          "no_handler",
          false,
          "Kein AlarmClock-Handler mit SKIP_UI verfügbar",
        ),
      )
    } catch (e: Exception) {
      promise.reject("alarm_clock_error", e.message ?: "intent_failed", e)
    }
  }

  @ReactMethod
  fun setAlarm(hour: Int, minute: Int, message: String, promise: Promise) {
    try {
      if (hour !in 0..23 || minute !in 0..59) {
        promise.reject("bad_time", "Ungültige Uhrzeit")
        return
      }
      val label = message.take(60).ifBlank { "Findus" }
      val triggerAt = nextTriggerMillis(hour, minute)
      val requestCode = requestCodeFor(triggerAt)

      // 1) Interner System-Wecker — immer zuerst
      val scheduled = scheduleAlarmManager(hour, minute, label, triggerAt, requestCode)
      if (!scheduled) {
        // Exact-Alarm-Recht anfordern, dann nochmal
        maybeRequestExactAlarmPermission()
        val retry = scheduleAlarmManager(hour, minute, label, triggerAt, requestCode)
        if (!retry) {
          promise.resolve(
            resultMap(
              "no_handler",
              false,
              "AlarmManager konnte nicht setzen — bitte unter Einstellungen → Apps → Findus → Alarme erlauben",
            ),
          )
          return
        }
      }

      // 2) Optional Clock-App — nur still / nur mit echtem Handler (kein Fehlerdialog)
      val clockSynced = trySilentClockSync(hour, minute, label)

      val status = if (clockSynced) "set_silent" else "alarm_manager"
      val detail =
        if (clockSynced) {
          "System-Wecker und Uhr-App auf %02d:%02d".format(hour, minute)
        } else {
          "Findus-Systemwecker (Android AlarmManager) auf %02d:%02d".format(hour, minute)
        }

      promise.resolve(
        WritableNativeMap().apply {
          putBoolean("ok", true)
          putString("status", status)
          putString("detail", detail)
          putDouble("triggerAtMs", triggerAt.toDouble())
          putInt("requestCode", requestCode)
        },
      )
    } catch (e: Exception) {
      promise.reject("alarm_error", e.message ?: "intent_failed", e)
    }
  }

  @ReactMethod
  fun cancelAlarm(requestCode: Int, promise: Promise) {
    try {
      cancelAlarmManager(requestCode)
      removeStored(requestCode)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("cancel_error", e.message, e)
    }
  }

  @ReactMethod
  fun cancelAlarmAt(triggerAtMs: Double, promise: Promise) {
    try {
      val code = requestCodeFor(triggerAtMs.toLong())
      cancelAlarmManager(code)
      removeStored(code)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("cancel_error", e.message, e)
    }
  }

  private fun scheduleAlarmManager(
    hour: Int,
    minute: Int,
    message: String,
    triggerAt: Long,
    requestCode: Int,
  ): Boolean {
    return try {
      val am = reactContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        ?: return false

      val fireIntent = Intent(reactContext, FindusAlarmReceiver::class.java).apply {
        action = FindusAlarmReceiver.ACTION_FIRE
        putExtra(FindusAlarmReceiver.EXTRA_MESSAGE, message)
        putExtra(FindusAlarmReceiver.EXTRA_HOUR, hour)
        putExtra(FindusAlarmReceiver.EXTRA_MINUTE, minute)
        putExtra(FindusAlarmReceiver.EXTRA_TRIGGER_AT, triggerAt)
      }
      val pending = PendingIntent.getBroadcast(
        reactContext,
        requestCode,
        fireIntent,
        pendingFlags(),
      )

      val showIntent = reactContext.packageManager
        .getLaunchIntentForPackage(reactContext.packageName)
        ?: Intent().apply { setPackage(reactContext.packageName) }
      showIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      val showPending = PendingIntent.getActivity(
        reactContext,
        requestCode + 10_000,
        showIntent,
        pendingFlags(),
      )

      am.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showPending), pending)
      persistAlarm(requestCode, triggerAt, hour, minute, message)
      notifyScheduled(hour, minute, message, triggerAt)
      true
    } catch (_: SecurityException) {
      false
    } catch (_: Exception) {
      false
    }
  }

  private fun cancelAlarmManager(requestCode: Int) {
    try {
      val am = reactContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      val fireIntent = Intent(reactContext, FindusAlarmReceiver::class.java).apply {
        action = FindusAlarmReceiver.ACTION_FIRE
      }
      val pending = PendingIntent.getBroadcast(
        reactContext,
        requestCode,
        fireIntent,
        pendingFlags(),
      )
      am.cancel(pending)
      pending.cancel()
    } catch (_: Exception) {
      /* soft */
    }
  }

  /** Clock-App nur wenn query echte Activities liefert — nie Fehlerdialog. */
  private fun trySilentClockSync(hour: Int, minute: Int, message: String): Boolean {
    val base = Intent(AlarmClock.ACTION_SET_ALARM).apply {
      addCategory(Intent.CATEGORY_DEFAULT)
      putExtra(AlarmClock.EXTRA_HOUR, hour)
      putExtra(AlarmClock.EXTRA_MINUTES, minute)
      putExtra(AlarmClock.EXTRA_MESSAGE, message)
      putExtra(AlarmClock.EXTRA_SKIP_UI, true)
      putExtra(AlarmClock.EXTRA_VIBRATE, true)
    }
    val matches = queryActivities(base)
    if (matches.isEmpty()) return false

    // Explizit erste echte Activity — kein impliziter Start
    for (info in matches) {
      val cn = ComponentName(info.activityInfo.packageName, info.activityInfo.name)
      val explicit = Intent(base).apply {
        component = cn
        setPackage(info.activityInfo.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      if (startActivityQuiet(explicit)) return true
    }
    return false
  }

  private fun startActivityQuiet(intent: Intent): Boolean {
    return try {
      val activity = currentActivity
      if (activity != null) activity.startActivity(intent)
      else reactContext.startActivity(intent)
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      false
    } catch (_: Exception) {
      false
    }
  }

  private fun maybeRequestExactAlarmPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    try {
      val am = reactContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      if (am.canScheduleExactAlarms()) return
      val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
        data = Uri.parse("package:${reactContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      startActivityQuiet(intent)
    } catch (_: Exception) {
      /* soft */
    }
  }

  private fun prefs(): SharedPreferences =
    reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun persistAlarm(
    requestCode: Int,
    triggerAt: Long,
    hour: Int,
    minute: Int,
    message: String,
  ) {
    try {
      val arr = JSONArray(prefs().getString(KEY_ALARMS, "[]"))
      // gleichen Request-Code ersetzen
      val next = JSONArray()
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        if (o.optInt("requestCode") != requestCode) next.put(o)
      }
      next.put(
        JSONObject().apply {
          put("requestCode", requestCode)
          put("triggerAt", triggerAt)
          put("hour", hour)
          put("minute", minute)
          put("message", message)
        },
      )
      prefs().edit().putString(KEY_ALARMS, next.toString()).apply()
    } catch (_: Exception) {
      /* soft */
    }
  }

  private fun removeStored(requestCode: Int) {
    try {
      val arr = JSONArray(prefs().getString(KEY_ALARMS, "[]"))
      val next = JSONArray()
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        if (o.optInt("requestCode") != requestCode) next.put(o)
      }
      prefs().edit().putString(KEY_ALARMS, next.toString()).apply()
    } catch (_: Exception) {
      /* soft */
    }
  }

  private fun notifyScheduled(
    hour: Int,
    minute: Int,
    message: String,
    triggerAt: Long,
  ) {
    try {
      ensureChannel()
      val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        ?: return
      val timeLabel = "%02d:%02d".format(hour, minute)
      val builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Notification.Builder(reactContext, CHANNEL_ID)
        } else {
          @Suppress("DEPRECATION")
          Notification.Builder(reactContext)
        }
      @Suppress("DEPRECATION")
      val notification = builder
        .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
        .setContentTitle("Wecker $timeLabel")
        .setContentText(message.ifBlank { "Findus-Wecker aktiv" })
        .setStyle(
          Notification.BigTextStyle().bigText(
            "Wecker für $timeLabel steht im Android-System (AlarmManager).",
          ),
        )
        .setPriority(Notification.PRIORITY_DEFAULT)
        .setAutoCancel(true)
        .setWhen(triggerAt)
        .setShowWhen(true)
        .build()
      nm.notify(NOTIFICATION_SCHEDULED_ID + (hour * 60 + minute), notification)
    } catch (_: Exception) {
      /* soft */
    }
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    nm.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "Findus Wecker",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "System-Wecker über AlarmManager"
        enableVibration(true)
      },
    )
  }

  private fun nextTriggerMillis(hour: Int, minute: Int): Long {
    val cal = Calendar.getInstance().apply {
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
      set(Calendar.HOUR_OF_DAY, hour)
      set(Calendar.MINUTE, minute)
      if (timeInMillis <= System.currentTimeMillis() + 15_000L) {
        add(Calendar.DAY_OF_YEAR, 1)
      }
    }
    return cal.timeInMillis
  }

  private fun requestCodeFor(triggerAt: Long): Int {
    // Stabil pro Minute — zweiter Wecker zu anderer Zeit = anderer Code
    val minuteBucket = (triggerAt / 60_000L).toInt()
    return 71_000 + (minuteBucket and 0x0FFF)
  }

  private fun pendingFlags(): Int =
    PendingIntent.FLAG_UPDATE_CURRENT or
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        PendingIntent.FLAG_IMMUTABLE
      } else {
        0
      }

  private fun queryActivities(intent: Intent): List<ResolveInfo> {
    val pm = reactContext.packageManager
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.queryIntentActivities(
          intent,
          PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()),
        )
      } else {
        @Suppress("DEPRECATION")
        pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun resultMap(
    status: String,
    ok: Boolean,
    detail: String,
  ): WritableNativeMap {
    return WritableNativeMap().apply {
      putBoolean("ok", ok)
      putString("status", status)
      putString("detail", detail)
    }
  }

  companion object {
    private const val CHANNEL_ID = "findus_wake_alarm"
    private const val NOTIFICATION_SCHEDULED_ID = 71001
    private const val PREFS = "findus_alarms_v1"
    private const val KEY_ALARMS = "alarms"

    /** Von BootReceiver genutzt */
    fun rescheduleAll(context: Context) {
      try {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString(KEY_ALARMS, "[]"))
        val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val now = System.currentTimeMillis()
        val kept = JSONArray()
        for (i in 0 until arr.length()) {
          val o = arr.optJSONObject(i) ?: continue
          var triggerAt = o.optLong("triggerAt")
          val hour = o.optInt("hour")
          val minute = o.optInt("minute")
          val message = o.optString("message", "Findus")
          val requestCode = o.optInt("requestCode")
          if (triggerAt <= now + 5_000L) {
            // nächster Tag gleiche Uhrzeit
            val cal = Calendar.getInstance().apply {
              set(Calendar.SECOND, 0)
              set(Calendar.MILLISECOND, 0)
              set(Calendar.HOUR_OF_DAY, hour)
              set(Calendar.MINUTE, minute)
              if (timeInMillis <= now + 5_000L) add(Calendar.DAY_OF_YEAR, 1)
            }
            triggerAt = cal.timeInMillis
          }
          val fireIntent = Intent(context, FindusAlarmReceiver::class.java).apply {
            action = FindusAlarmReceiver.ACTION_FIRE
            putExtra(FindusAlarmReceiver.EXTRA_MESSAGE, message)
            putExtra(FindusAlarmReceiver.EXTRA_HOUR, hour)
            putExtra(FindusAlarmReceiver.EXTRA_MINUTE, minute)
            putExtra(FindusAlarmReceiver.EXTRA_TRIGGER_AT, triggerAt)
          }
          val flags =
            PendingIntent.FLAG_UPDATE_CURRENT or
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_IMMUTABLE
              } else {
                0
              }
          val pending = PendingIntent.getBroadcast(context, requestCode, fireIntent, flags)
          val showIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: Intent().apply { setPackage(context.packageName) }
          showIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
          val showPending = PendingIntent.getActivity(
            context,
            requestCode + 10_000,
            showIntent,
            flags,
          )
          am.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showPending), pending)
          o.put("triggerAt", triggerAt)
          kept.put(o)
        }
        prefs.edit().putString(KEY_ALARMS, kept.toString()).apply()
      } catch (_: Exception) {
        /* soft */
      }
    }
  }
}
