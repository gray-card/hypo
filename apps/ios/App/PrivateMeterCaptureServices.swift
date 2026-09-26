import AVFoundation
import CloudKit
import CoreLocation
import CoreMotion
import Foundation
import MeterEngine
import MeterFeature
import UIKit

@MainActor
private final class PrivateMeterLocationProvider: NSObject,
    @preconcurrency CLLocationManagerDelegate
{
    struct Snapshot {
        let location: CLLocation
        let headingDegrees: Double?
    }

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<Snapshot, any Error>?
    private var timeoutTask: Task<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func snapshot() async throws -> Snapshot {
        guard continuation == nil else { throw PrivateMeterCaptureError.captureUnavailable }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard !Task.isCancelled else {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                self.continuation = continuation
                timeoutTask = Task { [weak self] in
                    do {
                        // This includes a first-run permission decision and the subsequent fix.
                        // Private collection is detached from public-save confirmation, so a humane
                        // authorization window does not make the meter feel stuck.
                        try await Task.sleep(for: .seconds(30))
                    } catch {
                        return
                    }
                    self?.finish(throwing: PrivateMeterCaptureError.captureUnavailable)
                }
                switch manager.authorizationStatus {
                case .authorizedAlways, .authorizedWhenInUse:
                    requestSnapshot()
                case .notDetermined:
                    manager.requestWhenInUseAuthorization()
                case .denied, .restricted:
                    finish(throwing: PrivateMeterCaptureError.preciseLocationDenied)
                @unknown default:
                    finish(throwing: PrivateMeterCaptureError.preciseLocationDenied)
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.finish(throwing: CancellationError()) }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard continuation != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            requestSnapshot()
        case .denied, .restricted:
            finish(throwing: PrivateMeterCaptureError.preciseLocationDenied)
        case .notDetermined:
            break
        @unknown default:
            finish(throwing: PrivateMeterCaptureError.preciseLocationDenied)
        }
    }

    func locationManager(_: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let heading = manager.heading.flatMap { value in
            let degrees = value.trueHeading >= 0 ? value.trueHeading : value.magneticHeading
            return degrees >= 0 ? degrees : nil
        }
        finish(returning: Snapshot(location: location, headingDegrees: heading))
    }

    func locationManager(_: CLLocationManager, didFailWithError error: any Error) {
        finish(throwing: error)
    }

    private func requestSnapshot() {
        if CLLocationManager.headingAvailable() { manager.startUpdatingHeading() }
        manager.requestLocation()
    }

    private func finish(returning snapshot: Snapshot) {
        timeoutTask?.cancel()
        timeoutTask = nil
        manager.stopUpdatingHeading()
        manager.stopUpdatingLocation()
        let continuation = continuation
        self.continuation = nil
        continuation?.resume(returning: snapshot)
    }

    private func finish(throwing error: any Error) {
        timeoutTask?.cancel()
        timeoutTask = nil
        manager.stopUpdatingHeading()
        manager.stopUpdatingLocation()
        let continuation = continuation
        self.continuation = nil
        continuation?.resume(throwing: error)
    }
}

@MainActor
final class LivePrivateMeterCaptureContextCollector: PrivateMeterCaptureContextCollecting {
    private let motion = CMMotionManager()
    private let locationProvider = PrivateMeterLocationProvider()
    private let modelIdentifier: String

    init(modelIdentifier: String) {
        self.modelIdentifier = modelIdentifier
    }

    func context(
        for reading: Reading,
        publicReadingURI: String,
        includePreciseLocation: Bool
    ) async throws -> PrivateMeterCaptureContext {
        let deviceMotion = await motionSnapshot()
        let locationSnapshot = includePreciseLocation ? try await locationProvider.snapshot() : nil
        let contextCollectedAt = Date()
        let bootedAt = contextCollectedAt.addingTimeInterval(
            -ProcessInfo.processInfo.systemUptime
        )
        let motionSampledAt = deviceMotion.map { bootedAt.addingTimeInterval($0.timestamp) }
        let device = UIDevice.current
        let appVersion =
            Bundle.main.object(
                forInfoDictionaryKey: "CFBundleShortVersionString"
            ) as? String ?? "unknown"

        return PrivateMeterCaptureContext(
            readingID: reading.id,
            publicReadingURI: publicReadingURI,
            capturedAt: reading.takenAt,
            contextCollectedAt: contextCollectedAt,
            motionSampledAt: motionSampledAt,
            device: PrivateMeterDeviceContext(
                modelIdentifier: modelIdentifier,
                operatingSystemVersion: device.systemVersion,
                appVersion: appVersion,
                deviceOrientation: Self.orientationName(device.orientation)
            ),
            camera: Self.cameraContext(for: reading),
            attitude: deviceMotion.map(Self.attitude),
            gravity: deviceMotion.map { Self.vector($0.gravity) },
            userAcceleration: deviceMotion.map { Self.vector($0.userAcceleration) },
            rotationRate: deviceMotion.map { Self.vector($0.rotationRate) },
            magneticField: deviceMotion.map(Self.magneticField),
            headingDegrees: locationSnapshot?.headingDegrees,
            location: locationSnapshot.map(Self.location)
        )
    }

