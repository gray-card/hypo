import ATProtoClient
import Foundation
import HypoLexicon
import PanprotoKit
import PersistenceKit

/// Whether a hydrated record already conforms to the schema pinned by this client.
public enum PanprotoCurrentRecordClassification: Hashable, Sendable {
    case current
    case requiresMigration(issues: [String])
    case unmanaged
}

/// Fast-path validation for the schema release compiled into the application.
public protocol PanprotoCurrentRecordValidating: Sendable {
    func classify(
        _ record: Data,
        collection: String
    ) async -> PanprotoCurrentRecordClassification
}

/// Validates current `app.graycard.*` records with the generated lexicon validator.
///
/// Panproto is entered only after this validator rejects a managed record. This matches the web
/// runtime and keeps the migration engine off the ordinary current-release read path.
public struct HypoCurrentRecordValidator: PanprotoCurrentRecordValidating, Sendable {
    private let currentReleaseLabel: String

    public init(currentReleaseLabel: String = LexiconRelease.schemaTag) {
        self.currentReleaseLabel = currentReleaseLabel
    }

    public func classify(
        _ record: Data,
        collection: String
    ) async -> PanprotoCurrentRecordClassification {
        guard collection.hasPrefix("app.graycard.") else { return .unmanaged }
        guard let nsid = try? NSID(collection) else {
            return .requiresMigration(issues: ["The collection is not a valid NSID."])
        }
        do {
            if let object = try JSONSerialization.jsonObject(with: record) as? [String: Any],
                let explicitRelease = object["schemaVersion"] as? String,
                explicitRelease.hasPrefix("lexicons-"),
                explicitRelease != currentReleaseLabel
            {
                return .requiresMigration(
                    issues: [
                        "The record names schema release \(explicitRelease); this client pins \(currentReleaseLabel)."
                    ]
                )
            }
            let issues = try GeneratedLexiconValidator.validate(record, as: nsid)
            guard !issues.isEmpty else { return .current }
            return .requiresMigration(
                issues: issues.map { "\($0.path): \($0.message)" }
            )
        } catch {
            return .requiresMigration(issues: ["The record is not valid JSON: \(error)"])
        }
    }
}

/// One collection-specific, reviewed route from a historical release to the pinned release.
public struct PanprotoMigrationRegistration: Hashable, Sendable {
    public let collection: String
    public let artifact: PanprotoMigrationArtifact

    public init(collection: String, artifact: PanprotoMigrationArtifact) {
        self.collection = collection
        self.artifact = artifact
    }
}

/// The migration artifacts shipped by one application release.
public struct PanprotoMigrationRegistry: Hashable, Sendable {
    public let currentReleaseLabel: String
    public let registrations: [PanprotoMigrationRegistration]

    public init(
        currentReleaseLabel: String,
        registrations: [PanprotoMigrationRegistration]
    ) {
        self.currentReleaseLabel = currentReleaseLabel
        self.registrations = registrations
    }

    public func registrations(for collection: String) -> [PanprotoMigrationRegistration] {
        registrations.filter { $0.collection == collection }
    }
}

/// Typed failures surfaced by production hydration and converted to parked sync failures on write.
public enum PanprotoRecordPipelineError: Error, Hashable, Sendable {
    case unsupportedVersion(collection: String, validationIssues: [String])
    case invalidRegistration(collection: String, chainID: String, targetLabel: String)
    case migrationFailed(recordURI: String, fault: PanprotoFault)
    case projectionFailed(recordURI: String, message: String)
    case complementPersistenceFailed(recordURI: String, message: String)
    case complementMissing(recordURI: String, nativeCID: String, chainID: String)
}

extension PanprotoRecordPipelineError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case let .unsupportedVersion(collection, validationIssues):
            let detail =
                validationIssues.isEmpty
                ? "No compatible released schema was found."
                : validationIssues.joined(separator: "; ")
            return "The \(collection) record uses an unsupported schema version. \(detail)"
        case let .invalidRegistration(collection, chainID, targetLabel):
            return
                "Migration \(chainID) for \(collection) targets \(targetLabel), not this app's pinned release."
        case let .migrationFailed(recordURI, fault):
            return "The record \(recordURI) could not be migrated: \(fault.description)"
        case let .projectionFailed(recordURI, message):
            return "The record \(recordURI) could not be projected: \(message)"
        case let .complementPersistenceFailed(recordURI, message):
            return "The migration complement for \(recordURI) could not be saved: \(message)"
        case let .complementMissing(recordURI, nativeCID, chainID):
            return
                "The migration complement for \(recordURI) at CID \(nativeCID) and chain \(chainID) is missing."
        }
    }
}

private struct PanprotoPreparedHydration: Sendable {
    var record: HydratedRepositoryRecord
    var migration: PanprotoMigrationArtifact?
}

