import Foundation
import HypoLexicon
import Panproto
import PanprotoStructural

/// A value-only summary returned across the Panproto engine boundary.
public struct PanprotoSchemaReport: Hashable, Sendable {
    public let protocolName: String
    public let vertexCount: Int
    public let edgeCount: Int
    public let violations: [String]

    public init(
        protocolName: String,
        vertexCount: Int,
        edgeCount: Int,
        violations: [String]
    ) {
        self.protocolName = protocolName
        self.vertexCount = vertexCount
        self.edgeCount = edgeCount
        self.violations = violations
    }

    public var isValid: Bool { violations.isEmpty }
}

/// A released schema represented by Panproto's deterministic structural CBOR.
///
/// The build-time lexicon assembler writes this value into the app bundle. Runtime code restores
/// the complete, cross-file schema through `SchemaHandle.define(_:)`; it does not reassemble a
/// directory of ATProto lexicon documents on a phone.
public struct PanprotoSchemaRelease: Hashable, Sendable {
    public let label: String
    public let definition: Data

    public init(label: String, definition: Data) {
        self.label = label
        self.definition = definition
    }
}

/// App-owned failure domains. Panproto's engine types remain behind this package boundary.
public enum PanprotoFaultDomain: String, Hashable, Sendable {
    case parse
    case migration
    case lens
    case schemaValidation
    case check
    case existenceCheck
    case expression
    case theory
    case io
    case versionControl
    case gitBridge
    case project
}

/// Failures the app can present or branch on without depending on Panproto engine types.
public enum PanprotoFault: Error, Hashable, Sendable {
    case malformedSchemaDefinition(message: String)
    case malformedComplement(message: String)
    case malformedRecord(message: String)
    case invalidReleaseCatalog(message: String)
    case invalidExplicitSchemaVersion(message: String)
    case unknownExplicitSchemaVersion(label: String)
    case explicitSchemaVersionMismatch(label: String, reason: String)
    case noCompatibleSchemaVersion
    case schemaViolations([String])
    case recordViolations([String])
    case migrationOutputViolations([String])
    case complementFingerprintMismatch(left: UInt64, right: UInt64)
    case complementConflict(kind: String, key: String)
    case engine(
        domain: PanprotoFaultDomain,
        operation: String,
        message: String
    )
}

extension PanprotoFault: CustomStringConvertible {
    public var description: String {
        switch self {
        case .malformedSchemaDefinition(let message):
            "The bundled schema definition could not be read: \(message)"
        case .malformedComplement(let message):
            "The saved migration complement could not be read: \(message)"
        case .malformedRecord(let message):
            "The record is not a JSON object: \(message)"
        case .invalidReleaseCatalog(let message):
            "The schema release catalog is invalid: \(message)"
        case .invalidExplicitSchemaVersion(let message):
            "The record's schemaVersion is invalid: \(message)"
        case .unknownExplicitSchemaVersion(let label):
            "The record names schemaVersion \(label), which is not in the release catalog."
        case .explicitSchemaVersionMismatch(let label, let reason):
            "The record does not match its explicit schemaVersion \(label): \(reason)"
        case .noCompatibleSchemaVersion:
            "The unlabeled record does not match a released schema."
        case .schemaViolations(let violations):
            "The schema has \(violations.count) violation(s): \(violations.joined(separator: "; "))"
        case .recordViolations(let violations):
            "The record has \(violations.count) violation(s): \(violations.joined(separator: "; "))"
        case .migrationOutputViolations(let violations):
            "The migration output has \(violations.count) violation(s): \(violations.joined(separator: "; "))"
        case .complementFingerprintMismatch(let left, let right):
            "The complement fingerprint \(left) does not match the migration fingerprint \(right)."
        case .complementConflict(let kind, let key):
            "The migration complements conflict in \(kind) at \(key)."
        case .engine(let domain, let operation, let message):
            "\(domain.rawValue) / \(operation): \(message)"
        }
    }
}

