import SwiftUI

/// The text-size cases captured by the design-system reference gallery.
public enum HypoComponentGalleryTextSize: String, CaseIterable, Sendable {
    case standard
    case accessibility

    public var dynamicTypeSize: DynamicTypeSize {
        switch self {
        case .standard:
            .large
        case .accessibility:
            .accessibility5
        }
    }
}

/// A stable component-gallery configuration used by previews and snapshot evidence.
public struct HypoComponentGalleryScene: Identifiable, Equatable, Sendable {
    public let appearance: HypoAppearance
    public let textSize: HypoComponentGalleryTextSize

    public init(appearance: HypoAppearance, textSize: HypoComponentGalleryTextSize) {
        self.appearance = appearance
        self.textSize = textSize
    }

    public var id: String {
        appearance.snapshotName + "-" + textSize.rawValue
    }

    public var viewport: CGSize {
        switch textSize {
        case .standard:
            CGSize(width: 390, height: 1_180)
        case .accessibility:
            CGSize(width: 390, height: 1_450)
        }
    }

    public static let snapshots = HypoAppearance.allCases.flatMap { appearance in
        HypoComponentGalleryTextSize.allCases.map { textSize in
            HypoComponentGalleryScene(appearance: appearance, textSize: textSize)
        }
    }
}

extension HypoAppearance {
    public var snapshotName: String {
        switch self {
        case .standard:
            "standard"
        case .darkroom:
            "darkroom"
        }
    }
}

/// A fixed-state gallery of the controls and surfaces shared by Hypo features.
///
/// The gallery is intentionally data-free. Its stable scenes support visual review without
/// requiring an account, network connection, camera, or haptic hardware.
public struct HypoComponentGallery: View {
    private let scene: HypoComponentGalleryScene

    public init(scene: HypoComponentGalleryScene) {
        self.scene = scene
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.five) {
            galleryHeader
            actionPanel
            FeaturePlaceholder(
                title: "Meter ready",
                systemImage: "camera.metering.center.weighted",
                detail: "Aim at the subject, then hold the reading."
            )
            controlGallery
            statePanel
            Spacer(minLength: 0)
        }
        .padding(HypoTheme.Space.four)
        .frame(width: scene.viewport.width, height: scene.viewport.height)
        .background(scene.appearance.background)
        .hypoAppearance(scene.appearance)
        .environment(\.dynamicTypeSize, scene.textSize.dynamicTypeSize)
        .preferredColorScheme(.dark)
    }

    private var galleryHeader: some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
            HypoWordmark()
            Text("COMPONENT REFERENCE · " + scene.appearance.snapshotName.uppercased())
                .font(.caption.monospaced().weight(.semibold))
                .foregroundStyle(scene.appearance.muted)
        }
    }

    private var actionPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                Text("ACTIONS")
                    .font(.caption.monospaced().weight(.semibold))
                    .foregroundStyle(scene.appearance.muted)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: HypoTheme.Space.three) {
                        primaryAction
                        secondaryAction
                    }
                    VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                        primaryAction
                        secondaryAction
                    }
                }
            }
        }
    }

    private var primaryAction: some View {
        Button("Save reading") {}
            .buttonStyle(HypoPrimaryButtonStyle())
    }

    private var secondaryAction: some View {
        Button("Review details") {}
            .buttonStyle(HypoSecondaryButtonStyle())
    }

    private var controlGallery: some View {
        VStack(spacing: HypoTheme.Space.five) {
            ApertureDial(selection: .constant(3))
            ExposureNeedle(value: .constant(1), label: "Meter difference")
                .frame(height: scene.textSize == .accessibility ? 132 : 92)
        }
    }

    private var statePanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                Text("STATES")
                    .font(.caption.monospaced().weight(.semibold))
                    .foregroundStyle(scene.appearance.muted)
                stateRow(
                    "Saved locally",
                    systemImage: "checkmark.circle.fill",
                    color: HypoTheme.ColorToken.success
                )
                stateRow(
                    "Waiting to sync",
                    systemImage: "arrow.triangle.2.circlepath",
                    color: HypoTheme.ColorToken.accent
                )
                stateRow(
                    "Review required",
                    systemImage: "exclamationmark.triangle.fill",
                    color: HypoTheme.ColorToken.danger
                )
            }
        }
    }

    private func stateRow(
        _ label: String,
        systemImage: String,
        color: Color
    ) -> some View {
        Label(label, systemImage: systemImage)
            .font(.body.weight(.medium))
            .foregroundStyle(color)
            .frame(minHeight: HypoTheme.Accessibility.minimumTouchTarget)
    }
}

#Preview("Component gallery — standard") {
    HypoComponentGallery(
        scene: HypoComponentGalleryScene(appearance: .standard, textSize: .standard)
    )
}

#Preview("Component gallery — darkroom accessibility") {
    HypoComponentGallery(
        scene: HypoComponentGalleryScene(appearance: .darkroom, textSize: .accessibility)
    )
}
