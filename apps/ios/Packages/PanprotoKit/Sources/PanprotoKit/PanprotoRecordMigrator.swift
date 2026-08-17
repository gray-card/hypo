import Foundation
import Panproto
import PanprotoStructural

/// One reviewed, runnable chain and the schemas at its two ends.
///
/// `fullChainJSON` must be the complete chain document accepted by
/// `ProtolensChainHandle.fromJSON(_:)`. A `stepSummaries()` payload is intentionally insufficient:
/// it omits the transforms and complement constructor required to run the lens.
public struct PanprotoMigrationArtifact: Hashable, Sendable {
    public let chainID: String
    public let source: PanprotoSchemaRelease
    public let target: PanprotoSchemaRelease
    public let fullChainJSON: Data

    public init(
        chainID: String,
        source: PanprotoSchemaRelease,
        target: PanprotoSchemaRelease,
        fullChainJSON: Data
    ) {
        self.chainID = chainID
        self.source = source
        self.target = target
        self.fullChainJSON = fullChainJSON
    }
}

/// Deterministic CBOR for a Panproto `Complement`.
///
/// The payload is opaque to application code. Persistence keys it by record URI, native CID, and
/// chain ID, then returns the bytes unchanged for a later `put`.
public struct PanprotoOpaqueComplement: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Data

    public init(rawValue: Data) {
        self.rawValue = rawValue
    }
}

/// The two values a reversible projection must keep together.
public struct PanprotoRecordProjection: Hashable, Sendable {
    public let record: Data
    public let complement: PanprotoOpaqueComplement

    public init(record: Data, complement: PanprotoOpaqueComplement) {
        self.record = record
        self.complement = complement
    }
}

/// Why the resolver selected a release.
public enum PanprotoReleaseEvidence: Hashable, Sendable {
    /// The record carried `schemaVersion`; that label was authoritative.
    case explicit
    /// The record had no label and this was the first compatible release in newest-first order.
    case compatibleUnlabeled
}

/// A release selection and the evidence behind it.
public struct PanprotoReleaseInterpretation: Hashable, Sendable {
    public let release: PanprotoSchemaRelease
    public let evidence: PanprotoReleaseEvidence

    public init(release: PanprotoSchemaRelease, evidence: PanprotoReleaseEvidence) {
        self.release = release
        self.evidence = evidence
    }
}

/// The app boundary for release interpretation and reversible record migration.
public protocol PanprotoRecordMigrating: Sendable {
    func interpretRelease(
        of record: Data,
        releasesNewestFirst: [PanprotoSchemaRelease]
    ) async throws(PanprotoFault) -> PanprotoReleaseInterpretation

    func forwardLift(
        _ record: Data,
        using migration: PanprotoMigrationArtifact
    ) async throws(PanprotoFault) -> Data

    func get(
        _ record: Data,
        using migration: PanprotoMigrationArtifact
    ) async throws(PanprotoFault) -> PanprotoRecordProjection

    func put(
        editedView: Data,
        complement: PanprotoOpaqueComplement,
        using migration: PanprotoMigrationArtifact
    ) async throws(PanprotoFault) -> Data
}

/// Runs ATProto records through reviewed Panproto artifacts without exposing engine handles.
public struct PanprotoRecordMigrator: PanprotoRecordMigrating, Sendable {
    public init() {}

