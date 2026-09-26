import Foundation
import PanprotoKit
import PersistenceKit

public enum PanprotoHydrationCoordinationError: Error, Equatable, Sendable {
    case missingNativeCID(recordURI: String)
    case complementChainMismatch(expected: String, found: String)
    case forwardProjectionMismatch(recordURI: String)
}

/// A projected record and the persistence mutations required to retain its opaque complement.
public struct PanprotoHydrationProjection: Sendable {
    public var record: HydratedRepositoryRecord
    public var complementCustodyMutations: [PersistenceMutation]

    public init(
        record: HydratedRepositoryRecord,
        complementCustodyMutations: [PersistenceMutation]
    ) {
        self.record = record
        self.complementCustodyMutations = complementCustodyMutations
    }
}

/// Keeps Panproto's decode boundary separate from network hydration and persistence execution.
public struct PanprotoHydrationCoordinator: Sendable {
    private let migrator: any PanprotoRecordMigrating

    public init(migrator: any PanprotoRecordMigrating = PanprotoRecordMigrator()) {
        self.migrator = migrator
    }

    public func project(
        _ native: HydratedRepositoryRecord,
        using migration: PanprotoMigrationArtifact,
        now: Date = Date()
    ) async throws -> PanprotoHydrationProjection {
        guard let nativeCID = native.cid else {
            throw PanprotoHydrationCoordinationError.missingNativeCID(recordURI: native.uri)
        }
        // The forward lift is the canonical read projection. `get` must produce that same view
        // while additionally returning the complement required by a later native-release edit.
        let lifted = try await migrator.forwardLift(native.value, using: migration)
        let projection = try await migrator.get(native.value, using: migration)
        guard lifted == projection.record else {
            throw PanprotoHydrationCoordinationError.forwardProjectionMismatch(
                recordURI: native.uri
            )
        }
        var view = native
        view.value = projection.record
        let complement = PanprotoComplement(
            recordURI: native.uri,
            nativeCID: nativeCID,
            chainID: migration.chainID,
            payload: projection.complement.rawValue,
            createdAt: now
        )
        return PanprotoHydrationProjection(
            record: view,
            complementCustodyMutations: [.saveComplement(complement)]
        )
    }

    /// Reconstructs a record in its native release before a swap-protected write.
    ///
    /// The caller retains custody of the complement and is responsible for selecting it by the
    /// exact native record identity and migration chain.
    public func restore(
        editedView: Data,
        complement: PanprotoComplement,
        using migration: PanprotoMigrationArtifact
    ) async throws -> Data {
        guard complement.chainID == migration.chainID else {
            throw PanprotoHydrationCoordinationError.complementChainMismatch(
                expected: migration.chainID,
                found: complement.chainID
            )
        }
        return try await migrator.put(
            editedView: editedView,
            complement: PanprotoOpaqueComplement(rawValue: complement.payload),
            using: migration
        )
    }
}
