import SwiftUI

public struct HypoSRGBColor: Equatable, Sendable {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    public var color: Color {
        Color(red: red, green: green, blue: blue)
    }

    public var cssHex: String {
        let components = [red, green, blue].map { component in
            Int((min(max(component, 0), 1) * 255).rounded())
        }
        return String(format: "#%02X%02X%02X", components[0], components[1], components[2])
    }

    func contrastRatio(to other: Self) -> Double {
        let lighter = max(relativeLuminance, other.relativeLuminance)
        let darker = min(relativeLuminance, other.relativeLuminance)
        return (lighter + 0.05) / (darker + 0.05)
    }

    private var relativeLuminance: Double {
        let weights = (red: 0.2126, green: 0.7152, blue: 0.0722)
        return Self.linearized(red) * weights.red
            + Self.linearized(green) * weights.green
            + Self.linearized(blue) * weights.blue
    }

    private static func linearized(_ component: Double) -> Double {
        if component <= 0.03928 {
            return component / 12.92
        }
        return pow((component + 0.055) / 1.055, 2.4)
    }
}

/// Design tokens shared by the native Hypo surfaces.
public enum HypoTheme {
    public enum ColorValue {
        public static let background = HypoSRGBColor(red: 0.086, green: 0.082, blue: 0.075)
        public static let elevated = HypoSRGBColor(red: 0.122, green: 0.114, blue: 0.102)
        public static let surface = HypoSRGBColor(red: 0.153, green: 0.141, blue: 0.125)
        public static let border = HypoSRGBColor(red: 0.450, green: 0.430, blue: 0.390)
        public static let text = HypoSRGBColor(red: 0.937, green: 0.925, blue: 0.898)
        public static let muted = HypoSRGBColor(red: 0.650, green: 0.623, blue: 0.579)
        public static let accent = HypoSRGBColor(red: 0.945, green: 0.565, blue: 0.192)
        public static let danger = HypoSRGBColor(red: 0.950, green: 0.350, blue: 0.280)
        public static let success = HypoSRGBColor(red: 0.360, green: 0.745, blue: 0.475)
        public static let darkroomBackground = HypoSRGBColor(red: 0.025, green: 0.005, blue: 0.004)
        public static let darkroomSurface = HypoSRGBColor(red: 0.070, green: 0.006, blue: 0.004)
        public static let darkroomBorder = HypoSRGBColor(red: 0.750, green: 0.040, blue: 0.020)
        public static let darkroomRed = HypoSRGBColor(red: 0.950, green: 0.080, blue: 0.040)
        public static let darkroomMuted = HypoSRGBColor(red: 0.900, green: 0.200, blue: 0.150)
    }

    public enum ColorToken {
        public static let background = ColorValue.background.color
        public static let elevated = ColorValue.elevated.color
        public static let surface = ColorValue.surface.color
        public static let border = ColorValue.border.color
        public static let text = ColorValue.text.color
        public static let muted = ColorValue.muted.color
        public static let accent = ColorValue.accent.color
        public static let danger = ColorValue.danger.color
        public static let success = ColorValue.success.color
        public static let darkroomBackground = ColorValue.darkroomBackground.color
        public static let darkroomSurface = ColorValue.darkroomSurface.color
        public static let darkroomBorder = ColorValue.darkroomBorder.color
        public static let darkroomRed = ColorValue.darkroomRed.color
        public static let darkroomMuted = ColorValue.darkroomMuted.color
    }

    public enum Accessibility {
        /// Apple's minimum target dimension for a touch control, in points.
        public static let minimumTouchTarget: CGFloat = 44

        /// Hypo's primary actions are slightly taller than the platform minimum.
        public static let primaryActionHeight: CGFloat = 48
    }

    public enum Space {
        public static let one: CGFloat = 4
        public static let two: CGFloat = 8
        public static let three: CGFloat = 12
        public static let four: CGFloat = 16
        public static let five: CGFloat = 24
        public static let six: CGFloat = 32
    }

    public enum Radius {
        public static let small: CGFloat = 7
        public static let regular: CGFloat = 10
        public static let large: CGFloat = 14
    }
}

/// The palettes available to field and darkroom features.
public enum HypoAppearance: Hashable, Sendable, CaseIterable {
    case standard
    case darkroom

    public var background: Color {
        switch self {
        case .standard: HypoTheme.ColorToken.background
        case .darkroom: HypoTheme.ColorToken.darkroomBackground
        }
    }

    public var accent: Color {
        switch self {
        case .standard: HypoTheme.ColorToken.accent
        case .darkroom: HypoTheme.ColorToken.darkroomRed
        }
    }

    public var surface: Color {
        switch self {
        case .standard: HypoTheme.ColorToken.surface
        case .darkroom: HypoTheme.ColorToken.darkroomSurface
        }
    }

    public var border: Color {
        switch self {
        case .standard: HypoTheme.ColorToken.border
        case .darkroom: HypoTheme.ColorToken.darkroomBorder
        }
    }

    public var text: Color {
        switch self {
        case .standard: HypoTheme.ColorToken.text
        case .darkroom: HypoTheme.ColorToken.darkroomRed
        }
    }

    public var muted: Color {
        switch self {
        case .standard: HypoTheme.ColorToken.muted
        case .darkroom: HypoTheme.ColorToken.darkroomMuted
        }
    }
}

private struct HypoAppearanceKey: EnvironmentKey {
    static let defaultValue = HypoAppearance.standard
}

extension EnvironmentValues {
    /// The active field or darkroom palette.
    public var hypoAppearance: HypoAppearance {
        get { self[HypoAppearanceKey.self] }
        set { self[HypoAppearanceKey.self] = newValue }
    }
}

extension View {
    /// Applies a Hypo palette to this view hierarchy.
    public func hypoAppearance(_ appearance: HypoAppearance) -> some View {
        environment(\.hypoAppearance, appearance)
            .tint(appearance.accent)
            .foregroundStyle(appearance.text)
    }

    /// Applies the red-on-black treatment used while handling light-sensitive materials.
    public func darkroomTreatment() -> some View {
        hypoAppearance(.darkroom)
            .preferredColorScheme(.dark)
            .background(HypoAppearance.darkroom.background)
    }
}
