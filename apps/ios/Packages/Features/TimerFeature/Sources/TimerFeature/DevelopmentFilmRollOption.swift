import Foundation
import HypoLexicon

/// A film roll that the timer can link to the resulting development-session record.
public struct DevelopmentFilmRollOption: Identifiable, Hashable, Sendable {
    public let uri: ATURI
    public let title: String
    public let detail: String?

    public init(uri: ATURI, title: String, detail: String? = nil) {
        self.uri = uri
        self.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        self.detail = detail?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }

    public var id: ATURI { uri }

    public var displayTitle: String {
        title.isEmpty ? uri.rawValue : title
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
