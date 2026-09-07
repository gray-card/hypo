import Testing

@testable import DesignSystem

@Suite("Hypo error presentation")
struct HypoErrorTests {
    @Test("Authentication errors preserve local work and offer sign-in")
    func authenticationPresentation() {
        let presentation = HypoErrorPresenter.presentation(for: .authenticationExpired)

        #expect(presentation.recoveryAction == .signIn)
        #expect(presentation.message.contains("Local changes remain"))
        #expect(presentation.code == "AUTH-EXPIRED")
    }

    @Test("Conflict recovery retains the record URI")
    func conflictPresentation() {
        let uri = "at://did:plc:test/app.graycard.instance.exposure/frame-1"
        let presentation = HypoErrorPresenter.presentation(for: .conflict(recordURI: uri))

        #expect(presentation.recoveryAction == .reviewConflict(recordURI: uri))
    }

    @Test("Validation errors display their specific message")
    func validationPresentation() {
        let presentation = HypoErrorPresenter.presentation(
            for: .validation(message: "Loaded must not be after unloaded.")
        )

        #expect(presentation.message == "Loaded must not be after unloaded.")
        #expect(presentation.recoveryLabel == nil)
    }

    @Test("Every semantic failure produces useful copy without reflected implementation details")
    func completeFailureVocabulary() {
        let failures: [HypoError] = [
            .authenticationRequired, .authenticationExpired, .networkUnavailable,
            .conflict(recordURI: "at://did:plc:test/app.graycard.test/1"),
            .validation(message: "Choose a valid value."), .cameraPermissionDenied,
            .locationPermissionDenied, .locationUnavailable, .cameraUnavailable,
            .measurementUnavailable,
            .calibrationUnavailable, .calibrationStorageUnavailable, .meterHistoryUnavailable,
            .meterSaveRequiresSignIn, .meterSaveUnavailable, .meterPromotionUnavailable,
            .privateDataUnavailable, .privateCloudUnavailable(localCopyExists: true),
            .privateCloudUnavailable(localCopyExists: false), .libraryUnavailable,
            .librarySaveRequiresSignIn, .librarySaveUnavailable, .frameHistoryUnavailable,
            .exposureSaveUnavailable, .recipeUnavailable, .timerStorageUnavailable,
            .developmentSaveRequiresSignIn, .developmentSaveUnavailable,
            .syncStatusUnavailable, .localStorageUnavailable,
            .permissionDenied(capability: "Photos"),
            .unsupported(message: "This device does not support the feature."), .unexpected,
        ]

        for failure in failures {
            let presentation = HypoErrorPresenter.presentation(for: failure)
            #expect(!presentation.code.isEmpty)
            #expect(!presentation.title.isEmpty)
            #expect(!presentation.message.isEmpty)
            #expect(!presentation.message.contains("Optional("))
            #expect(!presentation.message.contains("Error Domain="))
            #expect(!presentation.message.contains("localizedDescription"))
        }
    }
}
