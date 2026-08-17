import Foundation

/// A single-file, atomically replaced persistence store suitable for app support storage.
/// The on-disk envelope carries a schema version so incompatible changes fail explicitly.
public actor FilePersistenceStore: PersistenceStore {
    public static let currentVersion = 1

    private let fileURL: URL
    private var state: StoreState
    private var changeHub = ChangeHub()
    private let encoder: JSONEncoder

    public init(fileURL: URL) throws {
        self.fileURL = fileURL
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        self.encoder = encoder

        if FileManager.default.fileExists(atPath: fileURL.path) {
            let data = try Data(contentsOf: fileURL)
            if let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let foundVersion = object["version"] as? Int,
                foundVersion != Self.currentVersion
            {
                throw PersistenceError.unsupportedStoreVersion(
                    found: foundVersion,
                    supported: Self.currentVersion
                )
            }
            let document = try JSONDecoder().decode(StoreDocument.self, from: data)
            guard document.version == Self.currentVersion else {
                throw PersistenceError.unsupportedStoreVersion(
                    found: document.version,
                    supported: Self.currentVersion
                )
            }
            state = document.state
        } else {
            state = StoreState()
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try encoder.encode(StoreDocument(version: Self.currentVersion, state: state)).write(
                to: fileURL,
                options: .atomic
            )
        }
    }

    public func snapshot() -> PersistenceSnapshot { state.snapshot() }

    public func apply(_ mutations: [PersistenceMutation]) throws {
        guard !mutations.isEmpty else { return }
        var candidate = state
        let change = try candidate.apply(mutations)
        let document = StoreDocument(version: Self.currentVersion, state: candidate)
        try encoder.encode(document).write(to: fileURL, options: .atomic)
        state = candidate
        changeHub.emit(change)
    }

    public func changes() -> AsyncStream<PersistenceChange> {
        changeHub.stream { [weak self] id in
            Task { await self?.removeContinuation(id) }
        }
    }

    private func removeContinuation(_ id: UUID) {
        changeHub.remove(id)
    }
}
