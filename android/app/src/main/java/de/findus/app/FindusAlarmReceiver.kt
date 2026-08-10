package de.findus.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build

/**
 * Feuert den AlarmManager-Backup-Wecker (wenn keine System-Uhr den Intent übernimmt).
 */
class FindusAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != ACTION_FIRE) return

    val message = intent.getStringExtra(EXTRA_MESSAGE)?.take(80).orEmpty()
      .ifBlank { "Findus Wecker" }
    val hour = intent.getIntExtra(EXTRA_HOUR, -1)
    val minute = intent.getIntExtra(EXTRA_MINUTE, -1)
    val timeLabel =
      if (hour in 0..23 && minute in 0..59) {
        "%02d:%02d".format(hour, minute)
      } else {
        "jetzt"
      }

    ensureChannel(context)

    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent()
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val flags =
      PendingIntent.FLAG_UPDATE_CURRENT or
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          PendingIntent.FLAG_IMMUTABLE
        } else {
          0
        }
    val contentPi = PendingIntent.getActivity(context, 71021, launch, flags)

    val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }

    @Suppress("DEPRECATION")
    val notification = builder
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle("Findus — Aufstehen ($timeLabel)")
      .setContentText(message)
      .setStyle(
        Notification.BigTextStyle().bigText(
          "$message\nBackup-Wecker (System-Uhr war nicht erreichbar).",
        ),
      )
      .setAutoCancel(true)
      .setSound(alarmUri)
      .setVibrate(longArrayOf(0, 500, 250, 500, 250, 500))
      .setContentIntent(contentPi)
      .setFullScreenIntent(contentPi, true)
      .setCategory(Notification.CATEGORY_ALARM)
      .setPriority(Notification.PRIORITY_MAX)
      .build()

    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    nm?.notify(NOTIFICATION_FIRE_ID, notification)
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Findus Wecker",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Weckalarme und Backup-Alarme"
      enableVibration(true)
      val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      if (alarmUri != null) {
        setSound(
          alarmUri,
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
      }
    }
    nm.createNotificationChannel(channel)
  }

  companion object {
    const val ACTION_FIRE = "de.findus.app.ACTION_FINDUS_ALARM_FIRE"
    const val EXTRA_MESSAGE = "message"
    const val EXTRA_HOUR = "hour"
    const val EXTRA_MINUTE = "minute"
    const val EXTRA_TRIGGER_AT = "triggerAt"
    private const val CHANNEL_ID = "findus_wake_alarm"
    private const val NOTIFICATION_FIRE_ID = 71002
  }
}
