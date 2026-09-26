import Foundation
import SwiftUI

/// A single detent on an exposure dial.
public struct ExposureDialMark: Identifiable, Equatable, Hashable, Sendable {
    public let id: String
    public let displayValue: String
    public let accessibilityValue: String

    public init(id: String, displayValue: String, accessibilityValue: String) {
        self.id = id
        self.displayValue = displayValue
        self.accessibilityValue = accessibilityValue
    }
}

/// The semantic purpose of an exposure dial.
public enum ExposureDialKind: String, CaseIterable, Sendable {
    case aperture
    case shutterSpeed
    case iso
    case exposureCompensation

    public var title: String {
        switch self {
        case .aperture: "Aperture"
        case .shutterSpeed: "Shutter speed"
        case .iso: "ISO"
        case .exposureCompensation: "Exposure compensation"
        }
    }

    public var accessibilityHint: String {
        "Swipe up or down to change " + title.lowercased() + "."
    }

    public var defaultScale: ExposureDialScale {
        switch self {
        case .aperture: .aperture
        case .shutterSpeed: .shutterSpeed
        case .iso: .iso
        case .exposureCompensation: .exposureCompensation
        }
    }
}

/// An ordered set of exposure values with deterministic boundary behavior.
public struct ExposureDialScale: Equatable, Sendable {
    public let marks: [ExposureDialMark]

    public init(marks: [ExposureDialMark]) {
        precondition(!marks.isEmpty, "An exposure dial requires at least one mark.")
        self.marks = marks
    }

    public func clampedIndex(_ index: Int) -> Int {
        min(max(index, marks.startIndex), marks.index(before: marks.endIndex))
    }

    public func index(after index: Int) -> Int {
        clampedIndex(clampedIndex(index) + 1)
    }

    public func index(before index: Int) -> Int {
        clampedIndex(clampedIndex(index) - 1)
    }

    public func mark(at index: Int) -> ExposureDialMark {
        marks[clampedIndex(index)]
    }

    public static let aperture = ExposureDialScale(
        marks: [
            .init(id: "1", displayValue: "f/1", accessibilityValue: "f 1"),
            .init(id: "1.4", displayValue: "f/1.4", accessibilityValue: "f 1.4"),
            .init(id: "2", displayValue: "f/2", accessibilityValue: "f 2"),
            .init(id: "2.8", displayValue: "f/2.8", accessibilityValue: "f 2.8"),
            .init(id: "4", displayValue: "f/4", accessibilityValue: "f 4"),
            .init(id: "5.6", displayValue: "f/5.6", accessibilityValue: "f 5.6"),
            .init(id: "8", displayValue: "f/8", accessibilityValue: "f 8"),
            .init(id: "11", displayValue: "f/11", accessibilityValue: "f 11"),
            .init(id: "16", displayValue: "f/16", accessibilityValue: "f 16"),
            .init(id: "22", displayValue: "f/22", accessibilityValue: "f 22"),
            .init(id: "32", displayValue: "f/32", accessibilityValue: "f 32"),
        ]
    )

    public static let shutterSpeed = ExposureDialScale(
        marks: [
            .init(id: "1/1000", displayValue: "1/1000", accessibilityValue: "1 over 1000 second"),
            .init(id: "1/500", displayValue: "1/500", accessibilityValue: "1 over 500 second"),
            .init(id: "1/250", displayValue: "1/250", accessibilityValue: "1 over 250 second"),
            .init(id: "1/125", displayValue: "1/125", accessibilityValue: "1 over 125 second"),
            .init(id: "1/60", displayValue: "1/60", accessibilityValue: "1 over 60 second"),
            .init(id: "1/30", displayValue: "1/30", accessibilityValue: "1 over 30 second"),
            .init(id: "1/15", displayValue: "1/15", accessibilityValue: "1 over 15 second"),
            .init(id: "1/8", displayValue: "1/8", accessibilityValue: "1 over 8 second"),
            .init(id: "1/4", displayValue: "1/4", accessibilityValue: "1 over 4 second"),
            .init(id: "1/2", displayValue: "1/2", accessibilityValue: "1 half second"),
            .init(id: "1", displayValue: "1s", accessibilityValue: "1 second"),
            .init(id: "2", displayValue: "2s", accessibilityValue: "2 seconds"),
            .init(id: "4", displayValue: "4s", accessibilityValue: "4 seconds"),
        ]
    )

