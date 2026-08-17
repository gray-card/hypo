import Foundation
import SwiftData

/// The first durable SwiftData schema used by Hypo.
///
/// Domain values are encoded into independent rows. This keeps PersistenceKit's public
/// value types separate from SwiftData's reference-model lifecycle while still allowing
/// records, outbox operations, conflicts, and complements to migrate independently in
/// later schema releases.
enum PersistenceSchemaV1: VersionedSchema {
    static let versionIdentifier = Schema.Version(1, 0, 0)

    static var models: [any PersistentModel.Type] {
        [
            MetadataRow.self,
            CachedRecordRow.self,
            OutboxOperationRow.self,
            ParkedConflictRow.self,
            PanprotoComplementRow.self,
        ]
    }

    @Model
    final class MetadataRow {
        @Attribute(.unique) var key: String
        var integerValue: Int64

        init(key: String, integerValue: Int64) {
            self.key = key
            self.integerValue = integerValue
        }
    }

    @Model
    final class CachedRecordRow {
        @Attribute(.unique) var uri: String
        var encodedValue: Data

        init(uri: String, encodedValue: Data) {
            self.uri = uri
            self.encodedValue = encodedValue
        }
    }

    @Model
    final class OutboxOperationRow {
        @Attribute(.unique) var operationID: String
        var encodedValue: Data

        init(operationID: String, encodedValue: Data) {
            self.operationID = operationID
            self.encodedValue = encodedValue
        }
    }

    @Model
    final class ParkedConflictRow {
        @Attribute(.unique) var conflictID: String
        var encodedValue: Data

        init(conflictID: String, encodedValue: Data) {
            self.conflictID = conflictID
            self.encodedValue = encodedValue
        }
    }

    @Model
    final class PanprotoComplementRow {
        @Attribute(.unique) var storageKey: String
        var encodedValue: Data

        init(storageKey: String, encodedValue: Data) {
            self.storageKey = storageKey
            self.encodedValue = encodedValue
        }
    }
}

/// Append future schemas and migration stages here. Passing this plan to every container
/// prevents a store from being opened without an explicit schema history.
enum PersistenceSchemaMigrationPlan: SchemaMigrationPlan {
    static var schemas: [any VersionedSchema.Type] { [PersistenceSchemaV1.self] }
    static var stages: [MigrationStage] { [] }
}