    private func motionSnapshot() async -> CMDeviceMotion? {
        guard motion.isDeviceMotionAvailable else { return nil }
        motion.deviceMotionUpdateInterval = 0.05
        motion.startDeviceMotionUpdates(using: .xArbitraryCorrectedZVertical)
        try? await Task.sleep(for: .milliseconds(100))
        let snapshot = motion.deviceMotion
        motion.stopDeviceMotionUpdates()
        return snapshot
    }

    private static func cameraContext(for reading: Reading) -> PrivateMeterCameraContext {
        let captureDevice = AVCaptureDevice.DiscoverySession(
            deviceTypes: [
                .builtInWideAngleCamera,
                .builtInUltraWideCamera,
                .builtInTelephotoCamera,
                .builtInDualCamera,
                .builtInDualWideCamera,
                .builtInTripleCamera,
                .continuityCamera,
                .external,
            ],
            mediaType: .video,
            position: .unspecified
        ).devices.first { $0.uniqueID == reading.camera.id }

        return PrivateMeterCameraContext(
            uniqueID: reading.camera.id,
            name: reading.camera.name,
            module: reading.camera.module.rawValue,
            sensorPath: reading.sensorPath.rawValue,
            lensPosition: captureDevice.map { Double($0.lensPosition) },
            fieldOfViewDegrees: captureDevice.map { Double($0.activeFormat.videoFieldOfView) }
                ?? reading.camera.horizontalFieldOfViewDegrees
        )
    }

    private static func vector(_ value: CMAcceleration) -> PrivateMeterVector {
        PrivateMeterVector(x: value.x, y: value.y, z: value.z)
    }

    private static func vector(_ value: CMRotationRate) -> PrivateMeterVector {
        PrivateMeterVector(x: value.x, y: value.y, z: value.z)
    }

    private static func attitude(_ motion: CMDeviceMotion) -> PrivateMeterAttitude {
        let attitude = motion.attitude
        return PrivateMeterAttitude(
            rollRadians: attitude.roll,
            pitchRadians: attitude.pitch,
            yawRadians: attitude.yaw,
            quaternionX: attitude.quaternion.x,
            quaternionY: attitude.quaternion.y,
            quaternionZ: attitude.quaternion.z,
            quaternionW: attitude.quaternion.w
        )
    }

    private static func magneticField(_ motion: CMDeviceMotion) -> PrivateMeterMagneticField {
        let field = motion.magneticField
        let accuracy =
            switch field.accuracy {
            case .uncalibrated: "uncalibrated"
            case .low: "low"
            case .medium: "medium"
            case .high: "high"
            @unknown default: "unknown"
            }
        return PrivateMeterMagneticField(
            microtesla: PrivateMeterVector(
                x: field.field.x,
                y: field.field.y,
                z: field.field.z
            ),
            accuracy: accuracy
        )
    }

    private static func location(_ snapshot: PrivateMeterLocationProvider.Snapshot)
        -> PrivateMeterLocation
    {
        let location = snapshot.location
        return PrivateMeterLocation(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            altitudeMetres: location.altitude,
            horizontalAccuracyMetres: location.horizontalAccuracy,
            verticalAccuracyMetres: location.verticalAccuracy,
            speedMetresPerSecond: location.speed >= 0 ? location.speed : nil,
            speedAccuracyMetresPerSecond: location.speedAccuracy >= 0 ? location.speedAccuracy : nil,
            courseDegrees: location.course >= 0 ? location.course : nil,
            courseAccuracyDegrees: location.courseAccuracy >= 0 ? location.courseAccuracy : nil,
            floor: location.floor?.level,
            isSimulated: location.sourceInformation?.isSimulatedBySoftware,
            isProducedByAccessory: location.sourceInformation?.isProducedByAccessory,
            capturedAt: location.timestamp
        )
    }

    private static func orientationName(_ orientation: UIDeviceOrientation) -> String? {
        switch orientation {
        case .portrait: "portrait"
        case .portraitUpsideDown: "portrait-upside-down"
        case .landscapeLeft: "landscape-left"
        case .landscapeRight: "landscape-right"
        case .faceUp: "face-up"
        case .faceDown: "face-down"
        case .unknown: nil
        @unknown default: nil
        }
    }
}

