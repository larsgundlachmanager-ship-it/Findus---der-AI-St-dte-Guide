from pathlib import Path

p = Path(
    r"c:\Users\larsf\Findus 2.0\android\app\src\main\java\de\findus\app\FindusAlarmModule.kt"
)
t = p.read_text(encoding="utf-8")

# Ensure Log import
if "import android.util.Log" not in t:
    t = t.replace(
        "import android.os.Build\n",
        "import android.os.Build\nimport android.util.Log\n",
        1,
    )

old_clock = '''  @ReactMethod
  fun setAlarmClockIntent(hour: Int, minute: Int, message: String, promise: Promise) {
    try {
      if (hour !in 0..23 || minute !in 0..59) {
        promise.reject("bad_time", "Ungültige Uhrzeit")
        return
      }
      val label = message.take(60).ifBlank { "Yorro" }
      // WITH_UI zuerst — SKIP_UI meldet oft „ok“, ohne Wecker in der Uhr-Liste
      val result = syncClockApp(hour, minute, label, preferSilent = true)
      promise.resolve(
        WritableNativeMap().apply {
          putBoolean("ok", result.ok)
          putString("status", result.status)
          putString("detail", result.detail)
          putBoolean("clockSynced", result.ok)
        },
      )
    } catch (e: Exception) {
      promise.reject("alarm_clock_error", e.message ?: "intent_failed", e)
    }
  }'''

new_clock = '''  @ReactMethod
  fun setAlarmClockIntent(hour: Int, minute: Int, message: String, promise: Promise) {
    // UI-Thread + startActivity (kein startActivityForResult) — IntentLauncher kann hängen.
    reactContext.runOnUiQueueThread {
      try {
        if (hour !in 0..23 || minute !in 0..59) {
          promise.reject("bad_time", "Ungültige Uhrzeit")
          return@runOnUiQueueThread
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
  }'''

old_set = '''  @ReactMethod
  fun setAlarm(hour: Int, minute: Int, message: String, promise: Promise) {
    try {
      if (hour !in 0..23 || minute !in 0..59) {
        promise.reject("bad_time", "Ungültige Uhrzeit")
        return
      }
      val label = message.take(60).ifBlank { "Yorro" }
      val triggerAt = nextTriggerMillis(hour, minute)
      val requestCode = requestCodeFor(triggerAt)

      // Nur AlarmManager — Clock-Liste setzt JS via IntentLauncher / setAlarmClockIntent
      // (Application-Context startActivity wird von Android BAL oft still verworfen).
      maybeRequestExactAlarmPermission()
      var scheduled = scheduleAlarmManager(hour, minute, label, triggerAt, requestCode)
      if (!scheduled) {
        maybeRequestExactAlarmPermission()
        scheduled = scheduleAlarmManager(hour, minute, label, triggerAt, requestCode)
      }

      promise.resolve(
        WritableNativeMap().apply {
          putBoolean("ok", scheduled)
          putString("status", if (scheduled) "alarm_manager" else "no_handler")
          putString(
            "detail",
            if (scheduled) "AlarmManager %02d:%02d".format(hour, minute) else "alarm_manager_failed",
          )
          putBoolean("clockSynced", false)
          putDouble("triggerAtMs", triggerAt.toDouble())
          putInt("requestCode", requestCode)
        },
      )
    } catch (e: Exception) {
      promise.reject("alarm_error", e.message ?: "intent_failed", e)
    }
  }'''

new_set = '''  @ReactMethod
  fun setAlarm(hour: Int, minute: Int, message: String, promise: Promise) {
    reactContext.runOnUiQueueThread {
      try {
        if (hour !in 0..23 || minute !in 0..59) {
          promise.reject("bad_time", "Ungültige Uhrzeit")
          return@runOnUiQueueThread
        }
        val label = message.take(60).ifBlank { "Yorro" }
        val triggerAt = nextTriggerMillis(hour, minute)
        val requestCode = requestCodeFor(triggerAt)

        // 1) Google Clock (sichtbare Activity) — kein IntentLauncher / forResult
        val clock = syncClockApp(hour, minute, label, preferSilent = true)
        Log.i("FindusAlarm", "setAlarm clock ok=${clock.ok} ${clock.detail}")

        // 2) AlarmManager-Backup
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
  }'''

if old_clock not in t:
    raise SystemExit("clock method missing")
if old_set not in t:
    raise SystemExit("setAlarm method missing")
t = t.replace(old_clock, new_clock, 1).replace(old_set, new_set, 1)

# startActivityQuiet: log failures
old_sa = '''  private fun startActivityQuiet(intent: Intent): Boolean {
    return try {
      val activity = currentActivity
      if (activity == null) {
        // Ohne sichtbare Activity: BAL blockiert Application-startActivity still.
        // JS-Fallback (expo-intent-launcher) hat die Activity.
        return false
      }
      // Kein NEW_TASK nötig — wir starten aus der laufenden Activity.
      intent.flags = intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK.inv()
      activity.startActivity(intent)
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      false
    } catch (_: Exception) {
      false
    }
  }'''

new_sa = '''  private fun startActivityQuiet(intent: Intent): Boolean {
    return try {
      val activity = currentActivity
      if (activity == null) {
        Log.w("FindusAlarm", "startActivityQuiet: no currentActivity for ${intent.component}")
        return false
      }
      intent.flags = intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK.inv()
      activity.startActivity(intent)
      Log.i("FindusAlarm", "startActivityQuiet ok ${intent.component}")
      true
    } catch (e: ActivityNotFoundException) {
      Log.w("FindusAlarm", "startActivityQuiet ANF ${intent.component}", e)
      false
    } catch (e: SecurityException) {
      Log.w("FindusAlarm", "startActivityQuiet SEC ${intent.component}", e)
      false
    } catch (e: Exception) {
      Log.w("FindusAlarm", "startActivityQuiet ERR ${intent.component}", e)
      false
    }
  }'''

if old_sa not in t:
    raise SystemExit("startActivityQuiet missing")
t = t.replace(old_sa, new_sa, 1)

p.write_text(t, encoding="utf-8")
print("kotlin_ok")
