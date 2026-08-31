package de.findus.app

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.sqrt

/**
 * Blickrichtung für die Karten-Nadel — wie Google Maps.
 *
 * Unabhängig von Display-Rotation (App ist Portrait-locked).
 * Flach: Oberkante (+Y). Aufrecht: durchs Display (-Z, wohin man schaut).
 * Dazwischen weich gemischt, damit die Nadel in der Hand nicht 90° kippt.
 *
 * R = Rotation-Vector, Gerät → Welt (X Ost, Y magnetisch Nord, Z Himmel).
 */
object MapCompassHeading {
  fun headingDeg(r: FloatArray, declinationDeg: Float): Double {
    if (r.size < 9) return Double.NaN
    val zUp = r[8]
    val upright = (1f - abs(zUp)).coerceIn(0f, 1f)
    val t = smoothstep(0.18f, 0.62f, upright)
    var dx = 0f
    var dy = 1f - t
    var dz = -t
    val len = sqrt(dx * dx + dy * dy + dz * dz)
    if (len < 1e-6f) return Double.NaN
    dx /= len
    dy /= len
    dz /= len
    val worldEast = r[0] * dx + r[1] * dy + r[2] * dz
    val worldNorth = r[3] * dx + r[4] * dy + r[5] * dz
    if (!worldEast.isFinite() || !worldNorth.isFinite()) return Double.NaN
    if (abs(worldEast) < 1e-8f && abs(worldNorth) < 1e-8f) return Double.NaN
    var heading = Math.toDegrees(atan2(worldEast.toDouble(), worldNorth.toDouble()))
    heading += declinationDeg
    return ((heading % 360.0) + 360.0) % 360.0
  }

  private fun smoothstep(edge0: Float, edge1: Float, x: Float): Float {
    if (x <= edge0) return 0f
    if (x >= edge1) return 1f
    val t = ((x - edge0) / (edge1 - edge0)).coerceIn(0f, 1f)
    return t * t * (3f - 2f * t)
  }
}
