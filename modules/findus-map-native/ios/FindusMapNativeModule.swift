/**
 * iOS: off-thread map JSON parse + CLLocationManager compass (Parität Android).
 */

import ExpoModulesCore
import CoreLocation

public class FindusMapNativeModule: Module, CLLocationManagerDelegate {
  private var locationManager: CLLocationManager?
  private var smoothedDeg: Double?
  private var lastEmitAt: TimeInterval = 0
  private var lastEmittedDeg: Double?
  private var wantLock = false
  private var locked = false
  private var lockTrueDeg: Double?

  public func definition() -> ModuleDefinition {
    Name("FindusMapNative")

    Events("FindusMapCompassHeading")

    AsyncFunction("parseMapExtractFile") { (filePath: String) -> String in
      try await Self.parseFileOffMain(filePath)
    }

    AsyncFunction("startCompass") { () -> Bool in
      await MainActor.run {
        self.startCompassInternal()
      }
      return self.locationManager != nil
    }

    AsyncFunction("stopCompass") {
      await MainActor.run {
        self.stopCompassInternal()
      }
    }

    AsyncFunction("resetCompass") {
      await MainActor.run {
        self.wantLock = false
        self.locked = false
        self.lockTrueDeg = nil
        self.smoothedDeg = nil
      }
    }

    AsyncFunction("lockCompass") {
      await MainActor.run {
        self.wantLock = true
        if let d = self.smoothedDeg {
          self.locked = true
          self.lockTrueDeg = d
        }
      }
    }

    AsyncFunction("unlockCompass") {
      await MainActor.run {
        self.wantLock = false
        self.locked = false
        self.lockTrueDeg = nil
      }
    }

    AsyncFunction("nudgeCompass") { (courseDeg: Double) in
      await MainActor.run {
        guard self.locked, self.wantLock else { return }
        self.lockTrueDeg = courseDeg.truncatingRemainder(dividingBy: 360)
        if self.lockTrueDeg! < 0 { self.lockTrueDeg! += 360 }
      }
    }

    Function("setCompassFix") { (_ lat: Double, _ lng: Double, _ altM: Double) in
      /* iOS trueHeading needs location for calibration context */
    }
  }

  private static func parseFileOffMain(_ path: String) async throws -> String {
    try await withCheckedThrowingContinuation { cont in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let url = URL(fileURLWithPath: path)
          let data = try Data(contentsOf: url)
          guard let str = String(data: data, encoding: .utf8) else {
            cont.resume(throwing: NSError(domain: "FindusMapNative", code: 1))
            return
          }
          cont.resume(returning: str)
        } catch {
          cont.resume(throwing: error)
        }
      }
    }
  }

  @MainActor
  private func startCompassInternal() {
    if locationManager != nil { return }
    let mgr = CLLocationManager()
    mgr.delegate = self
    mgr.headingFilter = 1
    if CLLocationManager.headingAvailable() {
      mgr.startUpdatingHeading()
    }
    if CLLocationManager.locationServicesEnabled() {
      mgr.requestWhenInUseAuthorization()
      mgr.startUpdatingLocation()
    }
    locationManager = mgr
  }

  @MainActor
  private func stopCompassInternal() {
    locationManager?.stopUpdatingHeading()
    locationManager?.stopUpdatingLocation()
    locationManager?.delegate = nil
    locationManager = nil
  }

  public func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
    guard newHeading.trueHeading >= 0 || newHeading.magneticHeading >= 0 else { return }
    var deg = newHeading.trueHeading
    if deg < 0 { deg = newHeading.magneticHeading }
    if locked, wantLock, let lock = lockTrueDeg {
      deg = lock
    } else {
      if let prev = smoothedDeg {
        var delta = deg - prev
        if delta > 180 { delta -= 360 }
        if delta < -180 { delta += 360 }
        deg = prev + delta * 0.22
      }
      if deg < 0 { deg += 360 }
      if deg >= 360 { deg -= 360 }
      smoothedDeg = deg
      if wantLock && !locked {
        locked = true
        lockTrueDeg = deg
      }
    }
    let now = Date().timeIntervalSince1970
    if let last = lastEmittedDeg {
      var d = abs(deg - last)
      if d > 180 { d = 360 - d }
      if d < 1.2 && now - lastEmitAt < 0.05 { return }
    }
    lastEmitAt = now
    lastEmittedDeg = deg
    sendEvent("FindusMapCompassHeading", [
      "deg": deg,
      "accuracy": newHeading.headingAccuracy,
    ])
  }

  public func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool {
    true
  }
}
