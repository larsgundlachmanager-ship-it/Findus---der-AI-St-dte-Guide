package de.findus.app

import android.content.Intent
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.view.KeyEvent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * In-Ear / Headset Media-Tasten → Findus aktivieren (Play/Pause / Hook).
 * Greift, wenn Findus die MediaSession hält — nicht während Spotify/etc.
 */
class FindusHeadsetModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private var session: MediaSession? = null

  override fun getName(): String = "FindusHeadset"

  @ReactMethod
  fun startControls(promise: Promise) {
    try {
      ensureSession()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("headset_start", e.message, e)
    }
  }

  @ReactMethod
  fun stopControls(promise: Promise) {
    try {
      releaseSession()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("headset_stop", e.message, e)
    }
  }

  @ReactMethod
  fun isActive(promise: Promise) {
    promise.resolve(session?.isActive == true)
  }

  private fun ensureSession() {
    val existing = session
    if (existing != null) {
      existing.isActive = true
      publishPausedState(existing)
      return
    }
    val s = MediaSession(reactContext, "FindusHeadset")
    s.setCallback(object : MediaSession.Callback() {
      override fun onPlay() {
        emitActivate("play")
      }

      override fun onPause() {
        emitActivate("pause")
      }

      override fun onStop() {
        emitActivate("stop")
      }

      override fun onMediaButtonEvent(mediaButtonIntent: Intent): Boolean {
        val event =
          if (Build.VERSION.SDK_INT >= 33) {
            mediaButtonIntent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
          } else {
            @Suppress("DEPRECATION")
            mediaButtonIntent.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
          }
        if (event == null || event.action != KeyEvent.ACTION_DOWN) {
          return super.onMediaButtonEvent(mediaButtonIntent)
        }
        return when (event.keyCode) {
          KeyEvent.KEYCODE_HEADSETHOOK,
          KeyEvent.KEYCODE_MEDIA_PLAY,
          KeyEvent.KEYCODE_MEDIA_PAUSE,
          KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
            emitActivate("media_button")
            true
          }
          else -> super.onMediaButtonEvent(mediaButtonIntent)
        }
      }
    })
    s.setFlags(
      MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or
        MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS,
    )
    s.isActive = true
    session = s
    publishPausedState(s)
  }

  private fun publishPausedState(s: MediaSession) {
    val state = PlaybackState.Builder()
      .setActions(
        PlaybackState.ACTION_PLAY or
          PlaybackState.ACTION_PAUSE or
          PlaybackState.ACTION_PLAY_PAUSE or
          PlaybackState.ACTION_STOP,
      )
      .setState(PlaybackState.STATE_PAUSED, 0L, 1f)
      .build()
    s.setPlaybackState(state)
  }

  private fun emitActivate(reason: String) {
    if (!reactContext.hasActiveReactInstance()) return
    val payload = Arguments.createMap()
    payload.putString("reason", reason)
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("FindusHeadsetActivate", payload)
  }

  private fun releaseSession() {
    try {
      session?.isActive = false
      session?.release()
    } catch (_: Exception) {
      /* soft */
    }
    session = null
  }

  override fun invalidate() {
    releaseSession()
    super.invalidate()
  }
}
