package de.findus.app

import android.content.Context
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.math.abs

/**
 * Google-Maps-Kompass: TYPE_ROTATION_VECTOR.
 * Heading = horizontale Blickrichtung (flach: Oberkante, aufrecht: durchs Display).
 * Kein Display-Remap — die App ist Portrait-locked, Rotation_90 würde 90° nach links kippen.
 */
class FindusMapCompassModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), SensorEventListener, LifecycleEventListener {

  private val rotationMatrix = FloatArray(9)

  private var sensorManager: SensorManager? = null
  private var vectorSensor: Sensor? = null
  private var gameSensor: Sensor? = null
  private var listening = false

  private var lastLat = Float.NaN
  private var lastLng = Float.NaN
  private var lastAlt = 0f
  private var declinationDeg = 0f

  private var smoothedDeg: Double? = null
  private var lastRvDeg: Double? = null
  private var lastGameYaw: Double? = null
  private var lastAccuracy = -1
  private var lastSampleAt = 0L
  private var lastEmitAt = 0L
  private var lastEmittedDeg: Double? = null

  /** Nach der Acht: True-North einfrieren, Drehen nur über GAME_ROTATION_VECTOR (kein Mag-Drift). */
  private var wantLock = false
  private var locked = false
  private var lockTrueDeg: Double? = null
  private var lockGameYaw: Double? = null

  override fun getName(): String = "FindusMapCompass"

  override fun initialize() {
    super.initialize()
    reactContext.addLifecycleEventListener(this)
  }

  override fun onHostResume() = Unit

  override fun onHostPause() = Unit

  override fun onHostDestroy() {
    UiThreadUtil.runOnUiThread { stopListening() }
  }

