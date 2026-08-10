package de.findus.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Stellt Findus-AlarmManager-Wecker nach Reboot wieder her. */
class FindusAlarmBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (
      action == Intent.ACTION_BOOT_COMPLETED ||
      action == Intent.ACTION_LOCKED_BOOT_COMPLETED ||
      action == "android.intent.action.QUICKBOOT_POWERON"
    ) {
      FindusAlarmModule.rescheduleAll(context.applicationContext)
    }
  }
}