/// A production persistence store backed by SwiftData.
///
/// Each `apply` call validates all mutations against an in-memory candidate before it
/// changes the model context. The candidate is then committed in one SwiftData save, so
/// callers observe the same all-or-nothing transaction semantics as the file store.
public actor SwiftDataPersistenceStore: PersistenceStore {
    public static let currentSchemaVersion = "1.0.0"

    private static let revisionKey = "revision"

    private let container: ModelContainer
    private var changeHub = ChangeHub()

    /// Creates a durable store at an application-controlled URL.
    public init(storeURL: URL) throws {
        try FileManager.default.createDirectory(
            at: storeURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let schema = Schema(versionedSchema: PersistenceSchemaV1.self)
        let configuration = ModelConfiguration(
            "HypoPersistence",
            schema: schema,
            url: storeURL,
            allowsSave: true,
            cloudKitDatabase: .none
        )
        container = try ModelContainer(
            for: schema,
            migrationPlan: PersistenceSchemaMigrationPlan.self,
            configurations: configuration
        )
        try Self.ensureRevisionMetadata(in: container)
    }

    public func snapshot() throws -> PersistenceSnapshot {
        try Self.readState(from: ModelContext(container)).snapshot()
    }

    public func apply(_ mutations: [PersistenceMutation]) throws {
        guard !mutations.isEmpty else { return }

        let context = ModelContext(container)
        var candidate = try Self.readState(from: context)
        let change = try candidate.apply(mutations)

        do {
            try Self.replaceContents(with: candidate, in: context)
            changeHub.emit(change)
        } catch {
            context.rollback()
            throw error
        }
    }

    public func changes() -> AsyncStream<PersistenceChange> {
        changeHub.stream { [weak self] id in
            Task { await self?.removeContinuation(id) }
        }
    }

    private func removeContinuation(_ id: UUID) {
        changeHub.remove(id)
    }

    private static func ensureRevisionMetadata(in container: ModelContainer) throws {
        let context = ModelContext(container)
        let metadata = try context.fetch(FetchDescriptor<PersistenceSchemaV1.MetadataRow>())
        guard !metadata.contains(where: { $0.key == revisionKey }) else { return }
        context.insert(PersistenceSchemaV1.MetadataRow(key: revisionKey, integerValue: 0))
        try context.save()
    }

    private static func readState(from context: ModelContext) throws -> StoreState {
        let metadata = try context.fetch(FetchDescriptor<PersistenceSchemaV1.MetadataRow>())
        let revision = metadata.first(where: { $0.key == revisionKey })?.integerValue ?? 0

        let records = try context.fetch(FetchDescriptor<PersistenceSchemaV1.CachedRecordRow>()).map {
            try decode(CachedRecord.self, from: $0.encodedValue, entity: "cached record", id: $0.uri)
        }
        let outbox = try context.fetch(FetchDescriptor<PersistenceSchemaV1.OutboxOperationRow>()).map {
            try decode(
                OutboxOperation.self,
                from: $0.encodedValue,
                entity: "outbox operation",
                id: $0.operationID
            )
        }
        let conflicts = try context.fetch(FetchDescriptor<PersistenceSchemaV1.ParkedConflictRow>()).map {
            try decode(
                ParkedConflict.self,
                from: $0.encodedValue,
                entity: "parked conflict",
                id: $0.conflictID
            )
        }
        let complements = try context.fetch(
            FetchDescriptor<PersistenceSchemaV1.PanprotoComplementRow>()
        ).map {
            try decode(
                PanprotoComplement.self,
                from: $0.encodedValue,
                entity: "Panproto complement",
                id: $0.storageKey
            )
        }

        return StoreState(
            snapshot: PersistenceSnapshot(
                revision: revision,
                records: records,
                outbox: outbox,
                conflicts: conflicts,
                complements: complements
            )
        )
    }

    private static func replaceContents(with state: StoreState, in context: ModelContext) throws {
        let snapshot = state.snapshot()
        let records = try snapshot.records.map {
            try PersistenceSchemaV1.CachedRecordRow(uri: $0.uri, encodedValue: encode($0))
        }
        let outbox = try snapshot.outbox.map {
            try PersistenceSchemaV1.OutboxOperationRow(
                operationID: $0.id.uuidString,
                encodedValue: encode($0)
            )
        }
        let conflicts = try snapshot.conflicts.map {
            try PersistenceSchemaV1.ParkedConflictRow(
                conflictID: $0.id.uuidString,
                encodedValue: encode($0)
            )
        }
        let complements = try snapshot.complements.map {
            try PersistenceSchemaV1.PanprotoComplementRow(
                storageKey: $0.storageKey,
                encodedValue: encode($0)
            )
        }

        try context.delete(model: PersistenceSchemaV1.MetadataRow.self)
        try context.delete(model: PersistenceSchemaV1.CachedRecordRow.self)
        try context.delete(model: PersistenceSchemaV1.OutboxOperationRow.self)
        try context.delete(model: PersistenceSchemaV1.ParkedConflictRow.self)
        try context.delete(model: PersistenceSchemaV1.PanprotoComplementRow.self)

        context.insert(
            PersistenceSchemaV1.MetadataRow(key: revisionKey, integerValue: snapshot.revision)
        )
        records.forEach(context.insert)
        outbox.forEach(context.insert)
        conflicts.forEach(context.insert)
        complements.forEach(context.insert)
        try context.save()
    }

    private static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }

    private static func decode<T: Decodable>(
        _ type: T.Type,
        from data: Data,
        entity: String,
        id: String
    ) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw PersistenceError.corruptStoredValue(entity: entity, identifier: id)
        }
    }
}
