import DesignSystem
import Foundation

/// Produces a stable vector reference for each live SwiftUI component-gallery scene.
///
/// The SVG deliberately uses only fixed geometry, text, and design tokens. This makes exact
/// regression checks independent of OS font rasterization while the companion PNG shows the
/// platform rendering produced by the selected Xcode toolchain.
public struct ComponentGalleryReferenceRenderer: Sendable {
    public init() {}

    public func svg(for scene: HypoComponentGalleryScene) -> String {
        let palette = Palette(appearance: scene.appearance)
        let metrics = Metrics(textSize: scene.textSize)
        let width = Int(scene.viewport.width)
        let height = Int(scene.viewport.height)
        let panelWidth = width - 32
        let centerX = width / 2
        let dialCenterY = metrics.dialTop + metrics.dialRadius + 72
        let needleY = metrics.needleTop + metrics.needleHeight - 34
        let stateStartY = metrics.stateTop + 80

        return """
            <?xml version="1.0" encoding="UTF-8"?>
            <svg xmlns="http://www.w3.org/2000/svg" width="\(width)" height="\(height)" viewBox="0 0 \(width) \(height)" role="img" aria-labelledby="title description">
              <title id="title">Hypo component gallery: \(scene.id)</title>
              <desc id="description">Stable reference for shared controls in \(scene.appearance.snapshotName) appearance at \(scene.textSize.rawValue) text size.</desc>
              <rect width="\(width)" height="\(height)" fill="\(palette.background)"/>
              <g font-family="-apple-system, BlinkMacSystemFont, sans-serif" fill="\(palette.text)">
                <text x="16" y="48" font-size="\(metrics.wordmarkSize)" font-weight="700">Hypo</text>
                <circle cx="\(metrics.wordmarkDotX)" cy="39" r="4" fill="\(palette.accent)"/>
                <text x="16" y="75" font-family="ui-monospace, monospace" font-size="\(metrics.captionSize)" font-weight="600" fill="\(palette.muted)">COMPONENT REFERENCE · \(scene.appearance.snapshotName.uppercased())</text>

                <rect x="16" y="96" width="\(panelWidth)" height="\(metrics.actionHeight)" rx="14" fill="\(palette.surface)" stroke="\(palette.border)"/>
                <text x="32" y="\(96 + metrics.panelHeadingOffset)" font-family="ui-monospace, monospace" font-size="\(metrics.captionSize)" font-weight="600" fill="\(palette.muted)">ACTIONS</text>
                \(actionMarkup(palette: palette, metrics: metrics))

                <rect x="16" y="\(metrics.placeholderTop)" width="\(panelWidth)" height="\(metrics.placeholderHeight)" rx="14" fill="\(palette.surface)" stroke="\(palette.border)"/>
                <circle cx="42" cy="\(metrics.placeholderTop + 48)" r="12" fill="none" stroke="\(palette.accent)" stroke-width="3"/>
                <circle cx="42" cy="\(metrics.placeholderTop + 48)" r="3" fill="\(palette.accent)"/>
                <text x="66" y="\(metrics.placeholderTop + 54)" font-size="\(metrics.headingSize)" font-weight="600">Meter ready</text>
                <text x="32" y="\(metrics.placeholderTop + metrics.placeholderDetailOffset)" font-size="\(metrics.bodySize)" fill="\(palette.muted)">Aim at the subject, then hold</text>
                <text x="32" y="\(metrics.placeholderTop + metrics.placeholderDetailOffset + metrics.lineHeight)" font-size="\(metrics.bodySize)" fill="\(palette.muted)">the reading.</text>

                <rect x="16" y="\(metrics.dialTop)" width="\(panelWidth)" height="\(metrics.dialHeight)" rx="14" fill="\(palette.surface)" stroke="\(palette.border)"/>
                <text x="\(centerX)" y="\(metrics.dialTop + 38)" text-anchor="middle" font-size="\(metrics.bodySize)" font-weight="600" fill="\(palette.muted)">Aperture</text>
                <circle cx="\(centerX)" cy="\(dialCenterY)" r="\(metrics.dialRadius)" fill="\(palette.background)" stroke="\(palette.border)" stroke-width="2"/>
                \(dialMarks(centerX: centerX, centerY: dialCenterY, radius: metrics.dialRadius, palette: palette))
                <line x1="\(centerX)" y1="\(dialCenterY)" x2="\(centerX + 44)" y2="\(dialCenterY - 44)" stroke="\(palette.accent)" stroke-width="4" stroke-linecap="round"/>
                <circle cx="\(centerX)" cy="\(dialCenterY)" r="11" fill="\(palette.accent)"/>
                <text x="\(centerX)" y="\(dialCenterY + metrics.dialRadius - 25)" text-anchor="middle" font-family="ui-monospace, monospace" font-size="\(metrics.captionSize)" font-weight="700">f/2.8</text>
                <circle cx="78" cy="\(metrics.dialTop + metrics.dialHeight - 48)" r="22" fill="\(palette.background)"/>
                <text x="78" y="\(metrics.dialTop + metrics.dialHeight - 41)" text-anchor="middle" font-size="24" fill="\(palette.accent)">−</text>
                <text x="\(centerX)" y="\(metrics.dialTop + metrics.dialHeight - 42)" text-anchor="middle" font-size="\(metrics.headingSize)" font-weight="600">f/2.8</text>
                <circle cx="\(width - 78)" cy="\(metrics.dialTop + metrics.dialHeight - 48)" r="22" fill="\(palette.background)"/>
                <text x="\(width - 78)" y="\(metrics.dialTop + metrics.dialHeight - 40)" text-anchor="middle" font-size="24" fill="\(palette.accent)">+</text>

                <rect x="16" y="\(metrics.needleTop)" width="\(panelWidth)" height="\(metrics.needleHeight)" rx="14" fill="\(palette.surface)" stroke="\(palette.border)"/>
                <text x="32" y="\(metrics.needleTop + 44)" font-size="\(metrics.bodySize)" font-weight="600">Meter difference</text>
                <text x="\(width - 32)" y="\(metrics.needleTop + 44)" text-anchor="end" font-family="ui-monospace, monospace" font-size="\(metrics.bodySize)" font-weight="600" fill="\(palette.accent)">plus 1.0 EV</text>
                <line x1="32" y1="\(needleY)" x2="\(width - 32)" y2="\(needleY)" stroke="\(palette.border)" stroke-width="4" stroke-linecap="round"/>
                <line x1="\(centerX + 54)" y1="\(needleY - 18)" x2="\(centerX + 54)" y2="\(needleY + 18)" stroke="\(palette.accent)" stroke-width="3"/>

                <rect x="16" y="\(metrics.stateTop)" width="\(panelWidth)" height="\(metrics.stateHeight)" rx="14" fill="\(palette.surface)" stroke="\(palette.border)"/>
                <text x="32" y="\(metrics.stateTop + metrics.panelHeadingOffset)" font-family="ui-monospace, monospace" font-size="\(metrics.captionSize)" font-weight="600" fill="\(palette.muted)">STATES</text>
                \(stateMarkup(startY: stateStartY, metrics: metrics, palette: palette))
              </g>
            </svg>
            """
    }

