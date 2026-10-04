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
import android.util.Log
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
 * Wecker = derselbe Android-Befehl wie Gemini / `adb am start SET_ALARM`:
 * explizit Google Clock `HandleSetApiCalls` (+ SKIP_UI) → Eintrag in der Uhr-Liste.
 * AlarmManager nur als Backup (Statusleiste), zählt nicht als „Clock gestellt“.
 */
class FindusAlarmModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "FindusAlarm"

  /**
   * Uhr-App (Google Clock / Samsung / …) — das sieht der User in der Wecker-Liste.
   * Zuerst still (SKIP_UI), sonst mit UI. Ohne CATEGORY_DEFAULT-Zwang (sonst oft 0 Handler).
   */
  @ReactMethod
  fun setAlarmClockIntent(hour: Int, minute: Int, message: String, promise: Promise) {
    try {
      if (hour !in 0..23 || minute !in 0..59) {
        promise.reject("bad_time", "Ungültige Uhrzeit")
        return
      }
      val label = message.take(60).ifBlank { "Yorro" }
      val result = syncClockApp(hour, minute, label, preferSilent = true)
      Log.i("FindusAlarm", "setAlarmClockIntent ok=${result.ok} ${result.detail}")
      promise.resolve(
        WritableNativeMap().apply {
          putBoolean("ok", result.ok)
          putString("status", result.status)
          putString("detail", result.detail)
          putBoolean("clockSynced", result.ok)
        },
      )
    } catch (e: Exception) {
      Log.e("FindusAlarm", "setAlarmClockIntent failed", e)
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
      val label = message.take(60).ifBlank { "Yorro" }
      val triggerAt = nextTriggerMillis(hour, minute)
      val requestCode = requestCodeFor(triggerAt)

      val clock = syncClockApp(hour, minute, label, preferSilent = true)
      Log.i("FindusAlarm", "setAlarm clock ok=${clock.ok} ${clock.detail}")

      maybeRequestExactAlarmPermission()
      var scheduled = scheduleAlarmManager(hour, minute, label, triggerAt, requestCode)
      if (!scheduled) {
        maybeRequestExactAlarmPermission()
        scheduled = scheduleAlarmManager(hour, minute, label, triggerAt, requestCode)
      }

      val ok = clock.ok || scheduled
      val status =
        when {
          clock.ok && scheduled -> "clock_and_alarm_manager"
          clock.ok -> clock.status
          scheduled -> "alarm_manager"
          else -> "no_handler"
        }
      val detail =
        listOfNotNull(
          if (clock.ok) clock.detail else null,
          if (scheduled) "AlarmManager %02d:%02d".format(hour, minute) else null,
          if (!clock.ok) "clock_app_failed:${clock.detail}" else null,
        ).joinToString(" + ")

      promise.resolve(
        WritableNativeMap().apply {
          putBoolean("ok", ok)
          putString("status", status)
          putString("detail", detail)
          putBoolean("clockSynced", clock.ok)
          putDouble("triggerAtMs", triggerAt.toDouble())
          putInt("requestCode", requestCode)
        },
      )
    } catch (e: Exception) {
      Log.e("FindusAlarm", "setAlarm failed", e)
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

  /**
   * Küchen-Timer: Google Clock ACTION_SET_TIMER + AlarmManager-Backup
   * (klingelt auch wenn App im Hintergrund / Display aus).
   */
  @ReactMethod
  fun setTimer(lengthSec: Int, message: String, promise: Promise) {
    try {
      val secs = lengthSec.coerceIn(5, 12 * 60 * 60)
      val label = message.take(60).ifBlank { "Yorro Timer" }
      val triggerAt = System.currentTimeMillis() + secs * 1000L
      val requestCode = timerRequestCodeFor(triggerAt)

      val clock = syncClockTimer(secs, label, preferSilent = true)
      Log.i("FindusAlarm", "setTimer clock ok=${clock.ok} ${clock.detail}")

      maybeRequestExactAlarmPermission()
      var scheduled = scheduleTimerAlarmManager(label, triggerAt, requestCode)
      if (!scheduled) {
        maybeRequestExactAlarmPermission()
        scheduled = scheduleTimerAlarmManager(label, triggerAt, requestCode)
      }

      val ok = clock.ok || scheduled
      val status =
        when {
          clock.ok && scheduled -> "clock_and_alarm_manager"
          clock.ok -> clock.status
          scheduled -> "alarm_manager"
          else -> "no_handler"
        }
      Log.i("FindusAlarm", "setTimer ok=$ok status=$status secs=$secs")
      promise.resolve(
        WritableNativeMap().apply {
          putBoolean("ok", ok)
          putString("status", status)
          putString("detail", listOfNotNull(
            if (clock.ok) clock.detail else null,
            if (scheduled) "AlarmManager +${secs}s" else null,
            if (!clock.ok) "clock_timer_failed:${clock.detail}" else null,
          ).joinToString(" + "))
          putBoolean("clockSynced", clock.ok)
          putDouble("triggerAtMs", triggerAt.toDouble())
          putInt("requestCode", requestCode)
          putInt("lengthSec", secs)
        },
      )
    } catch (e: Exception) {
      Log.e("FindusAlarm", "setTimer failed", e)
      promise.reject("timer_error", e.message ?: "timer_failed", e)
    }
  }

  @ReactMethod
  fun cancelTimerAt(triggerAtMs: Double, promise: Promise) {
    try {
      val triggerAt = triggerAtMs.toLong()
      val code = timerRequestCodeFor(triggerAt)
      cancelTimerAlarmManager(code)
      removeStoredTimer(code)
      Log.i("FindusAlarm", "cancelTimerAt requestCode=$code")
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("cancel_timer_error", e.message, e)
    }
  }

  @ReactMethod
  fun cancelAlarmAt(triggerAtMs: Double, promise: Promise) {
    try {
      val triggerAt = triggerAtMs.toLong()
      val code = requestCodeFor(triggerAt)
      // Nur AlarmManager — Clock-Liste läuft über dismissClockAlarmAt (sonst Doppel-DISMISS)
      cancelAlarmManager(code)
      removeStored(code)
      Log.i("FindusAlarm", "cancelAlarmAt requestCode=$code")
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("cancel_error", e.message, e)
    }
  }

  /** Explizit Uhr-App-Wecker nach Stunde:Minute entfernen (Replace / Löschen). */
  @ReactMethod
  fun dismissClockAlarmAt(hour: Int, minute: Int, promise: Promise) {
    try {
      if (hour !in 0..23 || minute !in 0..59) {
        promise.reject("bad_time", "Ungültige Uhrzeit")
        return
      }
      val ok = dismissClockAlarm(hour, minute)
      promise.resolve(
        WritableNativeMap().apply {
          putBoolean("ok", ok)
          putBoolean("clockDismissed", ok)
          putString("detail", if (ok) "dismissed %02d:%02d".format(hour, minute) else "dismiss_failed")
        },
      )
    } catch (e: Exception) {
      promise.reject("dismiss_error", e.message ?: "dismiss_failed", e)
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

  private fun timerRequestCodeFor(triggerAt: Long): Int {
    // Eigener Nummernkreis, kollidiert nicht mit Wake-Alarmen
    return TIMER_REQ_BASE + ((triggerAt / 1000L) % 50_000L).toInt()
  }

  private fun scheduleTimerAlarmManager(
    message: String,
    triggerAt: Long,
    requestCode: Int,
  ): Boolean {
    return try {
      val am = reactContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        ?: return false
      val fireIntent = Intent(reactContext, FindusAlarmReceiver::class.java).apply {
        action = FindusAlarmReceiver.ACTION_FIRE_TIMER
        putExtra(FindusAlarmReceiver.EXTRA_MESSAGE, message)
        putExtra(FindusAlarmReceiver.EXTRA_TRIGGER_AT, triggerAt)
        putExtra(FindusAlarmReceiver.EXTRA_KIND, "timer")
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
        requestCode + 20_000,
        showIntent,
        pendingFlags(),
      )
      // setAlarmClock: darf auch im Doze / Display-aus feuern
      am.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showPending), pending)
      persistTimer(requestCode, triggerAt, message)
      true
    } catch (_: SecurityException) {
      false
    } catch (_: Exception) {
      false
    }
  }

  private fun cancelTimerAlarmManager(requestCode: Int) {
    try {
      val am = reactContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      val fireIntent = Intent(reactContext, FindusAlarmReceiver::class.java).apply {
        action = FindusAlarmReceiver.ACTION_FIRE_TIMER
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

  private fun syncClockTimer(
    lengthSec: Int,
    message: String,
    preferSilent: Boolean,
  ): ClockSyncResult {
    if (preferSilent) {
      tryClockTimerSync(lengthSec, message, skipUi = true)?.let { return it }
    }
    tryClockTimerSync(lengthSec, message, skipUi = false)?.let { return it }
    if (!preferSilent) {
      tryClockTimerSync(lengthSec, message, skipUi = true)?.let { return it }
    }
    return ClockSyncResult(
      ok = false,
      status = "no_handler",
      detail = "Keine Uhr-App für SET_TIMER gefunden",
    )
  }

  private fun tryClockTimerSync(
    lengthSec: Int,
    message: String,
    skipUi: Boolean,
  ): ClockSyncResult? {
    val intent = Intent(AlarmClock.ACTION_SET_TIMER).apply {
      putExtra(AlarmClock.EXTRA_LENGTH, lengthSec)
      putExtra(AlarmClock.EXTRA_MESSAGE, message)
      putExtra(AlarmClock.EXTRA_SKIP_UI, skipUi)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    for (pkg in KNOWN_CLOCK_PACKAGES) {
      for (cls in GOOGLE_CLOCK_SET_ALARM_CLASSES) {
        if (!pkg.contains("deskclock") && !pkg.contains("google")) continue
        intent.component = ComponentName(pkg, cls)
        if (startActivityQuiet(intent)) {
          return ClockSyncResult(
            ok = true,
            status = "clock_timer",
            detail = "SET_TIMER $pkg/$cls skipUi=$skipUi",
          )
        }
      }
    }
    intent.component = null
    // Package ohne feste Klasse
    for (pkg in KNOWN_CLOCK_PACKAGES) {
      intent.setPackage(pkg)
      if (startActivityQuiet(intent)) {
        return ClockSyncResult(
          ok = true,
          status = "clock_timer",
          detail = "SET_TIMER $pkg skipUi=$skipUi",
        )
      }
    }
    intent.setPackage(null)
    if (startActivityQuiet(intent)) {
      return ClockSyncResult(
        ok = true,
        status = "clock_timer",
        detail = "SET_TIMER implicit skipUi=$skipUi",
      )
    }
    return null
  }

  private fun persistTimer(requestCode: Int, triggerAt: Long, message: String) {
    try {
      val arr = JSONArray(prefs().getString(KEY_TIMERS, "[]"))
      val next = JSONArray()
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        if (o.optInt("requestCode") != requestCode) next.put(o)
      }
      next.put(
        JSONObject().apply {
          put("requestCode", requestCode)
          put("triggerAt", triggerAt)
          put("message", message)
          put("kind", "timer")
        },
      )
      prefs().edit().putString(KEY_TIMERS, next.toString()).apply()
    } catch (_: Exception) {
      /* soft */
    }
  }

  private fun removeStoredTimer(requestCode: Int) {
    try {
      val arr = JSONArray(prefs().getString(KEY_TIMERS, "[]"))
      val next = JSONArray()
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        if (o.optInt("requestCode") != requestCode) next.put(o)
      }
      prefs().edit().putString(KEY_TIMERS, next.toString()).apply()
    } catch (_: Exception) {
      /* soft */
    }
  }

  /** Clock-App: sichtbarer Wecker in Google Clock / Samsung / … */
  private data class ClockSyncResult(
    val ok: Boolean,
    val status: String,
    val detail: String,
  )

  private fun syncClockApp(
    hour: Int,
    minute: Int,
    message: String,
    preferSilent: Boolean,
  ): ClockSyncResult {
    if (preferSilent) {
      tryClockSync(hour, minute, message, skipUi = true)?.let { return it }
    }
    tryClockSync(hour, minute, message, skipUi = false)?.let { return it }
    if (!preferSilent) {
      tryClockSync(hour, minute, message, skipUi = true)?.let { return it }
    }
    return ClockSyncResult(
      ok = false,
      status = "no_handler",
      detail = "Keine Uhr-App für SET_ALARM gefunden",
    )
  }

  /**
   * ACTION_SET_ALARM — bekannte Packages zuerst, Query ohne CATEGORY_DEFAULT.
   */
  private fun tryClockSync(
    hour: Int,
    minute: Int,
    message: String,
    skipUi: Boolean,
  ): ClockSyncResult? {
    val base = Intent(AlarmClock.ACTION_SET_ALARM).apply {
      addCategory(Intent.CATEGORY_DEFAULT)
      putExtra(AlarmClock.EXTRA_HOUR, hour)
      putExtra(AlarmClock.EXTRA_MINUTES, minute)
      putExtra(AlarmClock.EXTRA_MESSAGE, message)
      putExtra(AlarmClock.EXTRA_SKIP_UI, skipUi)
      putExtra(AlarmClock.EXTRA_VIBRATE, true)
    }

    // Google Clock (neu): HandleSetApiCalls — ohne DEFAULT/Component oft kein Listeneintrag
    for (cls in GOOGLE_CLOCK_SET_ALARM_CLASSES) {
      val cn = ComponentName("com.google.android.deskclock", cls)
      val explicit = Intent(base).apply {
        component = cn
        setPackage("com.google.android.deskclock")
      }
      if (startActivityQuiet(explicit)) {
        return ClockSyncResult(
          ok = true,
          status = if (skipUi) "alarm_clock_silent" else "alarm_clock_ui",
          detail = "deskclock/$cls %02d:%02d skipUi=$skipUi".format(hour, minute),
        )
      }
    }

    for (pkg in KNOWN_CLOCK_PACKAGES) {
      val explicit = Intent(base).apply {
        setPackage(pkg)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      if (startActivityQuiet(explicit)) {
        return ClockSyncResult(
          ok = true,
          status = if (skipUi) "alarm_clock_silent" else "alarm_clock_ui",
          detail = "$pkg %02d:%02d skipUi=$skipUi".format(hour, minute),
        )
      }
    }

    val probe = Intent(AlarmClock.ACTION_SET_ALARM).apply {
      addCategory(Intent.CATEGORY_DEFAULT)
    }
    val matches = queryActivities(probe)
    for (info in matches) {
      val pkg = info.activityInfo.packageName
      if (pkg == reactContext.packageName) continue
      // Sleep as Android u.a. registrieren SET_ALARM, erzeugen aber keinen Google-Clock-Eintrag
      if (pkg.contains("sleep", ignoreCase = true)) continue
      if (pkg.contains("urbandroid", ignoreCase = true)) continue
      val cn = ComponentName(pkg, info.activityInfo.name)
      val explicit = Intent(base).apply {
        component = cn
        setPackage(pkg)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      if (startActivityQuiet(explicit)) {
        val shortName = info.activityInfo.name.substringAfterLast('.')
        return ClockSyncResult(
          ok = true,
          status = if (skipUi) "alarm_clock_silent" else "alarm_clock_ui",
          detail = "$pkg/$shortName %02d:%02d skipUi=$skipUi".format(hour, minute),
        )
      }
    }
    return null
  }

  /**
   * Google Clock: einmaligen Wecker deaktivieren/entfernen (ACTION_DISMISS_ALARM + TIME).
   * Bewährt: HandleApiCalls (nicht nur HandleSetApiCalls).
   */
  private fun dismissClockAlarm(hour: Int, minute: Int): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false
    val base =
      Intent(AlarmClock.ACTION_DISMISS_ALARM).apply {
        addCategory(Intent.CATEGORY_DEFAULT)
        putExtra(AlarmClock.EXTRA_ALARM_SEARCH_MODE, AlarmClock.ALARM_SEARCH_MODE_TIME)
        putExtra(AlarmClock.EXTRA_HOUR, hour)
        putExtra(AlarmClock.EXTRA_MINUTES, minute)
        putExtra(AlarmClock.EXTRA_IS_PM, hour >= 12)
      }

    for (cls in GOOGLE_CLOCK_DISMISS_CLASSES) {
      val explicit =
        Intent(base).apply {
          component = ComponentName("com.google.android.deskclock", cls)
          setPackage("com.google.android.deskclock")
        }
      if (startActivityQuiet(explicit)) {
        Log.i("FindusAlarm", "dismissClockAlarm ok deskclock/$cls %02d:%02d".format(hour, minute))
        return true
      }
    }

    for (pkg in KNOWN_CLOCK_PACKAGES) {
      val explicit =
        Intent(base).apply {
          setPackage(pkg)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      if (startActivityQuiet(explicit)) {
        Log.i("FindusAlarm", "dismissClockAlarm ok $pkg %02d:%02d".format(hour, minute))
        return true
      }
    }
    Log.w("FindusAlarm", "dismissClockAlarm failed %02d:%02d".format(hour, minute))
    return false
  }

  /**
   * Wie `am start … HandleSetApiCalls`: Activity wenn da, sonst Application + NEW_TASK
   * (sonst scheitert der Call still, obwohl ADB denselben Intent schafft).
   */
  private fun startActivityQuiet(intent: Intent): Boolean {
    val target = intent.component?.toShortString() ?: intent.`package` ?: intent.action
    val activity = currentActivity
    if (activity != null) {
      try {
        val fromActivity = Intent(intent).apply {
          flags = flags and Intent.FLAG_ACTIVITY_NEW_TASK.inv()
        }
        activity.startActivity(fromActivity)
        Log.i("FindusAlarm", "startActivityQuiet ok activity $target")
        return true
      } catch (e: ActivityNotFoundException) {
        Log.w("FindusAlarm", "startActivityQuiet ANF activity $target", e)
      } catch (e: SecurityException) {
        Log.w("FindusAlarm", "startActivityQuiet SEC activity $target", e)
      } catch (e: Exception) {
        Log.w("FindusAlarm", "startActivityQuiet ERR activity $target", e)
      }
    } else {
      Log.w("FindusAlarm", "startActivityQuiet: no currentActivity → appctx $target")
    }

    // Gleicher Effekt wie adb am start: Context + FLAG_ACTIVITY_NEW_TASK
    try {
      val fromApp = Intent(intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactContext.startActivity(fromApp)
      Log.i("FindusAlarm", "startActivityQuiet ok appctx $target")
      return true
    } catch (e: ActivityNotFoundException) {
      Log.w("FindusAlarm", "startActivityQuiet ANF appctx $target", e)
    } catch (e: SecurityException) {
      Log.w("FindusAlarm", "startActivityQuiet SEC appctx $target", e)
    } catch (e: Exception) {
      Log.w("FindusAlarm", "startActivityQuiet ERR appctx $target", e)
    }

    // Letzter Versuch: PendingIntent (manche ROMs blocken nur direkten startActivity)
    return try {
      val piFlags =
        PendingIntent.FLAG_UPDATE_CURRENT or
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE
          } else {
            0
          }
      val pi =
        PendingIntent.getActivity(
          reactContext,
          (System.currentTimeMillis() and 0x7fffffff).toInt(),
          Intent(intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
          piFlags,
        )
      pi.send()
      Log.i("FindusAlarm", "startActivityQuiet ok pending $target")
      true
    } catch (e: Exception) {
      Log.w("FindusAlarm", "startActivityQuiet FAIL pending $target", e)
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
      val flags =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          PackageManager.MATCH_ALL or PackageManager.MATCH_DEFAULT_ONLY
        } else {
          PackageManager.MATCH_DEFAULT_ONLY
        }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.queryIntentActivities(
          intent,
          PackageManager.ResolveInfoFlags.of(flags.toLong()),
        )
      } else {
        @Suppress("DEPRECATION")
        pm.queryIntentActivities(intent, flags)
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
    private const val KEY_TIMERS = "timers"
    private const val TIMER_REQ_BASE = 82_000

    private val GOOGLE_CLOCK_SET_ALARM_CLASSES =
      listOf(
        "com.android.deskclock.HandleSetApiCalls",
        "com.android.deskclock.HandleApiCalls",
      )

    /** DISMISS: HandleApiCalls zuerst (HandleSetApiCalls oft ohne DISMISS). */
    private val GOOGLE_CLOCK_DISMISS_CLASSES =
      listOf(
        "com.android.deskclock.HandleApiCalls",
        "com.android.deskclock.HandleSetApiCalls",
      )

    private val KNOWN_CLOCK_PACKAGES =
      listOf(
        "com.google.android.deskclock",
        "com.android.deskclock",
        "com.sec.android.app.clockpackage",
        "com.samsung.android.app.clockpack",
        "com.oneplus.deskclock",
        "com.coloros.alarmclock",
        "com.oplus.alarmclock",
        "com.huawei.deskclock",
        "com.android.alarmclock",
        "com.miui.clock",
        "com.xiaomi.clock",
        "com.sonyericsson.organizer",
        "com.asus.deskclock",
      )

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

        // Küchen-Timer: nur wenn Ende noch in der Zukunft (kein Roll-over)
        val timers = JSONArray(prefs.getString(KEY_TIMERS, "[]"))
        val keptTimers = JSONArray()
        for (i in 0 until timers.length()) {
          val o = timers.optJSONObject(i) ?: continue
          val triggerAt = o.optLong("triggerAt")
          val message = o.optString("message", "Yorro Timer")
          val requestCode = o.optInt("requestCode")
          if (triggerAt <= now + 2_000L) continue
          val fireIntent = Intent(context, FindusAlarmReceiver::class.java).apply {
            action = FindusAlarmReceiver.ACTION_FIRE_TIMER
            putExtra(FindusAlarmReceiver.EXTRA_MESSAGE, message)
            putExtra(FindusAlarmReceiver.EXTRA_TRIGGER_AT, triggerAt)
            putExtra(FindusAlarmReceiver.EXTRA_KIND, "timer")
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
            requestCode + 20_000,
            showIntent,
            flags,
          )
          am.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showPending), pending)
          keptTimers.put(o)
        }
        prefs.edit().putString(KEY_TIMERS, keptTimers.toString()).apply()
      } catch (_: Exception) {
        /* soft */
      }
    }
  }
}
