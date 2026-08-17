import Foundation

/// Atomic, versioned custody for the timer run that must survive process termination.
public actor FileTimerFeatureSessionStore: TimerFeatureSessionStoring {
    private struct Envelope: Codable, Sendable {
        var version = 1
        var session: TimerFeatureSessionState?
    }

    private let fileURL: URL
    private var cached: Envelope?

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    public func load() throws -> TimerFeatureSessionState? {
        try loadEnvelope().session
    }

    public func save(_ session: TimerFeatureSessionState) throws {
        try saveEnvelope(Envelope(session: session))
    }

    public func clear() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            cached = Envelope()
            return
        }
        try FileManager.default.removeItem(at: fileURL)
        cached = Envelope()
    }

    private func loadEnvelope() throws -> Envelope {
        if let cached { return cached }
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            let envelope = Envelope()
            cached = envelope
            return envelope
        }
        let envelope = try JSONDecoder().decode(
            Envelope.self,
            from: Data(contentsOf: fileURL)
        )
        guard envelope.version == 1 else {
            throw TimerFeatureError.persistence(
                "Unsupported timer session version \(envelope.version)."
            )
        }
        cached = envelope
        return envelope
    }

    private func saveEnvelope(_ envelope: Envelope) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(envelope).write(to: fileURL, options: [.atomic])
        cached = envelope
    }
}