  @ReactMethod
  fun start(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        if (!startListening()) {
          promise.resolve(false)
          return@runOnUiThread
        }
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("compass_start", e.message, e)
      }
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      stopListening()
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun reset(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      wantLock = false
      clearLockAnchors()
      smoothedDeg = null
      lastSampleAt = 0L
      lastEmitAt = 0L
      lastEmittedDeg = null
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun lock(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      wantLock = true
      captureLock()
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun unlock(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      wantLock = false
      clearLockAnchors()
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun nudge(courseDeg: Double, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      if (!wantLock || !courseDeg.isFinite()) {
        promise.resolve(false)
        return@runOnUiThread
      }
      val cur = outputHeading()
      if (cur == null) {
        promise.resolve(false)
        return@runOnUiThread
      }
      val err = shortestDelta(cur, courseDeg)
      if (abs(err) > 48.0) {
        promise.resolve(false)
        return@runOnUiThread
      }
      val true0 = lockTrueDeg
      if (true0 == null) {
        promise.resolve(false)
        return@runOnUiThread
      }
      lockTrueDeg = (true0 + 0.32 * err + 360.0) % 360.0
      lockGameYaw = lastGameYaw
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun setFix(lat: Double, lng: Double, altM: Double) {
    if (!lat.isFinite() || !lng.isFinite()) return
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return
    val moved =
      lastLat.isNaN() ||
        abs(lat - lastLat) > 0.04 ||
        abs(lng - lastLng) > 0.04
    lastLat = lat.toFloat()
    lastLng = lng.toFloat()
    lastAlt = altM.toFloat().coerceIn(-500f, 9000f)
    if (moved) {
      declinationDeg = GeomagneticField(
        lastLat,
        lastLng,
        lastAlt,
        System.currentTimeMillis(),
      ).declination
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    /* NativeEventEmitter */
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    /* NativeEventEmitter */
  }

  private fun startListening(): Boolean {
    if (listening) return true
    val sm = reactContext.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
      ?: return false
    val sensor =
      sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        ?: sm.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR)
        ?: return false
    sensorManager = sm
    vectorSensor = sensor
    gameSensor = sm.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
    smoothedDeg = null
    lastRvDeg = null
    lastGameYaw = null
    lastSampleAt = 0L
    lastEmitAt = 0L
    lastEmittedDeg = null
    lockTrueDeg = null
    lockGameYaw = null
    locked = false
    val ok = sm.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME)
    if (ok && gameSensor != null) {
      sm.registerListener(this, gameSensor, SensorManager.SENSOR_DELAY_GAME)
    }
    listening = ok
    return ok
  }

  private fun stopListening() {
    try {
      sensorManager?.unregisterListener(this)
    } catch (_: Exception) {
      /* soft */
    }
    listening = false
    sensorManager = null
    vectorSensor = null
    gameSensor = null
    smoothedDeg = null
    lastRvDeg = null
    lastGameYaw = null
    locked = false
    lockTrueDeg = null
    lockGameYaw = null
  }

  private fun clearLockAnchors() {
    locked = false
    lockTrueDeg = null
    lockGameYaw = null
  }

  private fun shortestDelta(fromDeg: Double, toDeg: Double): Double {
    var d = ((toDeg - fromDeg + 540.0) % 360.0) - 180.0
    if (d <= -180.0) d += 360.0
    return d
  }

  private fun captureLock() {
    if (!wantLock) return
    locked = true
    if (lockTrueDeg == null) {
      lockTrueDeg = smoothedDeg ?: lastRvDeg
    }
    if (lockGameYaw == null) {
      lockGameYaw = lastGameYaw
    }
  }

  private fun outputHeading(): Double? {
    if (!wantLock) return smoothedDeg
    val true0 = lockTrueDeg ?: return smoothedDeg
    val g0 = lockGameYaw
    val gNow = lastGameYaw
    if (g0 == null || gNow == null) return true0
    return (true0 + shortestDelta(g0, gNow) + 360.0) % 360.0
  }

  override fun onSensorChanged(event: SensorEvent) {
    if (!listening) return
    val type = event.sensor.type
    if (type == Sensor.TYPE_GAME_ROTATION_VECTOR) {
      SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
      val yaw = MapCompassHeading.headingDeg(rotationMatrix, 0f)
      if (!yaw.isFinite()) return
      lastGameYaw = yaw
      captureLock()
      val out = outputHeading() ?: return
      emitIfNeeded(out, lastAccuracy)
      return
    }
    if (
      type != Sensor.TYPE_ROTATION_VECTOR &&
      type != Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR
    ) {
      return
    }
    SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
    val heading = MapCompassHeading.headingDeg(rotationMatrix, declinationDeg)
    if (!heading.isFinite()) return
    lastRvDeg = heading
    lastAccuracy = headingAccuracyStatus(event)
    if (wantLock) {
      val blended = blend(heading)
      captureLock()
      val out = outputHeading() ?: blended
      emitIfNeeded(out, lastAccuracy)
      return
    }
    val blended = blend(heading)
    emitIfNeeded(blended, lastAccuracy)
  }

  override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit

  /**
   * JS erwartet Android 0–3, −1 = unbekannt.
   * TYPE_ROTATION_VECTOR values[4] = Heading-Fehler in Radiant (API 18+).
   * event.accuracy (SENSOR_STATUS) bleibt auf vielen Geräten dauerhaft 0/1
   * und darf nicht als „jetzt Acht machen“ gelten.
   */
  private fun headingAccuracyStatus(event: SensorEvent): Int {
    if (event.values.size >= 5) {
      val errRad = event.values[4]
      if (errRad.isFinite() && errRad >= 0f) {
        val deg = Math.toDegrees(errRad.toDouble())
        return when {
          deg <= 15.0 -> 3
          deg <= 35.0 -> 2
          deg <= 60.0 -> 1
          else -> 0
        }
      }
    }
    return -1
  }

  private fun blend(raw: Double): Double {
    val prev = smoothedDeg
    val now = SystemClock.elapsedRealtime()
    if (prev == null || lastSampleAt == 0L) {
      smoothedDeg = raw
      lastSampleAt = now
      return raw
    }
    val dt = ((now - lastSampleAt).coerceIn(4L, 48L)) / 1000.0
    lastSampleAt = now
    var d = raw - prev
    if (d > 180) d -= 360
    if (d < -180) d += 360
    val rate = abs(d) / dt
    val a = when {
      rate > 50 -> 0.94
      rate > 18 -> 0.82
      else -> 0.70
    }
    val next = (prev + a * d + 360.0) % 360.0
    smoothedDeg = next
    return next
  }

  private fun emitIfNeeded(deg: Double, accuracy: Int) {
    val now = SystemClock.elapsedRealtime()
    val last = lastEmittedDeg
    if (last != null) {
      var d = deg - last
      if (d > 180) d -= 360
      if (d < -180) d += 360
      // Nadel läuft auf der GL-Karte via setNativeProps — JS nicht mit 50 Hz füttern.
      if (abs(d) < 0.35 && now - lastEmitAt < 48) return
    }
    if (now - lastEmitAt < 32 && last != null) return
    lastEmitAt = now
    lastEmittedDeg = deg
    if (!reactContext.hasActiveReactInstance()) return
    val payload = Arguments.createMap()
    payload.putDouble("deg", deg)
    payload.putInt("accuracy", accuracy)
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("FindusMapCompassHeading", payload)
  }

  override fun invalidate() {
    reactContext.removeLifecycleEventListener(this)
    UiThreadUtil.runOnUiThread { stopListening() }
    super.invalidate()
  }
}
