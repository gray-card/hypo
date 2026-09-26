import Testing

@testable import DesignSystem

@Test func appearanceCasesRemainStable() {
    #expect(HypoAppearance.allCases == [.standard, .darkroom])
}

@Test func spacingScaleIsOrdered() {
    #expect(HypoTheme.Space.one < HypoTheme.Space.two)
    #expect(HypoTheme.Space.two < HypoTheme.Space.three)
    #expect(HypoTheme.Space.three < HypoTheme.Space.four)
    #expect(HypoTheme.Space.four < HypoTheme.Space.five)
    #expect(HypoTheme.Space.five < HypoTheme.Space.six)
}

@Test("Text colors meet WCAG AA contrast against their surfaces")
func textContrast() {
    let values = HypoTheme.ColorValue.self

    #expect(values.text.contrastRatio(to: values.background) >= 4.5)
    #expect(values.text.contrastRatio(to: values.surface) >= 4.5)
    #expect(values.muted.contrastRatio(to: values.background) >= 4.5)
    #expect(values.muted.contrastRatio(to: values.surface) >= 4.5)
    #expect(values.accent.contrastRatio(to: values.background) >= 4.5)
    #expect(values.accent.contrastRatio(to: values.surface) >= 4.5)
    #expect(values.danger.contrastRatio(to: values.background) >= 4.5)
    #expect(values.danger.contrastRatio(to: values.surface) >= 4.5)
    #expect(values.success.contrastRatio(to: values.background) >= 4.5)
    #expect(values.success.contrastRatio(to: values.surface) >= 4.5)
    #expect(values.darkroomRed.contrastRatio(to: values.darkroomBackground) >= 4.5)
    #expect(values.darkroomRed.contrastRatio(to: values.darkroomSurface) >= 4.5)
    #expect(values.darkroomMuted.contrastRatio(to: values.darkroomBackground) >= 4.5)
    #expect(values.darkroomMuted.contrastRatio(to: values.darkroomSurface) >= 4.5)
}

@Test("Component boundaries meet non-text contrast")
func componentBoundaryContrast() {
    let values = HypoTheme.ColorValue.self

    #expect(values.border.contrastRatio(to: values.background) >= 3)
    #expect(values.border.contrastRatio(to: values.surface) >= 3)
    #expect(values.darkroomBorder.contrastRatio(to: values.darkroomBackground) >= 3)
    #expect(values.darkroomBorder.contrastRatio(to: values.darkroomSurface) >= 3)
}

@Test("Interaction dimensions meet the platform touch-target minimum")
func interactionDimensions() {
    #expect(HypoTheme.Accessibility.minimumTouchTarget >= 44)
    #expect(
        HypoTheme.Accessibility.primaryActionHeight
            >= HypoTheme.Accessibility.minimumTouchTarget
    )
}
