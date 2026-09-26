import Testing

@testable import DesignSystem

@Suite("Exposure controls")
struct ExposureControlsTests {
    @Test("Every exposure control has a nonempty scale and spoken value")
    func defaultScalesAreAccessible() {
        for kind in ExposureDialKind.allCases {
            let scale = kind.defaultScale
            let accessibility = ExposureControlAccessibility(kind: kind, scale: scale, selection: 0)

            #expect(!scale.marks.isEmpty)
            #expect(!accessibility.label.isEmpty)
            #expect(!accessibility.value.isEmpty)
            #expect(accessibility.hint.contains(kind.title.lowercased()))
        }
    }

    @Test("Dial adjustment stops at both boundaries")
    func scaleClampsAdjustments() {
        let scale = ExposureDialScale.exposureCompensation

        #expect(scale.index(before: 0) == 0)
        #expect(scale.index(after: scale.marks.count - 1) == scale.marks.count - 1)
        #expect(scale.index(after: 2) == 3)
        #expect(scale.index(before: 4) == 3)
    }

    @Test("Out-of-range selections expose the nearest valid value")
    func scaleClampsAccessibilityValue() {
        let low = ExposureControlAccessibility(
            kind: .iso,
            scale: .iso,
            selection: -10
        )
        let high = ExposureControlAccessibility(
            kind: .iso,
            scale: .iso,
            selection: 10_000
        )

        #expect(low.value == "ISO 25")
        #expect(high.value == "ISO 6400")
    }

    @Test("Needle values use stable VoiceOver wording")
    func needleAccessibilityValues() {
        #expect(ExposureNeedle.accessibilityValue(0) == "0 EV")
        #expect(ExposureNeedle.accessibilityValue(1.25) == "plus 1.2 EV")
        #expect(ExposureNeedle.accessibilityValue(-2.0) == "minus 2.0 EV")
    }

    @Test("Needle adjustment and touch progress clamp to the configured range")
    func needleScaleClampsValues() {
        let scale = ExposureNeedleScale(range: -3...3, step: 1.0 / 3.0)

        #expect(scale.clampedValue(-10) == -3)
        #expect(scale.clampedValue(10) == 3)
        #expect(scale.progress(for: -10) == 0)
        #expect(scale.progress(for: 10) == 1)
        #expect(scale.value(at: -1) == -3)
        #expect(scale.value(at: 2) == 3)
        #expect(abs(scale.value(at: 0.5)) < 0.000_1)
    }

    @Test("Dial geometry remains bounded as Dynamic Type scales the control")
    func dialGeometryBounds() {
        #expect(
            ExposureControlMetrics.dialDiameter(for: 10)
                == HypoTheme.Accessibility.minimumTouchTarget
        )
        #expect(
            ExposureControlMetrics.dialDiameter(for: 10_000)
                == ExposureControlMetrics.maximumDialDiameter
        )
        #expect(
            ExposureControlMetrics.dialDiameter(
                for: ExposureControlMetrics.baseDialDiameter
            ) == ExposureControlMetrics.baseDialDiameter
        )
    }
}