/// Shared version detector and reversible projector used by both reads and edits.
private struct PanprotoProductionProjector: Sendable {
    let store: any PersistenceStore
    let validator: any PanprotoCurrentRecordValidating
    let registry: PanprotoMigrationRegistry
    let migrator: any PanprotoRecordMigrating
    let coordinator: PanprotoHydrationCoordinator

    func prepare(_ native: HydratedRepositoryRecord) async throws -> PanprotoPreparedHydration {
        switch await validator.classify(native.value, collection: native.collection) {
        case .current, .unmanaged:
            return PanprotoPreparedHydration(record: native, migration: nil)

        case .requiresMigration(let issues):
            let registrations = registry.registrations(for: native.collection)
            guard !registrations.isEmpty else {
                throw PanprotoRecordPipelineError.unsupportedVersion(
                    collection: native.collection,
                    validationIssues: issues
                )
            }
            for registration in registrations
            where registration.artifact.target.label != registry.currentReleaseLabel {
                throw PanprotoRecordPipelineError.invalidRegistration(
                    collection: native.collection,
                    chainID: registration.artifact.chainID,
                    targetLabel: registration.artifact.target.label
                )
            }

            let releases = registrations.map(\.artifact.source).uniquedByLabel()
            let interpretation: PanprotoReleaseInterpretation
            do {
                interpretation = try await migrator.interpretRelease(
                    of: native.value,
                    releasesNewestFirst: releases
                )
            } catch let fault {
                throw PanprotoRecordPipelineError.migrationFailed(
                    recordURI: native.uri,
                    fault: fault
                )
            }
            guard
                let registration = registrations.first(where: {
                    $0.artifact.source.label == interpretation.release.label
                })
            else {
                throw PanprotoRecordPipelineError.unsupportedVersion(
                    collection: native.collection,
                    validationIssues: issues
                )
            }

            let projection: PanprotoHydrationProjection
            do {
                projection = try await coordinator.project(
                    native,
                    using: registration.artifact
                )
            } catch let fault as PanprotoFault {
                throw PanprotoRecordPipelineError.migrationFailed(
                    recordURI: native.uri,
                    fault: fault
                )
            } catch {
                throw PanprotoRecordPipelineError.projectionFailed(
                    recordURI: native.uri,
                    message: String(describing: error)
                )
            }
            do {
                try await store.apply(projection.complementCustodyMutations)
            } catch {
                throw PanprotoRecordPipelineError.complementPersistenceFailed(
                    recordURI: native.uri,
                    message: String(describing: error)
                )
            }
            return PanprotoPreparedHydration(
                record: projection.record,
                migration: registration.artifact
            )
        }
    }

    func restore(
        editedView: Data,
        recordURI: String,
        nativeCID: String,
        migration: PanprotoMigrationArtifact
    ) async throws -> Data {
        let complement: PanprotoComplement
        do {
            guard
                let stored = try await store.complement(
                    recordURI: recordURI,
                    nativeCID: nativeCID,
                    chainID: migration.chainID
                )
            else {
                throw PanprotoRecordPipelineError.complementMissing(
                    recordURI: recordURI,
                    nativeCID: nativeCID,
                    chainID: migration.chainID
                )
            }
            complement = stored
        } catch let error as PanprotoRecordPipelineError {
            throw error
        } catch {
            throw PanprotoRecordPipelineError.complementPersistenceFailed(
                recordURI: recordURI,
                message: String(describing: error)
            )
        }

        do {
            return try await coordinator.restore(
                editedView: editedView,
                complement: complement,
                using: migration
            )
        } catch let fault as PanprotoFault {
            throw PanprotoRecordPipelineError.migrationFailed(
                recordURI: recordURI,
                fault: fault
            )
        } catch {
            throw PanprotoRecordPipelineError.projectionFailed(
                recordURI: recordURI,
                message: String(describing: error)
            )
        }
    }
}

/// Production record hydrator that never hands an unsupported record to feature decoders.
public struct PanprotoRecordHydrator: RecordHydrating, Sendable {
    private let native: any RecordHydrating
    private let projector: PanprotoProductionProjector

    fileprivate init(native: any RecordHydrating, projector: PanprotoProductionProjector) {
        self.native = native
        self.projector = projector
    }

    public func get(_ request: RecordHydrationRequest) async throws -> HydratedRepositoryRecord {
        try await projector.prepare(native.get(request)).record
    }

    public func list(_ request: RecordListHydrationRequest) async throws -> HydratedRepositoryPage {
        let page = try await native.list(request)
        var records: [HydratedRepositoryRecord] = []
        records.reserveCapacity(page.records.count)
        for record in page.records {
            records.append(try await projector.prepare(record).record)
        }
        return HydratedRepositoryPage(cursor: page.cursor, records: records)
    }
}

