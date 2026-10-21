import ExpoModulesCore
import CoreLocation
import Photos
import CoreMotion

public final class AmberPermissionsModule: Module {
  private lazy var location = AmberLocationPermission()
  private let health = AmberHealthReader()
  private let motion = CMMotionActivityManager()

  public func definition() -> ModuleDefinition {
    Name("AmberPermissions")
    AsyncFunction("healthSummary") { (promise: Promise) in self.health.summary(promise) }.runOnQueue(.main)
    AsyncFunction("getStatus") { (kind: String, promise: Promise) in
      self.status(kind, promise: promise)
    }.runOnQueue(.main)
    AsyncFunction("request") { (kind: String, promise: Promise) in
      self.request(kind, promise: promise)
    }.runOnQueue(.main)
  }


  private func status(_ kind: String, promise: Promise) {
    switch kind {
    case "location": promise.resolve(location.status)
    case "photos": promise.resolve(photoStatus(PHPhotoLibrary.authorizationStatus(for: .readWrite)))
    case "fitness":
      promise.resolve(CMMotionActivityManager.isActivityAvailable() ? motionStatus() : "unavailable")
    case "health": health.status(promise)
    default: promise.reject("UNKNOWN_PERMISSION", "Unknown Apple permission.")
    }
  }

  private func request(_ kind: String, promise: Promise) {
    if kind == "health" { health.request(promise); return }
    let keys = ["location": "NSLocationWhenInUseUsageDescription", "photos": "NSPhotoLibraryUsageDescription", "fitness": "NSMotionUsageDescription"]
    guard let key = keys[kind], let purpose = Bundle.main.object(forInfoDictionaryKey: key) as? String, !purpose.isEmpty else {
      promise.reject("PERMISSION_CONFIGURATION", "This permission requires an updated Amber build.")
      return
    }
    switch kind {
    case "location": location.request(promise)
    case "photos":
      PHPhotoLibrary.requestAuthorization(for: .readWrite) { result in
        promise.resolve(self.photoStatus(result))
      }
    case "health": promise.resolve("unavailable")
    case "fitness":
      guard CMMotionActivityManager.isActivityAvailable() else { promise.resolve("unavailable"); return }
      if CMMotionActivityManager.authorizationStatus() != .notDetermined {
        promise.resolve(motionStatus()); return
      }
      let now = Date()
      // A zero-width query triggers Apple's request without collecting activity history.
      motion.queryActivityStarting(from: now, to: now, to: .main) { _, error in
        let status = self.motionStatus()
        if status == "notDetermined", let error { promise.reject("FITNESS_REQUEST", error.localizedDescription); return }
        promise.resolve(status)
      }
    default: promise.reject("UNKNOWN_PERMISSION", "Unknown Apple permission.")
    }
  }

  private func photoStatus(_ status: PHAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "granted"
    case .limited: return "limited"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "notDetermined"
    }
  }

  private func motionStatus() -> String {
    switch CMMotionActivityManager.authorizationStatus() {
    case .authorized: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "notDetermined"
    }
  }
}

private final class AmberLocationPermission: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private var pending: Promise?
  override init() {
    super.init()
    manager.delegate = self
  }
  var status: String {
    guard CLLocationManager.locationServicesEnabled() else { return "restricted" }
    switch manager.authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "notDetermined"
    }
  }
  func request(_ promise: Promise) {
    guard pending == nil else { promise.reject("PERMISSION_BUSY", "A location request is already open."); return }
    guard status == "notDetermined" else { promise.resolve(status); return }
    pending = promise
    manager.requestWhenInUseAuthorization()
  }
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard manager.authorizationStatus != .notDetermined else { return }
    pending?.resolve(status)
    pending = nil
  }
}

import HealthKit

final class AmberHealthReader {
  private let store = HKHealthStore()
  private var types: Set<HKObjectType> { [HKObjectType.quantityType(forIdentifier: .stepCount)!, HKObjectType.workoutType()] }
  func status(_ promise: Promise) {
    guard HKHealthStore.isHealthDataAvailable() else { promise.resolve("unavailable"); return }
    store.getRequestStatusForAuthorization(toShare: [], read: types) { status, error in
      if let error { promise.reject("HEALTH_STATUS", error.localizedDescription); return }
      // HealthKit deliberately never discloses whether read access was granted.
      promise.resolve(status == .unnecessary ? "reviewed" : "notDetermined")
    }
  }
  func request(_ promise: Promise) {
    guard HKHealthStore.isHealthDataAvailable() else { promise.resolve("unavailable"); return }
    store.requestAuthorization(toShare: [], read: types) { completed, error in
      if let error { promise.reject("HEALTH_REQUEST", error.localizedDescription); return }
      promise.resolve(completed ? "reviewed" : "notDetermined")
    }
  }
  func summary(_ promise: Promise) {
    guard HKHealthStore.isHealthDataAvailable() else { promise.reject("HEALTH_UNAVAILABLE", "Health is unavailable on this device."); return }
    let start = Calendar.current.startOfDay(for: Date())
    let end = Date()
    let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
    let steps = HKStatisticsQuery(quantityType: HKQuantityType.quantityType(forIdentifier: .stepCount)!, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, result, error in
      if let error { promise.reject("HEALTH_READ", error.localizedDescription); return }
      let count = result?.sumQuantity()?.doubleValue(for: .count())
      let workouts = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: 100, sortDescriptors: nil) { _, samples, error in
        if let error { promise.reject("HEALTH_READ", error.localizedDescription); return }
        let minutes = (samples as? [HKWorkout] ?? []).reduce(0.0) { $0 + $1.duration / 60 }
        var output: [String: Any] = ["from": ISO8601DateFormatter().string(from: start), "to": ISO8601DateFormatter().string(from: end)]
        if let count { output["steps"] = Int(count) }
        if let samples, !samples.isEmpty { output["workoutMinutes"] = Int(minutes) }
        promise.resolve(output)
      }
      self.store.execute(workouts)
    }
    store.execute(steps)
  }
}
