import SwiftUI

/// Hypo's primary action treatment.
public struct HypoPrimaryButtonStyle: ButtonStyle {
    @Environment(\.hypoAppearance) private var appearance

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(appearance.background)
            .frame(minHeight: HypoTheme.Accessibility.primaryActionHeight)
            .padding(.horizontal, HypoTheme.Space.four)
            .background(
                configuration.isPressed
                    ? appearance.accent.opacity(0.78)
                    : appearance.accent,
                in: RoundedRectangle(cornerRadius: HypoTheme.Radius.regular)
            )
            .contentShape(Rectangle())
    }
}

/// Hypo's bordered secondary-action treatment.
public struct HypoSecondaryButtonStyle: ButtonStyle {
    @Environment(\.hypoAppearance) private var appearance

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(appearance.text)
            .frame(minHeight: HypoTheme.Accessibility.primaryActionHeight)
            .padding(.horizontal, HypoTheme.Space.four)
            .background(
                configuration.isPressed ? appearance.surface : .clear,
                in: RoundedRectangle(cornerRadius: HypoTheme.Radius.regular)
            )
            .overlay {
                RoundedRectangle(cornerRadius: HypoTheme.Radius.regular)
                    .stroke(appearance.border, lineWidth: 1)
            }
            .contentShape(Rectangle())
    }
}

/// A raised instrument panel for controls or readings.
public struct InstrumentPanel<Content: View>: View {
    @Environment(\.hypoAppearance) private var appearance

    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        content
            .padding(HypoTheme.Space.four)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(appearance.surface)
            .clipShape(RoundedRectangle(cornerRadius: HypoTheme.Radius.large))
            .overlay {
                RoundedRectangle(cornerRadius: HypoTheme.Radius.large)
                    .stroke(appearance.border, lineWidth: 1)
            }
    }
}

/// A compact title treatment shared by the app shell and extensions.
public struct HypoWordmark: View {
    @Environment(\.hypoAppearance) private var appearance

    public init() {}

    public var body: some View {
        HStack(spacing: HypoTheme.Space.one) {
            Text("Hypo")
                .font(.system(.title2, design: .rounded, weight: .bold))
            Circle()
                .fill(appearance.accent)
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Hypo")
    }
}

/// A temporary leaf-feature surface used while feature packages come online.
public struct FeaturePlaceholder: View {
    @Environment(\.hypoAppearance) private var appearance

    private let title: String
    private let systemImage: String
    private let detail: String

    public init(title: String, systemImage: String, detail: String) {
        self.title = title
        self.systemImage = systemImage
        self.detail = detail
    }

    public var body: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                Label(title, systemImage: systemImage)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(appearance.text)
                Text(detail)
                    .font(.body)
                    .foregroundStyle(appearance.muted)
            }
        }
    }
}
