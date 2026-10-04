from pathlib import Path

p = Path(
    r"c:\Users\larsf\Findus 2.0\android\app\src\main\java\de\findus\app\FindusAlarmModule.kt"
)
t = p.read_text(encoding="utf-8")
start = t.index("  @ReactMethod\n  fun setAlarmClockIntent")
end = t.index("  @ReactMethod\n  fun cancelAlarm(")
new = r'''  @ReactMethod
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

'''
p.write_text(t[:start] + new + t[end:], encoding="utf-8")
print("ok", "runOnUiQueueThread" in p.read_text(encoding="utf-8"))