    public static let iso = ExposureDialScale(
        marks: [25, 50, 100, 200, 400, 800, 1_600, 3_200, 6_400].map { value in
            ExposureDialMark(
                id: String(value),
                displayValue: "ISO \(value)",
                accessibilityValue: "ISO \(value)"
            )
        }
    )

    public static let exposureCompensation = ExposureDialScale(
        marks: [
            .init(id: "-3", displayValue: "−3", accessibilityValue: "minus 3 EV"),
            .init(id: "-2", displayValue: "−2", accessibilityValue: "minus 2 EV"),
            .init(id: "-1", displayValue: "−1", accessibilityValue: "minus 1 EV"),
            .init(id: "0", displayValue: "0", accessibilityValue: "0 EV"),
            .init(id: "+1", displayValue: "+1", accessibilityValue: "plus 1 EV"),
            .init(id: "+2", displayValue: "+2", accessibilityValue: "plus 2 EV"),
            .init(id: "+3", displayValue: "+3", accessibilityValue: "plus 3 EV"),
        ]
    )
}

/// A stable description of a dial's assistive-technology presentation.
public struct ExposureControlAccessibility: Equatable, Sendable {
    public let label: String
    public let value: String
    public let hint: String

    public init(kind: ExposureDialKind, scale: ExposureDialScale, selection: Int) {
        label = kind.title
        value = scale.mark(at: selection).accessibilityValue
        hint = kind.accessibilityHint
    }
}

/// Geometry limits that keep exposure controls usable across Dynamic Type sizes.
public enum ExposureControlMetrics {
    public static let baseDialDiameter: CGFloat = 168
    public static let maximumDialDiameter: CGFloat = 224

    public static func dialDiameter(for scaledDiameter: CGFloat) -> CGFloat {
        min(
            max(scaledDiameter, HypoTheme.Accessibility.minimumTouchTarget),
            maximumDialDiameter
        )
    }
}

/// A touch- and VoiceOver-adjustable exposure dial.
public struct ExposureDial: View {
    @Binding private var selection: Int
    @Environment(\.hypoAppearance) private var appearance
    @ScaledMetric(relativeTo: .body) private var scaledDiameter: CGFloat =
        ExposureControlMetrics.baseDialDiameter

    private let kind: ExposureDialKind
    private let scale: ExposureDialScale
    private let haptics: any HypoHapticPlaying

    public init(
        _ kind: ExposureDialKind,
        selection: Binding<Int>,
        scale: ExposureDialScale? = nil,
        haptics: any HypoHapticPlaying = SystemHypoHaptics.shared
    ) {
        self.kind = kind
        _selection = selection
        self.scale = scale ?? kind.defaultScale
        self.haptics = haptics
    }

