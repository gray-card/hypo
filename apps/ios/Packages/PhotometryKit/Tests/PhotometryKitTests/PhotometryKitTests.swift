import XCTest
@testable import PhotometryKit

final class PhotometryKitTests: XCTestCase {
    private let epsilon = 1e-10

    func testStopsRoundTripFactorsAndStepGrids() throws {
        for value in stride(from: -12.0, through: 12.0, by: 0.125) {
            let stops = Stops(value)
            XCTAssertEqual(try Stops(exposureFactor: stops.exposureFactor).rawValue, value, accuracy: epsilon)
        }

        XCTAssertEqual(StopStep.third.rounded(Stops(0.49)).rawValue, 1.0 / 3.0, accuracy: epsilon)
        XCTAssertEqual(StopStep.half.rounded(Stops(0.49)).rawValue, 0.5, accuracy: epsilon)
        XCTAssertEqual(StopStep.whole.rounded(Stops(0.51)).rawValue, 1, accuracy: epsilon)
    }

    func testIlluminanceAndLuminanceUnitRoundTrips() throws {
        for value in [0.001, 1, 12.5, 100, 10_000] {
            let incident = try Illuminance(value, unit: .footCandle)
            XCTAssertEqual(incident.value(in: .footCandle), value, accuracy: epsilon)

            let reflected = try Luminance(value, unit: .footLambert)
            XCTAssertEqual(reflected.value(in: .footLambert), value, accuracy: epsilon)
        }
    }

    func testConventionalISO2720GoldenValues() throws {
        XCTAssertEqual(try ExposureMath.ev100(from: Illuminance(lux: 2.5)).rawValue, 0, accuracy: epsilon)
        XCTAssertEqual(try ExposureMath.ev100(from: Illuminance(lux: 2_560)).rawValue, 10, accuracy: epsilon)
        XCTAssertEqual(
            try ExposureMath.ev100(from: Luminance(candelaPerSquareMetre: 0.125)).rawValue,
            0,
            accuracy: epsilon
        )
        XCTAssertEqual(
            try ExposureMath.ev100(from: Luminance(candelaPerSquareMetre: 128)).rawValue,
            10,
            accuracy: epsilon
        )
    }

    func testPhotometricEVRoundTripsAcrossWideRange() throws {
        for ev in stride(from: -8.0, through: 24.0, by: 0.25) {
            let value = ExposureValue(ev)
            let illuminance = try ExposureMath.illuminance(fromEV100: value)
            XCTAssertEqual(try ExposureMath.ev100(from: illuminance).rawValue, ev, accuracy: epsilon)

            let luminance = try ExposureMath.luminance(fromEV100: value)
            XCTAssertEqual(try ExposureMath.ev100(from: luminance).rawValue, ev, accuracy: epsilon)
        }
    }

    func testExposureTriangleGoldenAndSolverRoundTrips() throws {
        let aperture = try Aperture(16)
        let duration = try ExposureDuration(seconds: 1 / 125)
        let iso100 = try Sensitivity(iso: 100)
        let ev = ExposureMath.ev100(aperture: aperture, duration: duration, sensitivity: iso100)
        XCTAssertEqual(ev.rawValue, Foundation.log2(32_000), accuracy: epsilon)

        XCTAssertEqual(
            try ExposureMath.aperture(forEV100: ev, duration: duration, sensitivity: iso100).rawValue,
            aperture.rawValue,
            accuracy: epsilon
        )
        XCTAssertEqual(
            try ExposureMath.duration(forEV100: ev, aperture: aperture, sensitivity: iso100).seconds,
            duration.seconds,
            accuracy: epsilon
        )
        XCTAssertEqual(
            try ExposureMath.sensitivity(forEV100: ev, aperture: aperture, duration: duration).iso,
            100,
            accuracy: epsilon
        )
    }

