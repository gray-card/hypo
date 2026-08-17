import Testing

@testable import DesignSystem

@Test("Semantic haptic cues retain their intended patterns")
func hapticVocabulary() {
    #expect(HypoHapticCue.selectionChanged.pattern == .selection)
    #expect(HypoHapticCue.dialDetent.pattern == .lightImpact)
    #expect(HypoHapticCue.timerStage.pattern == .lightImpact)
    #expect(HypoHapticCue.actionSucceeded.pattern == .success)
    #expect(HypoHapticCue.timerCompleted.pattern == .success)
    #expect(HypoHapticCue.warning.pattern == .warning)
    #expect(HypoHapticCue.failure.pattern == .error)
}

@Test("Every haptic cue has a stable raw value")
func hapticCueIdentifiers() {
    #expect(Set(HypoHapticCue.allCases.map(\.rawValue)).count == HypoHapticCue.allCases.count)
}
