/**
 * iOS FindusDeviceAudio — Lock + Headset-Route (Parität zu Android FindusDeviceAudioModule).
 * Expo-Module, nur iOS (Android bleibt im App-Kotlin).
 */

import ExpoModulesCore
import AVFoundation
import UIKit

public class FindusDeviceAudioModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FindusDeviceAudio")

    AsyncFunction("getSpeechRouteState") { () -> [String: Any] in
      let locked = Self.isDeviceLocked()
      let external = Self.hasExternalAudioRoute()
      return [
        "deviceLocked": locked,
        "hasExternalAudio": external,
        "keyguardLocked": locked,
        "screenInteractive": UIApplication.shared.applicationState == .active,
      ]
    }

    AsyncFunction("getTorchState") { () -> Bool in
      Self.isTorchOn()
    }

    AsyncFunction("setTorch") { (enabled: Bool) -> Bool in
      try Self.setTorch(enabled)
      return enabled
    }
  }

  /// Locked: Protected Data unavailable (Passcode lock) oder App nicht active + kein Screen.
  private static func isDeviceLocked() -> Bool {
    if !UIApplication.shared.isProtectedDataAvailable {
      return true
    }
    // Screen off / locked: protected data often still available briefly —
    // treat background without external audio as locked for pocket-speaker policy
    // (JS layer also uses AppState; this mirrors Android keyguard+interactive).
    if UIApplication.shared.applicationState != .active {
      // Not hard-locked if protected data is available — return false here;
      // JS AppState handles background. Only true lock when protected data gone.
      return false
    }
    return false
  }

  private static func hasExternalAudioRoute() -> Bool {
    let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
    for o in outputs {
      switch o.portType {
      case .headphones,
           .bluetoothA2DP,
           .bluetoothHFP,
           .bluetoothLE,
           .headsetMic,
           .carAudio,
           .airPlay:
        return true
      default:
        continue
      }
    }
    return false
  }

  private static func torchDevice() -> AVCaptureDevice? {
    AVCaptureDevice.default(for: .video)
  }

  private static func isTorchOn() -> Bool {
    guard let d = torchDevice(), d.hasTorch else { return false }
    return d.torchMode == .on
  }

  private static func setTorch(_ enabled: Bool) throws {
    guard let d = torchDevice(), d.hasTorch else {
      throw NSError(
        domain: "FindusDeviceAudio",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "No flash unit on this device"]
      )
    }
    try d.lockForConfiguration()
    defer { d.unlockForConfiguration() }
    if enabled {
      try d.setTorchModeOn(level: 1.0)
    } else {
      d.torchMode = .off
    }
  }
}