    public func fingerprint(for scene: HypoComponentGalleryScene) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in svg(for: scene).utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(format: "%016llx", hash)
    }

    private func actionMarkup(palette: Palette, metrics: Metrics) -> String {
        if metrics.stacksActions {
            return """
                    <rect x="32" y="\(metrics.primaryButtonY)" width="326" height="62" rx="10" fill="\(palette.accent)"/>
                    <text x="195" y="\(metrics.primaryButtonY + 40)" text-anchor="middle" font-size="\(metrics.bodySize)" font-weight="600" fill="\(palette.background)">Save reading</text>
                    <rect x="32" y="\(metrics.primaryButtonY + 78)" width="326" height="62" rx="10" fill="none" stroke="\(palette.border)"/>
                    <text x="195" y="\(metrics.primaryButtonY + 118)" text-anchor="middle" font-size="\(metrics.bodySize)" font-weight="600">Review details</text>
                """
        }
        return """
                <rect x="32" y="\(metrics.primaryButtonY)" width="176" height="52" rx="10" fill="\(palette.accent)"/>
                <text x="120" y="\(metrics.primaryButtonY + 34)" text-anchor="middle" font-size="\(metrics.bodySize)" font-weight="600" fill="\(palette.background)">Save reading</text>
                <rect x="220" y="\(metrics.primaryButtonY)" width="138" height="52" rx="10" fill="none" stroke="\(palette.border)"/>
                <text x="289" y="\(metrics.primaryButtonY + 34)" text-anchor="middle" font-size="\(metrics.bodySize)" font-weight="600">Review details</text>
            """
    }

    private func dialMarks(
        centerX: Int,
        centerY: Int,
        radius: Int,
        palette: Palette
    ) -> String {
        (0..<11).map { index in
            let angle = (-135.0 + Double(index) * 27.0) * .pi / 180
            let outerX = Double(centerX) + sin(angle) * Double(radius - 10)
            let outerY = Double(centerY) - cos(angle) * Double(radius - 10)
            let innerX = Double(centerX) + sin(angle) * Double(radius - 20)
            let innerY = Double(centerY) - cos(angle) * Double(radius - 20)
            let color = index == 3 ? palette.accent : palette.muted
            let strokeWidth = index == 3 ? 3 : 2
            return String(
                format:
                    "<line x1=\"%.1f\" y1=\"%.1f\" x2=\"%.1f\" y2=\"%.1f\" stroke=\"%@\" stroke-width=\"%d\" stroke-linecap=\"round\"/>",
                outerX,
                outerY,
                innerX,
                innerY,
                color,
                strokeWidth
            )
        }.joined(separator: "\n            ")
    }

    private func stateMarkup(startY: Int, metrics: Metrics, palette: Palette) -> String {
        let states = [
            ("✓", "Saved locally", palette.success),
            ("↻", "Waiting to sync", palette.accent),
            ("!", "Review required", palette.danger),
        ]
        return states.enumerated().map { index, state in
            let y = startY + index * metrics.stateRowHeight
            return """
                <circle cx="44" cy="\(y - 6)" r="13" fill="none" stroke="\(state.2)" stroke-width="2"/>
                <text x="44" y="\(y)" text-anchor="middle" font-size="14" font-weight="700" fill="\(state.2)">\(state.0)</text>
                <text x="68" y="\(y)" font-size="\(metrics.bodySize)" font-weight="500" fill="\(state.2)">\(state.1)</text>
                """
        }.joined(separator: "\n            ")
    }
}