actor CloudKitPrivateMeterCaptureSync: PrivateMeterCaptureCloudSyncing {
    private static let recordType = "PrivateMeterCaptureContextV1"
    private let container: CKContainer
    private let database: CKDatabase

    init(containerIdentifier: String = "iCloud.app.graycard.hypo") {
        let container = CKContainer(identifier: containerIdentifier)
        self.container = container
        database = container.privateCloudDatabase
    }

    func accountIdentifier() async throws -> String {
        try await container.userRecordID().recordName
    }

    func records(expectedAccountIdentifier: String?) async throws
        -> [SealedPrivateMeterCaptureContext]
    {
        try await requireAccount(expectedAccountIdentifier)
        var records: [CKRecord] = []
        var page = try await database.records(
            matching: CKQuery(
                recordType: Self.recordType,
                predicate: NSPredicate(value: true)
            )
        )
        records.append(contentsOf: try Self.successes(page.matchResults))
        while let cursor = page.queryCursor {
            try await requireAccount(expectedAccountIdentifier)
            page = try await database.records(continuingMatchFrom: cursor)
            records.append(contentsOf: try Self.successes(page.matchResults))
        }
        try await requireAccount(expectedAccountIdentifier)
        return try records.map(Self.sealedRecord)
    }

    func save(
        _ value: SealedPrivateMeterCaptureContext,
        expectedAccountIdentifier: String?
    ) async throws {
        let recordID = CKRecord.ID(recordName: value.id.uuidString.lowercased())
        for _ in 0..<4 {
            try await requireAccount(expectedAccountIdentifier)
            let current = try await record(id: recordID)
            if let current,
                !PrivateMeterCaptureCloudConflictPolicy.shouldReplace(
                    existing: try Self.sealedRecord(current),
                    with: value
                )
            {
                return
            }

            let record = current ?? CKRecord(recordType: Self.recordType, recordID: recordID)
            record["envelopeVersion"] = NSNumber(value: value.envelopeVersion)
            record["payload"] = value.encryptedPayload as CKRecordValue
            record["capturedAt"] = value.capturedAt as CKRecordValue
            record["modifiedAt"] = value.modifiedAt as CKRecordValue
            record["isDeleted"] = NSNumber(value: value.isDeleted)
            record["keyFingerprint"] = value.keyFingerprint as CKRecordValue?
            do {
                try await requireAccount(expectedAccountIdentifier)
                let results = try await database.modifyRecords(
                    saving: [record],
                    deleting: [],
                    savePolicy: .ifServerRecordUnchanged,
                    atomically: true
                )
                guard let result = results.saveResults[recordID] else {
                    throw PrivateMeterCaptureError.privateCloudUnavailable(
                        "CloudKit did not return an upsert result."
                    )
                }
                _ = try result.get()
                try await requireAccount(expectedAccountIdentifier)
                return
            } catch let error as CKError where error.code == .serverRecordChanged {
                // Refetch the server change tag and reapply the shared last-write-wins rule.
                continue
            }
        }
        throw PrivateMeterCaptureError.privateCloudUnavailable(
            "The private CloudKit record changed repeatedly while Hypo was saving it."
        )
    }

    func delete(id: UUID, expectedAccountIdentifier: String?) async throws {
        try await requireAccount(expectedAccountIdentifier)
        _ = try await database.deleteRecord(
            withID: CKRecord.ID(recordName: id.uuidString.lowercased())
        )
        try await requireAccount(expectedAccountIdentifier)
    }

    func deleteAll(expectedAccountIdentifier: String?) async throws {
        for record in try await records(expectedAccountIdentifier: expectedAccountIdentifier) {
            try await delete(
                id: record.id,
                expectedAccountIdentifier: expectedAccountIdentifier
            )
        }
    }

    private func requireAccount(_ expected: String?) async throws {
        guard let expected else { return }
        let current = try await accountIdentifier()
        guard current == expected else {
            throw PrivateMeterCaptureError.privateCloudAccountChanged
        }
    }

    private static func successes(
        _ values: [(CKRecord.ID, Result<CKRecord, any Error>)]
    ) throws -> [CKRecord] {
        try values.map { try $0.1.get() }
    }

    private func record(id: CKRecord.ID) async throws -> CKRecord? {
        let results = try await database.records(for: [id])
        guard let result = results[id] else { return nil }
        do {
            return try result.get()
        } catch let error as CKError where error.code == .unknownItem {
            return nil
        }
    }

    private static func sealedRecord(_ record: CKRecord) throws
        -> SealedPrivateMeterCaptureContext
    {
        guard let id = UUID(uuidString: record.recordID.recordName),
            let payload = record["payload"] as? Data,
            let capturedAt = record["capturedAt"] as? Date,
            let modifiedAt = record["modifiedAt"] as? Date
        else {
            throw PrivateMeterCaptureError.corruptLocalStore
        }
        return SealedPrivateMeterCaptureContext(
            envelopeVersion: (record["envelopeVersion"] as? NSNumber)?.intValue ?? 1,
            id: id,
            capturedAt: capturedAt,
            modifiedAt: modifiedAt,
            isDeleted: (record["isDeleted"] as? NSNumber)?.boolValue ?? false,
            keyFingerprint: record["keyFingerprint"] as? String,
            encryptedPayload: payload
        )
    }
}