    public var body: some View {
        let selectedMark = scale.mark(at: selection)
        let accessibility = ExposureControlAccessibility(
            kind: kind,
            scale: scale,
            selection: selection
        )

        VStack(spacing: HypoTheme.Space.three) {
            Text(kind.title)
                .font(.headline)
                .foregroundStyle(appearance.muted)

            dialFace(selectedMark: selectedMark)
                .frame(width: diameter, height: diameter)

            ViewThatFits(in: .horizontal) {
                compactSelectionControls(selectedMark: selectedMark)
                accessibilitySelectionControls(selectedMark: selectedMark)
            }
        }
        .padding(HypoTheme.Space.four)
        .background(appearance.surface, in: RoundedRectangle(cornerRadius: HypoTheme.Radius.large))
        .overlay {
            RoundedRectangle(cornerRadius: HypoTheme.Radius.large)
                .stroke(appearance.border, lineWidth: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibility.label)
        .accessibilityValue(accessibility.value)
        .accessibilityHint(accessibility.hint)
        .accessibilityAdjustableAction { direction in
            adjust(direction)
        }
        .accessibilityAction(named: "Increase \(kind.title.lowercased())") {
            adjust(.increment)
        }
        .accessibilityAction(named: "Decrease \(kind.title.lowercased())") {
            adjust(.decrement)
        }
    }

    private var diameter: CGFloat {
        ExposureControlMetrics.dialDiameter(for: scaledDiameter)
    }

    private var dialRotation: Angle {
        guard scale.marks.count > 1 else { return .degrees(-135) }
        let progress = Double(scale.clampedIndex(selection)) / Double(scale.marks.count - 1)
        return .degrees(-135 + (270 * progress))
    }

    private func dialFace(selectedMark: ExposureDialMark) -> some View {
        ZStack {
            Circle()
                .fill(appearance.background)
            Circle()
                .stroke(appearance.border, lineWidth: 2)

            ForEach(scale.marks.indices, id: \.self) { index in
                Capsule()
                    .fill(index == scale.clampedIndex(selection) ? appearance.accent : appearance.muted)
                    .frame(width: index == scale.clampedIndex(selection) ? 3 : 2, height: 10)
                    .offset(y: -(diameter / 2) + 13)
                    .rotationEffect(markRotation(index))
            }

            Capsule()
                .fill(appearance.accent)
                .frame(width: 4, height: diameter * 0.31)
                .offset(y: -(diameter * 0.16))
                .rotationEffect(dialRotation)
                .shadow(color: appearance.accent.opacity(0.35), radius: 4)

            Circle()
                .fill(appearance.accent)
                .frame(width: diameter * 0.13, height: diameter * 0.13)

            Text(selectedMark.displayValue)
                .font(.system(.caption, design: .rounded, weight: .bold))
                .foregroundStyle(appearance.text)
                .offset(y: diameter * 0.30)
        }
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    selectMark(at: value.location)
                }
        )
        .accessibilityHidden(true)
    }

    private func markRotation(_ index: Int) -> Angle {
        guard scale.marks.count > 1 else { return .degrees(-135) }
        let progress = Double(index) / Double(scale.marks.count - 1)
        return .degrees(-135 + (270 * progress))
    }

    private func adjustmentButton(
        systemImage: String,
        direction: AccessibilityAdjustmentDirection
    ) -> some View {
        Button {
            adjust(direction)
        } label: {
            Image(systemName: systemImage)
                .font(.headline)
                .frame(
                    minWidth: HypoTheme.Accessibility.minimumTouchTarget,
                    minHeight: HypoTheme.Accessibility.minimumTouchTarget
                )
                .background(appearance.background, in: Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(appearance.accent)
        .disabled(
            direction == .increment
                ? scale.clampedIndex(selection) == scale.marks.index(before: scale.marks.endIndex)
                : scale.clampedIndex(selection) == scale.marks.startIndex
        )
        .accessibilityLabel(
            (direction == .increment ? "Increase " : "Decrease ")
                + kind.title.lowercased()
        )
    }

    private func compactSelectionControls(selectedMark: ExposureDialMark) -> some View {
        HStack(spacing: HypoTheme.Space.three) {
            adjustmentButton(systemImage: "minus", direction: .decrement)
            selectionLabel(selectedMark, fixedSize: true)
            adjustmentButton(systemImage: "plus", direction: .increment)
        }
    }

    private func accessibilitySelectionControls(selectedMark: ExposureDialMark) -> some View {
        VStack(spacing: HypoTheme.Space.two) {
            selectionLabel(selectedMark, fixedSize: false)
            HStack(spacing: HypoTheme.Space.four) {
                adjustmentButton(systemImage: "minus", direction: .decrement)
                adjustmentButton(systemImage: "plus", direction: .increment)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func selectionLabel(_ mark: ExposureDialMark, fixedSize: Bool) -> some View {
        Text(mark.displayValue)
            .font(.system(.title2, design: .rounded, weight: .semibold))
            .foregroundStyle(appearance.text)
            .lineLimit(fixedSize ? 1 : nil)
            .fixedSize(horizontal: fixedSize, vertical: false)
            .frame(maxWidth: .infinity)
    }

    private func adjust(_ direction: AccessibilityAdjustmentDirection) {
        let newSelection: Int
        switch direction {
        case .increment:
            newSelection = scale.index(after: selection)
        case .decrement:
            newSelection = scale.index(before: selection)
        @unknown default:
            return
        }
        setSelection(newSelection)
    }

    private func selectMark(at location: CGPoint) {
        let center = CGPoint(x: diameter / 2, y: diameter / 2)
        let radians = atan2(location.y - center.y, location.x - center.x)
        var degrees = (radians * 180 / .pi) + 90
        if degrees < -135 {
            degrees += 360
        }
        let progress = min(max((degrees + 135) / 270, 0), 1)
        let index = Int((progress * Double(scale.marks.count - 1)).rounded())
        setSelection(index)
    }

    private func setSelection(_ newSelection: Int) {
        let clamped = scale.clampedIndex(newSelection)
        guard clamped != selection else { return }
        selection = clamped
        haptics.play(.dialDetent)
    }
}

/// An aperture-specific exposure dial.
public struct ApertureDial: View {
    @Binding private var selection: Int
    private let scale: ExposureDialScale
    private let haptics: any HypoHapticPlaying

    public init(
        selection: Binding<Int>,
        scale: ExposureDialScale = .aperture,
        haptics: any HypoHapticPlaying = SystemHypoHaptics.shared
    ) {
        _selection = selection
        self.scale = scale
        self.haptics = haptics
    }

    public var body: some View {
        ExposureDial(.aperture, selection: $selection, scale: scale, haptics: haptics)
    }
}

/// A shutter-speed-specific exposure dial.
public struct ShutterSpeedDial: View {
    @Binding private var selection: Int
    private let scale: ExposureDialScale
    private let haptics: any HypoHapticPlaying

    public init(
        selection: Binding<Int>,
        scale: ExposureDialScale = .shutterSpeed,
        haptics: any HypoHapticPlaying = SystemHypoHaptics.shared
    ) {
        _selection = selection
        self.scale = scale
        self.haptics = haptics
    }

    public var body: some View {
        ExposureDial(.shutterSpeed, selection: $selection, scale: scale, haptics: haptics)
    }
}

/// An ISO-specific exposure dial.
public struct ISODial: View {
    @Binding private var selection: Int
    private let scale: ExposureDialScale
    private let haptics: any HypoHapticPlaying

    public init(
        selection: Binding<Int>,
        scale: ExposureDialScale = .iso,
        haptics: any HypoHapticPlaying = SystemHypoHaptics.shared
    ) {
        _selection = selection
        self.scale = scale
        self.haptics = haptics
    }

    public var body: some View {
        ExposureDial(.iso, selection: $selection, scale: scale, haptics: haptics)
    }
}

/// An exposure-compensation-specific dial.
public struct EVCompensationDial: View {
    @Binding private var selection: Int
    private let scale: ExposureDialScale
    private let haptics: any HypoHapticPlaying

    public init(
        selection: Binding<Int>,
        scale: ExposureDialScale = .exposureCompensation,
        haptics: any HypoHapticPlaying = SystemHypoHaptics.shared
    ) {
        _selection = selection
        self.scale = scale
        self.haptics = haptics
    }

    public var body: some View {
        ExposureDial(.exposureCompensation, selection: $selection, scale: scale, haptics: haptics)
    }
}

/// A linear exposure meter needle that supports touch and VoiceOver adjustment.
public struct ExposureNeedle: View {
    @Binding private var value: Double
    @Environment(\.hypoAppearance) private var appearance

    private let range: ClosedRange<Double>
    private let step: Double
    private let label: String
    private let haptics: any HypoHapticPlaying

    public init(
        value: Binding<Double>,
        range: ClosedRange<Double> = -3...3,
        step: Double = 1.0 / 3.0,
        label: String = "Exposure value",
        haptics: any HypoHapticPlaying = SystemHypoHaptics.shared
    ) {
        precondition(range.lowerBound < range.upperBound)
        precondition(step > 0)
        _value = value
        self.range = range
        self.step = step
        self.label = label
        self.haptics = haptics
    }

    public var body: some View {
        let displayedValue = scale.clampedValue(value)

        VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
            ViewThatFits(in: .horizontal) {
                HStack {
                    needleLabel
                    Spacer()
                    needleValue(displayedValue)
                }

                VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                    needleLabel
                    needleValue(displayedValue)
                }
            }

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(appearance.border)
                        .frame(height: 4)
                    Rectangle()
                        .fill(appearance.accent)
                        .frame(width: 3, height: 36)
                        .offset(x: needleOffset(width: proxy.size.width) - 1.5)
                }
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { gesture in
                            selectValue(at: gesture.location.x, width: proxy.size.width)
                        }
                )
            }
            .frame(minHeight: HypoTheme.Accessibility.minimumTouchTarget)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(Self.accessibilityValue(displayedValue))
        .accessibilityHint("Swipe up or down to adjust the reading.")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: setValue(value + step)
            case .decrement: setValue(value - step)
            @unknown default: break
            }
        }
        .accessibilityAction(named: "Increase \(label.lowercased())") {
            setValue(value + step)
        }
        .accessibilityAction(named: "Decrease \(label.lowercased())") {
            setValue(value - step)
        }
    }

    private var needleLabel: some View {
        Text(label)
            .font(.headline)
    }

    private func needleValue(_ displayedValue: Double) -> some View {
        Text(Self.accessibilityValue(displayedValue))
            .font(.system(.body, design: .monospaced, weight: .semibold))
            .foregroundStyle(appearance.accent)
            .fixedSize(horizontal: true, vertical: false)
    }

    nonisolated public static func accessibilityValue(_ value: Double) -> String {
        if abs(value) < 0.000_1 {
            return "0 EV"
        }
        let sign = value > 0 ? "plus" : "minus"
        return sign
            + " "
            + String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), abs(value))
            + " EV"
    }

    private func needleOffset(width: CGFloat) -> CGFloat {
        width * CGFloat(scale.progress(for: value))
    }

    private func selectValue(at xPosition: CGFloat, width: CGFloat) {
        guard width > 0 else { return }
        setValue(scale.value(at: Double(xPosition / width)))
    }

    private func setValue(_ newValue: Double) {
        let clamped = scale.clampedValue(newValue)
        guard abs(clamped - value) > 0.000_1 else { return }
        value = clamped
        haptics.play(.dialDetent)
    }

    private var scale: ExposureNeedleScale {
        ExposureNeedleScale(range: range, step: step)
    }
}