    /// Resolve an explicit label exactly, or infer an unlabeled record newest-first by compatibility.
    ///
    /// A record that carries `schemaVersion` never falls back to another release. This makes the
    /// producer's label authoritative even if a newer schema also happens to accept the bytes.
    public func interpretRelease(
        of record: Data,
        releasesNewestFirst: [PanprotoSchemaRelease]
    ) async throws(PanprotoFault) -> PanprotoReleaseInterpretation {
        try validateReleaseCatalog(releasesNewestFirst)
        let explicitLabel = try explicitSchemaVersion(in: record)

        return try await PanprotoEngine.run {
            () throws(PanprotoFault) -> PanprotoReleaseInterpretation in
            if let explicitLabel {
                guard let release = releasesNewestFirst.first(where: { $0.label == explicitLabel })
                else {
                    throw PanprotoFault.unknownExplicitSchemaVersion(label: explicitLabel)
                }

                switch try compatibility(of: record, with: release) {
                case .compatible:
                    return PanprotoReleaseInterpretation(release: release, evidence: .explicit)
                case .incompatible(let reason):
                    throw PanprotoFault.explicitSchemaVersionMismatch(
                        label: explicitLabel,
                        reason: reason
                    )
                }
            }

            for release in releasesNewestFirst {
                if case .compatible = try compatibility(of: record, with: release) {
                    return PanprotoReleaseInterpretation(
                        release: release,
                        evidence: .compatibleUnlabeled
                    )
                }
            }
            throw PanprotoFault.noCompatibleSchemaVersion
        }
    }

    /// Lift a record through the compiled forward migration.
    ///
    /// Use this for old-to-pinned reads that will be written as pinned records. Use the lens `get`
    /// when the view may later be put back into the source release.
    public func forwardLift(
        _ record: Data,
        using migration: PanprotoMigrationArtifact
    ) async throws(PanprotoFault) -> Data {
        try await PanprotoEngine.run { () throws(PanprotoFault) -> Data in
            do {
                let source = try schema(from: migration.source.definition)
                let target = try schema(from: migration.target.definition)
                let registry = try IoRegistryHandle.builtin()
                let chain = try ProtolensChainHandle.fromJSON(migration.fullChainJSON)
                let compiled = try chain.instantiate(at: source)

                let sourceInstance = try registry.parseInstance(
                    record,
                    protocolName: "atproto",
                    schema: source
                )
                let sourceViolations = try source.violations(in: sourceInstance)
                guard sourceViolations.isEmpty else {
                    throw PanprotoFault.recordViolations(sourceViolations)
                }

                let lifted = try compiled.lift(sourceInstance)
                let targetViolations = try target.violations(in: lifted)
                guard targetViolations.isEmpty else {
                    throw PanprotoFault.migrationOutputViolations(targetViolations)
                }
                return try registry.emitInstance(
                    lifted,
                    protocolName: "atproto",
                    schema: target
                )
            } catch let failure as PanprotoFault {
                throw failure
            } catch let failure as PanprotoError {
                throw PanprotoFault.wrapping(failure)
            } catch {
                throw PanprotoFault.engine(
                    domain: .migration,
                    operation: "PanprotoRecordMigrator.forwardLift",
                    message: String(describing: error)
                )
            }
        }
    }

    /// Project through the chain and return deterministic complement bytes for durable custody.
    public func get(
        _ record: Data,
        using migration: PanprotoMigrationArtifact
    ) async throws(PanprotoFault) -> PanprotoRecordProjection {
        try await PanprotoEngine.run { () throws(PanprotoFault) -> PanprotoRecordProjection in
            do {
                let source = try schema(from: migration.source.definition)
                let target = try schema(from: migration.target.definition)
                let registry = try IoRegistryHandle.builtin()
                let chain = try ProtolensChainHandle.fromJSON(migration.fullChainJSON)
                let lens = try chain.instantiate(at: source)

                let sourceInstance = try registry.parseInstance(
                    record,
                    protocolName: "atproto",
                    schema: source
                )
                let sourceViolations = try source.violations(in: sourceInstance)
                guard sourceViolations.isEmpty else {
                    throw PanprotoFault.recordViolations(sourceViolations)
                }

                let projection = try lens.get(sourceInstance)
                let targetViolations = try target.violations(in: projection.view)
                guard targetViolations.isEmpty else {
                    throw PanprotoFault.migrationOutputViolations(targetViolations)
                }

                let emitted = try registry.emitInstance(
                    projection.view,
                    protocolName: "atproto",
                    schema: target
                )
                let complement = try CBOREncoder().encode(projection.complement)
                return PanprotoRecordProjection(
                    record: emitted,
                    complement: PanprotoOpaqueComplement(rawValue: complement)
                )
            } catch let failure as PanprotoFault {
                throw failure
            } catch let failure as PanprotoError {
                throw PanprotoFault.wrapping(failure)
            } catch {
                throw PanprotoFault.engine(
                    domain: .lens,
                    operation: "PanprotoRecordMigrator.get",
                    message: String(describing: error)
                )
            }
        }
    }

