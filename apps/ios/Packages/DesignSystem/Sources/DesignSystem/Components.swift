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

/// A consistent, nearby failure state with an explicit recovery action when one is available.
public struct HypoErrorNotice: View {
    @Environment(\.hypoAppearance) private var appearance

    private let presentation: HypoErrorPresentation
    private let onRecovery: (() -> Void)?
    private let onDismiss: (() -> Void)?

    public init(
        _ presentation: HypoErrorPresentation,
        onRecovery: (() -> Void)? = nil,
        onDismiss: (() -> Void)? = nil
    ) {
        self.presentation = presentation
        self.onRecovery = onRecovery
        self.onDismiss = onDismiss
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
            HStack(alignment: .top, spacing: HypoTheme.Space.three) {
                Image(systemName: icon)
                    .foregroundStyle(tint)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                    Text(presentation.title)
                        .font(.headline)
                        .foregroundStyle(appearance.text)
                    Text(presentation.message)
                        .font(.footnote)
                        .foregroundStyle(appearance.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                if let onDismiss {
                    Button(action: onDismiss) {
                        Image(systemName: "xmark")
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Dismiss \(presentation.title.lowercased())")
                }
            }

            if let label = presentation.recoveryLabel, let onRecovery {
                Button(label, action: onRecovery)
                    .buttonStyle(.bordered)
                    .tint(tint)
                    .frame(minHeight: 44)
                    .accessibilityHint(presentation.message)
            }
        }
        .padding(HypoTheme.Space.three)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.09))
        .clipShape(RoundedRectangle(cornerRadius: HypoTheme.Radius.regular))
        .overlay {
            RoundedRectangle(cornerRadius: HypoTheme.Radius.regular)
                .stroke(tint.opacity(0.45), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("hypo-error-\(presentation.code.lowercased())")
    }

    private var tint: Color {
        presentation.severity == .warning ? appearance.accent : HypoTheme.ColorToken.danger
    }

    private var icon: String {
        presentation.severity == .warning
            ? "exclamationmark.circle.fill" : "exclamationmark.triangle.fill"
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

/// Hypo's wordmark with the inset required when it appears inside a toolbar group.
public struct HypoToolbarWordmark: View {
    public init() {}

    public var body: some View {
        HypoWordmark()
            .padding(.leading, HypoTheme.Space.two)
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