/// Production outbox wrapper that reconstructs a foreign record before its native CAS write.
public struct PanprotoSyncTransport: SyncTransport, Sendable {
    private let nativeHydrator: any RecordHydrating
    private let wrapped: any SyncTransport
    private let projector: PanprotoProductionProjector

    fileprivate init(
        nativeHydrator: any RecordHydrating,
        wrapped: any SyncTransport,
        projector: PanprotoProductionProjector
    ) {
        self.nativeHydrator = nativeHydrator
        self.wrapped = wrapped
        self.projector = projector
    }

    public func execute(_ operation: OutboxOperation) async throws -> RemoteWriteResult {
        guard operation.kind == .put,
            let editedView = operation.record,
            let recordURI = operation.uri,
            let rkey = operation.rkey
        else {
            return try await wrapped.execute(operation)
        }

        do {
            let registrations = projector.registry.registrations(for: operation.collection)
            guard !registrations.isEmpty else {
                if case .requiresMigration(let issues) = await projector.validator.classify(
                    editedView,
                    collection: operation.collection
                ) {
                    throw PanprotoRecordPipelineError.unsupportedVersion(
                        collection: operation.collection,
                        validationIssues: issues
                    )
                }
                return try await wrapped.execute(operation)
            }

            let nativeCID = operation.swapRecord
            var selectedMigration: PanprotoMigrationArtifact?
            if let nativeCID {
                for registration in registrations {
                    if try await projector.store.complement(
                        recordURI: recordURI,
                        nativeCID: nativeCID,
                        chainID: registration.artifact.chainID
                    ) != nil {
                        selectedMigration = registration.artifact
                        break
                    }
                }
            }

            if selectedMigration == nil {
                let remote = try await nativeHydrator.get(
                    RecordHydrationRequest(
                        repo: operation.repo,
                        collection: operation.collection,
                        rkey: rkey,
                        cid: nativeCID
                    )
                )
                selectedMigration = try await projector.prepare(remote).migration
            }

            guard let selectedMigration else {
                return try await wrapped.execute(operation)
            }
            guard let nativeCID else {
                throw PanprotoRecordPipelineError.projectionFailed(
                    recordURI: recordURI,
                    message: "A foreign-version edit requires the native CID."
                )
            }
            let nativeRecord = try await projector.restore(
                editedView: editedView,
                recordURI: recordURI,
                nativeCID: nativeCID,
                migration: selectedMigration
            )
            var nativeOperation = operation
            nativeOperation.record = nativeRecord
            var result = try await wrapped.execute(nativeOperation)
            // The cache remains in the pinned view even though the PDS received its native release.
            result.record = editedView
            return result
        } catch let error as SyncTransportError {
            throw error
        } catch let error as PanprotoRecordPipelineError {
            throw SyncTransportError.permanent(
                message: error.errorDescription ?? String(describing: error)
            )
        } catch let error as ATProtoHTTPError {
            let message = [error.error, error.message].compactMap { $0 }.joined(separator: ": ")
            if error.statusCode == 408 || error.statusCode == 425 || error.statusCode == 429
                || error.statusCode >= 500
            {
                throw SyncTransportError.transient(message: message)
            }
            throw SyncTransportError.permanent(message: message)
        } catch let error as URLError {
            throw SyncTransportError.transient(message: error.localizedDescription)
        } catch {
            throw SyncTransportError.transient(message: String(describing: error))
        }
    }
}

/// Constructs the live hydration and edit boundaries from one registry, migrator, and store.
public struct PanprotoProductionComposition: Sendable {
    public let hydrator: PanprotoRecordHydrator
    public let transport: PanprotoSyncTransport

    public init(
        nativeHydrator: any RecordHydrating,
        transport: any SyncTransport,
        store: any PersistenceStore,
        registry: PanprotoMigrationRegistry,
        validator: (any PanprotoCurrentRecordValidating)? = nil,
        migrator: any PanprotoRecordMigrating = PanprotoRecordMigrator()
    ) {
        let validator =
            validator
            ?? HypoCurrentRecordValidator(
                currentReleaseLabel: registry.currentReleaseLabel
            )
        let projector = PanprotoProductionProjector(
            store: store,
            validator: validator,
            registry: registry,
            migrator: migrator,
            coordinator: PanprotoHydrationCoordinator(migrator: migrator)
        )
        hydrator = PanprotoRecordHydrator(native: nativeHydrator, projector: projector)
        self.transport = PanprotoSyncTransport(
            nativeHydrator: nativeHydrator,
            wrapped: transport,
            projector: projector
        )
    }
}

private extension [PanprotoSchemaRelease] {
    func uniquedByLabel() -> [PanprotoSchemaRelease] {
        var labels = Set<String>()
        return filter { labels.insert($0.label).inserted }
    }
}