extension PanprotoFault: LocalizedError {
    public var errorDescription: String? { description }
}

extension PanprotoFault {
    static func wrapping(_ error: PanprotoError) -> Self {
        if let fault = error.detail.fault {
            switch fault {
            case .complementFingerprintMismatch(let left, let right):
                return .complementFingerprintMismatch(left: left, right: right)
            case .complementConflict(let kind, let key):
                return .complementConflict(kind: kind, key: key)
            case .invalidHandle, .typeMismatch, .panic:
                break
            }
        }

        // Panproto 0.70.1 compatibility shim. Its lens `put` path prefixes this engine fault
        // before it reaches the binding's structured-fault recognizer. Remove this fallback once
        // the adopted binding recognizes the decimal "complement has …, lens expects …" spelling;
        // `panproto0701DecimalFingerprintMessageIsNormalized` pins the removal condition.
        if let fingerprints = complementFingerprints(in: error.detail.message) {
            return .complementFingerprintMismatch(
                left: fingerprints.complement,
                right: fingerprints.lens
            )
        }

        return .engine(
            domain: PanprotoFaultDomain(error.domain),
            operation: error.detail.operation,
            message: error.detail.message
        )
    }

    private static func complementFingerprints(
        in message: String
    ) -> (complement: UInt64, lens: UInt64)? {
        let prefix = "source fingerprint mismatch: complement has "
        let separator = ", lens expects "
        guard let prefixRange = message.range(of: prefix) else { return nil }
        let suffix = message[prefixRange.upperBound...]
        guard let separatorRange = suffix.range(of: separator) else { return nil }
        guard let complement = UInt64(suffix[..<separatorRange.lowerBound]) else { return nil }
        guard let lens = UInt64(suffix[separatorRange.upperBound...]) else { return nil }
        return (complement, lens)
    }
}

extension PanprotoFaultDomain {
    init(_ domain: PanprotoError.Domain) {
        self =
            switch domain {
            case .parse: .parse
            case .migration: .migration
            case .lens: .lens
            case .schemaValidation: .schemaValidation
            case .check: .check
            case .existenceCheck: .existenceCheck
            case .expr: .expression
            case .gat: .theory
            case .io: .io
            case .vcs: .versionControl
            case .gitBridge: .gitBridge
            case .project: .project
            }
    }
}

/// The app-side boundary for inspecting released ATProto schemas.
public protocol PanprotoSchemaChecking: Sendable {
    func inspectLexicon(_ json: Data) async throws(PanprotoFault) -> PanprotoSchemaReport
    func inspectDefinition(_ definition: Data) async throws(PanprotoFault) -> PanprotoSchemaReport
    func serializedDefinition(fromLexicon json: Data) async throws(PanprotoFault) -> Data
    func validateRecord(
        _ record: Data,
        againstLexicon lexicon: Data
    ) async throws(PanprotoFault) -> [String]
    func validateRecord(
        _ record: Data,
        againstDefinition definition: Data
    ) async throws(PanprotoFault) -> [String]
}

/// A facade over the official Panproto 0.70.1 Swift binding.
///
/// All engine work runs in one engine-isolated region. Only app-owned, sendable values cross back
/// into application code.
public struct PanprotoSchemaInspector: PanprotoSchemaChecking, Sendable {
    public init() {}

    public func inspectLexicon(
        _ json: Data
    ) async throws(PanprotoFault) -> PanprotoSchemaReport {
        try await PanprotoEngine.run { () throws(PanprotoFault) -> PanprotoSchemaReport in
            do {
                return try report(for: SchemaHandle.parseAtprotoLexicon(json))
            } catch let failure as PanprotoFault {
                throw failure
            } catch let failure as PanprotoError {
                throw PanprotoFault.wrapping(failure)
            } catch {
                throw PanprotoFault.engine(
                    domain: .schemaValidation,
                    operation: "PanprotoSchemaInspector.inspectLexicon",
                    message: String(describing: error)
                )
            }
        }
    }