/// Deterministic value and geometry behavior shared by touch and assistive adjustment.
public struct ExposureNeedleScale: Equatable, Sendable {
    public let range: ClosedRange<Double>
    public let step: Double

    public init(range: ClosedRange<Double>, step: Double) {
        precondition(range.lowerBound < range.upperBound)
        precondition(step > 0)
        self.range = range
        self.step = step
    }

    public func clampedValue(_ candidate: Double) -> Double {
        min(max(candidate, range.lowerBound), range.upperBound)
    }

    public func progress(for candidate: Double) -> Double {
        (clampedValue(candidate) - range.lowerBound) / (range.upperBound - range.lowerBound)
    }

    public func value(at progress: Double) -> Double {
        let clampedProgress = min(max(progress, 0), 1)
        let rawValue =
            range.lowerBound
            + clampedProgress * (range.upperBound - range.lowerBound)
        return clampedValue((rawValue / step).rounded() * step)
    }
}

#Preview("Exposure controls") {
    @Previewable @State var aperture = 3
    @Previewable @State var shutter = 4
    @Previewable @State var iso = 2
    @Previewable @State var compensation = 3
    @Previewable @State var exposureValue = 0.0

    ScrollView {
        LazyVGrid(columns: [.init(.adaptive(minimum: 190))], spacing: HypoTheme.Space.five) {
            ApertureDial(selection: $aperture)
            ShutterSpeedDial(selection: $shutter)
            ISODial(selection: $iso)
            EVCompensationDial(selection: $compensation)
            ExposureNeedle(value: $exposureValue)
        }
        .padding()
    }
    .background(HypoAppearance.standard.background)
    .hypoAppearance(.standard)
}

#Preview("Darkroom controls") {
    @Previewable @State var shutter = 4

    ExposureDial(.shutterSpeed, selection: $shutter)
        .padding()
        .darkroomTreatment()
}