    /// Reconstruct the source record from an edited view and its unmodified complement.
    public func put(
        editedView: Data,
        complement: PanprotoOpaqueComplement,
        using migration: PanprotoMigrationArtifact
    ) async throws(PanprotoFault) -> Data {
        try await PanprotoEngine.run { () throws(PanprotoFault) -> Data in
            let decodedComplement: Complement
            do {
                decodedComplement = try CBORDecoder().decode(
                    Complement.self,
                    from: complement.rawValue
                )
            } catch {
                throw PanprotoFault.malformedComplement(message: String(describing: error))
            }

            do {
                let source = try schema(from: migration.source.definition)
                let target = try schema(from: migration.target.definition)
                let registry = try IoRegistryHandle.builtin()
                let chain = try ProtolensChainHandle.fromJSON(migration.fullChainJSON)
                let lens = try chain.instantiate(at: source)

                let view = try registry.parseInstance(
                    editedView,
                    protocolName: "atproto",
                    schema: target
                )
                let viewViolations = try target.violations(in: view)
                guard viewViolations.isEmpty else {
                    throw PanprotoFault.recordViolations(viewViolations)
                }

                let restored = try lens.put(view: view, complement: decodedComplement)
                let restoredViolations = try source.violations(in: restored)
                guard restoredViolations.isEmpty else {
                    throw PanprotoFault.migrationOutputViolations(restoredViolations)
                }
                return try registry.emitInstance(
                    restored,
                    protocolName: "atproto",
                    schema: source
                )
            } catch let failure as PanprotoFault {
                throw failure
            } catch let failure as PanprotoError {
                throw PanprotoFault.wrapping(failure)
            } catch {
                throw PanprotoFault.engine(
                    domain: .lens,
                    operation: "PanprotoRecordMigrator.put",
                    message: String(describing: error)
                )
            }
        }
    }
}

private enum RecordCompatibility: Sendable {
    case compatible
    case incompatible(reason: String)
}

@PanprotoEngine
private func compatibility(
    of record: Data,
    with release: PanprotoSchemaRelease
) throws(PanprotoFault) -> RecordCompatibility {
    let candidate = try schema(from: release.definition)
    let registry: IoRegistryHandle
    do {
        registry = try IoRegistryHandle.builtin()
    } catch let failure {
        throw .wrapping(failure)
    }

    let instance: Instance
    do {
        instance = try registry.parseInstance(record, protocolName: "atproto", schema: candidate)
    } catch let failure {
        return .incompatible(reason: failure.detail.description)
    }

    do {
        let violations = try candidate.violations(in: instance)
        return violations.isEmpty
            ? .compatible
            : .incompatible(reason: violations.joined(separator: "; "))
    } catch let failure {
        throw .wrapping(failure)
    }
}

private func validateReleaseCatalog(
    _ releases: [PanprotoSchemaRelease]
) throws(PanprotoFault) {
    var labels = Set<String>()
    for release in releases {
        guard !release.label.isEmpty else {
            throw .invalidReleaseCatalog(message: "release labels must not be empty")
        }
        guard labels.insert(release.label).inserted else {
            throw .invalidReleaseCatalog(message: "duplicate release label \(release.label)")
        }
    }
}

private func explicitSchemaVersion(in record: Data) throws(PanprotoFault) -> String? {
    let object: Any
    do {
        object = try JSONSerialization.jsonObject(with: record)
    } catch {
        throw .malformedRecord(message: String(describing: error))
    }
    guard let dictionary = object as? [String: Any] else {
        throw .malformedRecord(message: "the top-level JSON value must be an object")
    }
    guard dictionary.keys.contains("schemaVersion") else { return nil }
    guard let label = dictionary["schemaVersion"] as? String, !label.isEmpty else {
        throw .invalidExplicitSchemaVersion(message: "schemaVersion must be a non-empty string")
    }
    return label
}
