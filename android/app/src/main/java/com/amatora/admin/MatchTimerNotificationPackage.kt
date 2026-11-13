package com.amatora.admin

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.util.Locale

class MatchTimerNotificationPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(MatchTimerNotificationModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}

class MatchTimerNotificationModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {
  override fun getName() = "MatchTimerNotification"

  private val manager get() = context.getSystemService(NotificationManager::class.java)
  private val channelId = "match_timer"
  private val notificationId = 21016

  @ReactMethod
  fun show(remainingSeconds: Int, endTimeMs: Double) {
    if (Build.VERSION.SDK_INT < 26) return
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    val manager = manager ?: return
    if (!manager.areNotificationsEnabled()) return
    val running = endTimeMs > System.currentTimeMillis()
    val intent = Intent(context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val openApp = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE)
    manager.createNotificationChannel(
      NotificationChannel(channelId, "O‘yin taymeri", NotificationManager.IMPORTANCE_LOW)
    )
    val remaining = String.format(Locale.ROOT, "%d:%02d", remainingSeconds / 60, remainingSeconds % 60)
    val notification = Notification.Builder(context, channelId)
      .setSmallIcon(if (running) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause)
      .setContentTitle(if (running) "O‘yin davom etmoqda" else "O‘yin pauzada")
      .setContentText(if (running) "O‘yin taymeri" else remaining)
      .setContentIntent(openApp)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setShowWhen(running)
      .setUsesChronometer(running)

    if (running) {
      notification.setWhen(endTimeMs.toLong())
        .setChronometerCountDown(true)
        .setTimeoutAfter((endTimeMs.toLong() - System.currentTimeMillis()).coerceAtLeast(1L))
    }
    if (Build.VERSION.SDK_INT >= 36) notification.setRequestPromotedOngoing(true)
    try {
      manager.notify(notificationId, notification.build())
    } catch (_: SecurityException) {
      // Permission can be revoked between checking it and posting.
    }
  }

  @ReactMethod
  fun hide() {
    manager?.cancel(notificationId)
  }
}