    public func inspectDefinition(
        _ definition: Data
    ) async throws(PanprotoFault) -> PanprotoSchemaReport {
        try await PanprotoEngine.run { () throws(PanprotoFault) -> PanprotoSchemaReport in
            do {
                return try report(for: schema(from: definition))
            } catch let failure as PanprotoFault {
                throw failure
            } catch let failure as PanprotoError {
                throw PanprotoFault.wrapping(failure)
            } catch {
                throw PanprotoFault.malformedSchemaDefinition(message: String(describing: error))
            }
        }
    }

    /// Serialize one lexicon document for fixtures and build tools.
    ///
    /// Production bundles should call this after the repository's cross-file lexicon assembly, on
    /// the assembled `Schema` value. `parseAtprotoLexicon` sees only one document and intentionally
    /// leaves references into other documents as placeholders.
    public func serializedDefinition(
        fromLexicon json: Data
    ) async throws(PanprotoFault) -> Data {
        try await PanprotoEngine.run { () throws(PanprotoFault) -> Data in
            do {
                let parsed = try SchemaHandle.parseAtprotoLexicon(json)
                return try CBOREncoder().encode(parsed.schema())
            } catch let failure as PanprotoError {
                throw PanprotoFault.wrapping(failure)
            } catch {
                throw PanprotoFault.malformedSchemaDefinition(message: String(describing: error))
            }
        }
    }

    public func validateRecord(
        _ record: Data,
        againstLexicon lexicon: Data
    ) async throws(PanprotoFault) -> [String] {
        try await PanprotoEngine.run { () throws(PanprotoFault) -> [String] in
            do {
                return try violations(
                    in: record,
                    schema: SchemaHandle.parseAtprotoLexicon(lexicon)
                )
            } catch let failure as PanprotoError {
                throw PanprotoFault.wrapping(failure)
            } catch {
                throw PanprotoFault.malformedRecord(message: String(describing: error))
            }
        }
    }

    public func validateRecord(
        _ record: Data,
        againstDefinition definition: Data
    ) async throws(PanprotoFault) -> [String] {
        try await PanprotoEngine.run { () throws(PanprotoFault) -> [String] in
            do {
                return try violations(in: record, schema: schema(from: definition))
            } catch let failure as PanprotoFault {
                throw failure
            } catch let failure as PanprotoError {
                throw PanprotoFault.wrapping(failure)
            } catch {
                throw PanprotoFault.malformedSchemaDefinition(message: String(describing: error))
            }
        }
    }
}

@PanprotoEngine
private func report(for schema: SchemaHandle) throws -> PanprotoSchemaReport {
    let atproto = try ProtocolHandle.builtin("atproto")
    let metadata = try schema.metadata()
    let violations = try schema.violations(against: atproto)
    return PanprotoSchemaReport(
        protocolName: metadata.protocolName,
        vertexCount: metadata.vertices.count,
        edgeCount: metadata.edges.count,
        violations: violations
    )
}

@PanprotoEngine
func schema(from definition: Data) throws(PanprotoFault) -> SchemaHandle {
    let structural: Schema
    do {
        structural = try CBORDecoder().decode(Schema.self, from: definition)
    } catch {
        throw .malformedSchemaDefinition(message: String(describing: error))
    }

    do {
        return try SchemaHandle.define(structural)
    } catch let failure {
        throw .wrapping(failure)
    }
}

@PanprotoEngine
func violations(in record: Data, schema: SchemaHandle) throws(PanprotoError) -> [String] {
    let registry = try IoRegistryHandle.builtin()
    let instance = try registry.parseInstance(record, protocolName: "atproto", schema: schema)
    return try schema.violations(in: instance)
}

/// The app's compile-time record of the adopted binding.
public enum PanprotoAdoption {
    public static let version = LexiconRelease.panprotoVersion
    public static let packageURL = "https://github.com/panproto/panproto-swift.git"
}
