import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct ExposureCSV: FileDocument {
    static let readableContentTypes: [UTType] = [.commaSeparatedText]
    let data: Data

    init(exposures: [ExposureDetail]) {
        let header =
            "Frame,Exposure,Date,Aperture,Shutter Speed,EI,Camera,Lens,Shoot,Meter Readings,Note,Record URI"
        let rows = exposures.sorted { lhs, rhs in
            let left = (
                lhs.draft.frameNumber, lhs.draft.frameExposureIndex ?? 1, lhs.createdAt.date, lhs.id.rawValue
            )
            let right = (
                rhs.draft.frameNumber, rhs.draft.frameExposureIndex ?? 1, rhs.createdAt.date, rhs.id.rawValue
            )
            return left < right
        }.map(Self.row)
        data = Data(([header] + rows + [""]).joined(separator: "\r\n").utf8)
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self.data = data
    }

    func fileWrapper(configuration _: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }

    private static func row(_ exposure: ExposureDetail) -> String {
        let draft = exposure.draft
        let settings: [String] = [
            String(draft.frameNumber),
            String(draft.frameExposureIndex ?? 1),
            (exposure.takenAt ?? exposure.createdAt).rawValue,
            draft.aperture,
            draft.shutterSpeed,
            draft.shotAtISO.map { String($0) } ?? "",
        ]
        let references: [String] = [
            draft.camera?.rawValue ?? "",
            draft.lens?.rawValue ?? "",
            draft.shoot?.rawValue ?? "",
            draft.meterReadings.map(\.rawValue).joined(separator: " "),
            draft.note,
            exposure.uri.rawValue,
        ]
        return (settings + references).map(csvField).joined(separator: ",")
    }

    private static func csvField(_ value: String) -> String {
        let start = value.trimmingCharacters(in: .whitespacesAndNewlines).first
        let unsafe = start.map { "=+-@".contains($0) } ?? false
        let safe = unsafe ? "'" + value : value
        return "\"" + safe.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }
}