private struct Palette: Sendable {
    let background: String
    let surface: String
    let border: String
    let text: String
    let muted: String
    let accent: String
    let danger: String
    let success: String

    init(appearance: HypoAppearance) {
        let values = HypoTheme.ColorValue.self
        danger = values.danger.cssHex
        success = values.success.cssHex
        switch appearance {
        case .standard:
            background = values.background.cssHex
            surface = values.surface.cssHex
            border = values.border.cssHex
            text = values.text.cssHex
            muted = values.muted.cssHex
            accent = values.accent.cssHex
        case .darkroom:
            background = values.darkroomBackground.cssHex
            surface = values.darkroomSurface.cssHex
            border = values.darkroomBorder.cssHex
            text = values.darkroomRed.cssHex
            muted = values.darkroomMuted.cssHex
            accent = values.darkroomRed.cssHex
        }
    }
}

private struct Metrics: Sendable {
    let wordmarkSize: Int
    let wordmarkDotX: Int
    let captionSize: Int
    let headingSize: Int
    let bodySize: Int
    let lineHeight: Int
    let panelHeadingOffset: Int
    let actionHeight: Int
    let primaryButtonY: Int
    let placeholderTop: Int
    let placeholderHeight: Int
    let placeholderDetailOffset: Int
    let dialTop: Int
    let dialHeight: Int
    let dialRadius: Int
    let needleTop: Int
    let needleHeight: Int
    let stateTop: Int
    let stateHeight: Int
    let stateRowHeight: Int
    let stacksActions: Bool

    init(textSize: HypoComponentGalleryTextSize) {
        switch textSize {
        case .standard:
            wordmarkSize = 28
            wordmarkDotX = 83
            captionSize = 12
            headingSize = 21
            bodySize = 17
            lineHeight = 23
            panelHeadingOffset = 34
            actionHeight = 124
            primaryButtonY = 142
            placeholderTop = 236
            placeholderHeight = 148
            placeholderDetailOffset = 91
            dialTop = 408
            dialHeight = 386
            dialRadius = 95
            needleTop = 818
            needleHeight = 128
            stateTop = 970
            stateHeight = 194
            stateRowHeight = 42
            stacksActions = false
        case .accessibility:
            wordmarkSize = 39
            wordmarkDotX = 108
            captionSize = 17
            headingSize = 31
            bodySize = 25
            lineHeight = 34
            panelHeadingOffset = 43
            actionHeight = 202
            primaryButtonY = 154
            placeholderTop = 322
            placeholderHeight = 194
            placeholderDetailOffset = 112
            dialTop = 540
            dialHeight = 390
            dialRadius = 96
            needleTop = 954
            needleHeight = 132
            stateTop = 1_110
            stateHeight = 154
            stateRowHeight = 36
            stacksActions = true
        }
    }
}
