import Foundation
import MeterEngine
import PhotometryKit

let identity = CalibrationIdentity(
    deviceModel: "iPhone fixture",
    cameraID: "fixture-wide",
    module: .wide,
    sensorPath: .processed
)
let observations = [
    CalibrationObservation(
        measuredEV100: ExposureValue(8.2),
        referenceEV100: ExposureValue(8.0)
    ),
    CalibrationObservation(
        measuredEV100: ExposureValue(12.1),
        referenceEV100: ExposureValue(12.0)
    ),
]

let profile = try CalibrationBuilder.constantOffsetProfile(
    identity: identity,
    reference: .handheldMeter,
    observations: observations,
    createdAt: Date()
)