    func testExposureSolverPropertyGrid() throws {
        for fNumber in [1.0, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22] {
            for seconds in [1.0 / 8_000, 1.0 / 125, 1, 30] {
                for iso in [25.0, 100, 400, 3_200] {
                    let aperture = try Aperture(fNumber)
                    let duration = try ExposureDuration(seconds: seconds)
                    let sensitivity = try Sensitivity(iso: iso)
                    let ev = ExposureMath.ev100(
                        aperture: aperture,
                        duration: duration,
                        sensitivity: sensitivity
                    )
                    XCTAssertEqual(
                        try ExposureMath.aperture(
                            forEV100: ev,
                            duration: duration,
                            sensitivity: sensitivity
                        ).rawValue,
                        fNumber,
                        accuracy: 1e-9
                    )
                    XCTAssertEqual(
                        try ExposureMath.duration(
                            forEV100: ev,
                            aperture: aperture,
                            sensitivity: sensitivity
                        ).seconds,
                        seconds,
                        accuracy: max(1e-12, seconds * 1e-10)
                    )
                }
            }
        }
    }

    func testStopShiftsAndRounding() throws {
        XCTAssertEqual(
            try ExposureMath.shifted(Aperture(8), by: Stops(1)).rawValue, 5.656_854_249, accuracy: 1e-9)
        XCTAssertEqual(try ExposureMath.shifted(ExposureDuration(seconds: 0.5), by: Stops(2)).seconds, 2)
        XCTAssertEqual(try ExposureMath.shifted(Sensitivity(iso: 100), by: Stops(3)).iso, 800)

        XCTAssertEqual(
            try ExposureMath.rounded(Aperture(5.7), to: .whole).rawValue, 5.656_854_249, accuracy: 1e-9)
        XCTAssertEqual(
            try ExposureMath.rounded(ExposureDuration(seconds: 1 / 110), to: .whole).seconds, 1 / 128.0)
        XCTAssertEqual(try ExposureMath.rounded(Sensitivity(iso: 360), to: .whole).iso, 400)
    }

    func testCineMathGoldenAndRoundTrip() throws {
        let frameRate = try FrameRate(framesPerSecond: 24)
        let angle = try ShutterAngle(degrees: 180)
        let duration = try CineMath.exposureDuration(angle: angle, frameRate: frameRate)
        XCTAssertEqual(duration.seconds, 1 / 48.0, accuracy: epsilon)
        XCTAssertEqual(
            try CineMath.shutterAngle(duration: duration, frameRate: frameRate).degrees, 180,
            accuracy: epsilon)
        XCTAssertEqual(
            try CineMath.frameRate(duration: duration, angle: angle).framesPerSecond, 24, accuracy: epsilon)

        let cineEV = try CineMath.ev100(
            aperture: Aperture(4),
            angle: angle,
            frameRate: frameRate,
            sensitivity: Sensitivity(iso: 800)
        )
        XCTAssertEqual(cineEV.rawValue, Foundation.log2(16 * 48) - 3, accuracy: epsilon)
    }

    func testReciprocityModelsAndCorrectionStops() throws {
        let tenSeconds = try ExposureDuration(seconds: 10)
        let power = try ReciprocityModel.validatedPower(exponent: 1.3)
        XCTAssertEqual(try power.corrected(tenSeconds).seconds, Foundation.pow(10, 1.3), accuracy: 1e-10)

        let schwarzschild = try ReciprocityModel.validatedSchwarzschild(coefficient: 0.5)
        XCTAssertEqual(
            try schwarzschild.corrected(ExposureDuration(seconds: 4)).seconds, 16, accuracy: epsilon)
        XCTAssertEqual(
            try schwarzschild.correctionStops(for: ExposureDuration(seconds: 4)).rawValue,
            2,
            accuracy: epsilon
        )

        let table = try ReciprocityModel.validatedTable([
            ReciprocityPoint(meteredSeconds: 1, correctedSeconds: 1),
            ReciprocityPoint(meteredSeconds: 10, correctedSeconds: 20),
            ReciprocityPoint(meteredSeconds: 100, correctedSeconds: 400),
        ])
        XCTAssertEqual(try table.corrected(ExposureDuration(seconds: 10)).seconds, 20, accuracy: epsilon)
        XCTAssertEqual(
            try table.corrected(ExposureDuration(seconds: Foundation.sqrt(10))).seconds,
            Foundation.sqrt(20),
            accuracy: 1e-10
        )
    }

