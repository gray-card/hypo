import Testing

@testable import DesignSystem

@Suite("Hypo error presentation")
struct HypoErrorTests {
    @Test("Authentication errors preserve local work and offer sign-in")
    func authenticationPresentation() {
        let presentation = HypoErrorPresenter.presentation(for: .authenticationExpired)

        #expect(presentation.recoveryAction == .signIn)
        #expect(presentation.message.contains("Local changes remain"))
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
}