    func testZonePlacementAndContrastMath() throws {
        let zoneIII = try Zone(3)
        XCTAssertEqual(ZoneMath.exposureCompensation(to: zoneIII).rawValue, -2)
        XCTAssertEqual(ZoneMath.placedExposureValue(reading: ExposureValue(10), on: zoneIII).rawValue, 12)
        XCTAssertEqual(try ZoneMath.contrastRatio(for: Stops(8)), 256)
        XCTAssertEqual(try ZoneMath.contrastRange(forRatio: 256).rawValue, 8)
        XCTAssertEqual(ZoneMath.excessContrast(sceneRange: Stops(10), mediumRange: Stops(7)).rawValue, 3)
        XCTAssertEqual(ZoneMath.excessContrast(sceneRange: Stops(5), mediumRange: Stops(7)), .zero)
    }

    func testFlashGuideNumberPowerAndInverseSquareMath() throws {
        let guideNumber = try GuideNumber(metresAtISO100: 32)
        XCTAssertEqual(
            try FlashMath.aperture(guideNumber: guideNumber, distanceMetres: 4).rawValue,
            8,
            accuracy: epsilon
        )
        XCTAssertEqual(
            try FlashMath.aperture(
                guideNumber: guideNumber,
                distanceMetres: 4,
                sensitivity: Sensitivity(iso: 400)
            ).rawValue,
            16,
            accuracy: epsilon
        )
        XCTAssertEqual(
            try FlashMath.distanceMetres(guideNumber: guideNumber, aperture: Aperture(8)),
            4,
            accuracy: epsilon
        )
        XCTAssertEqual(
            try FlashMath.combinedGuideNumber([guideNumber, guideNumber]).metresAtISO100,
            32 * Foundation.sqrt(2),
            accuracy: epsilon
        )
        XCTAssertEqual(try FlashMath.powerFraction(forReduction: Stops(3)), 0.125)
        XCTAssertEqual(try FlashMath.reductionStops(forPowerFraction: 0.125).rawValue, 3)
        XCTAssertEqual(try FlashMath.relativeIlluminance(fromMetres: 2, toMetres: 4), 0.25)
    }

    func testFilterFactorTransmissionDensityAndStackRoundTrips() throws {
        for factor in [1.0, 2, 4, 8, 64, 1_000] {
            let filter = try FilterCompensation(factor: factor)
            XCTAssertEqual(
                try FilterCompensation(transmission: filter.transmission).factor, factor, accuracy: 1e-10)
            XCTAssertEqual(
                try FilterCompensation(opticalDensity: filter.opticalDensity).factor, factor, accuracy: 1e-9)
        }

        let threeStops = try FilterCompensation(factor: 8)
        XCTAssertEqual(threeStops.stops.rawValue, 3)
        XCTAssertEqual(try threeStops.corrected(ExposureDuration(seconds: 1 / 8)).seconds, 1)

        let stack = try FilterCompensation.combined([
            FilterCompensation(factor: 2),
            FilterCompensation(factor: 4),
        ])
        XCTAssertEqual(stack.factor, 8)
        XCTAssertEqual(stack.stops.rawValue, 3)
    }

    func testPhysicalDomainValidation() throws {
        XCTAssertThrowsError(try Aperture(0))
        XCTAssertThrowsError(try ExposureDuration(seconds: -1))
        XCTAssertThrowsError(try Sensitivity(iso: .infinity))
        XCTAssertThrowsError(try ShutterAngle(degrees: 361))
        XCTAssertThrowsError(try FrameRate(framesPerSecond: 0))
        XCTAssertThrowsError(try Stops(exposureFactor: 0))
        XCTAssertThrowsError(try Zone(11))
        XCTAssertThrowsError(try FilterCompensation(transmission: 1.1))
        XCTAssertThrowsError(try FlashMath.powerFraction(forReduction: Stops(-1)))
        XCTAssertThrowsError(
            try ReciprocityModel.validatedTable([
                ReciprocityPoint(meteredSeconds: 1, correctedSeconds: 1)
            ]))
    }
}
