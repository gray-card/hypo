import CryptoKit
import Foundation

#if canImport(Security)
    /// A device-bound key for the encrypted local file. Creating this key does not require an
    /// iCloud account or iCloud Keychain; private capture therefore remains available offline.
    public actor LocalKeychainPrivateMeterCaptureKeyProvider:
        PrivateMeterCaptureKeyProviding
    {
        private let service: String
        private let account: String

        public init(
            service: String = "app.graycard.hypo.private-meter-context",
            account: String = "local-capture-data-key-v1"
        ) {
            self.service = service
            self.account = account
        }

        public func key() throws -> SymmetricKey {
            if let data = try load() { return SymmetricKey(data: data) }
            let data = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
            let status = SecItemAdd(
                [
                    kSecClass: kSecClassGenericPassword,
                    kSecAttrService: service,
                    kSecAttrAccount: account,
                    kSecAttrSynchronizable: false,
                    kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
                    kSecValueData: data,
                ] as CFDictionary,
                nil
            )
            if status == errSecDuplicateItem, let existing = try load() {
                return SymmetricKey(data: existing)
            }
            guard status == errSecSuccess else {
                throw PrivateMeterCaptureError.keyUnavailable
            }
            return SymmetricKey(data: data)
        }

        private func load() throws -> Data? {
            var result: CFTypeRef?
            let status = SecItemCopyMatching(
                [
                    kSecClass: kSecClassGenericPassword,
                    kSecAttrService: service,
                    kSecAttrAccount: account,
                    kSecAttrSynchronizable: false,
                    kSecReturnData: true,
                    kSecMatchLimit: kSecMatchLimitOne,
                ] as CFDictionary,
                &result
            )
            if status == errSecItemNotFound { return nil }
            guard status == errSecSuccess, let data = result as? Data else {
                throw PrivateMeterCaptureError.keyUnavailable
            }
            return data
        }
    }

    import Security
#endif

public struct SealedPrivateMeterCaptureContext: Codable, Hashable, Identifiable, Sendable {
    /// Version 1 payloads were sealed without authenticated envelope metadata. Version 2 binds the
    /// identity, timestamps, deletion state, and key fingerprint as AES-GCM associated data.
    public let envelopeVersion: Int
    public let id: UUID
    public let capturedAt: Date
    public let modifiedAt: Date
    public let isDeleted: Bool
    public let keyFingerprint: String?
    public let encryptedPayload: Data

    public init(
        envelopeVersion: Int = 2,
        id: UUID,
        capturedAt: Date,
        modifiedAt: Date? = nil,
        isDeleted: Bool = false,
        keyFingerprint: String? = nil,
        encryptedPayload: Data
    ) {
        self.envelopeVersion = envelopeVersion
        self.id = id
        self.capturedAt = capturedAt
        self.modifiedAt = modifiedAt ?? capturedAt
        self.isDeleted = isDeleted
        self.keyFingerprint = keyFingerprint
        self.encryptedPayload = encryptedPayload
    }

    private enum CodingKeys: String, CodingKey {
        case envelopeVersion, id, capturedAt, modifiedAt, isDeleted, keyFingerprint,
            encryptedPayload
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        envelopeVersion = try container.decodeIfPresent(Int.self, forKey: .envelopeVersion) ?? 1
        id = try container.decode(UUID.self, forKey: .id)
        capturedAt = try container.decode(Date.self, forKey: .capturedAt)
        modifiedAt = try container.decodeIfPresent(Date.self, forKey: .modifiedAt) ?? capturedAt
        isDeleted = try container.decodeIfPresent(Bool.self, forKey: .isDeleted) ?? false
        keyFingerprint = try container.decodeIfPresent(String.self, forKey: .keyFingerprint)
        encryptedPayload = try container.decode(Data.self, forKey: .encryptedPayload)
    }
}

/// The last-write-wins rule shared by the encrypted store and the live CloudKit adapter.
/// A deletion marker wins an exact-time tie so another device cannot resurrect private data.
public enum PrivateMeterCaptureCloudConflictPolicy {
    public static func shouldReplace(
        existing: SealedPrivateMeterCaptureContext,
        with incoming: SealedPrivateMeterCaptureContext
    ) -> Bool {
        // Capture IDs are immutable. Once any device has deleted an ID, a clock-skewed live copy
        // must not resurrect it, even if its wall clock claims a later modification time.
        if incoming.isDeleted != existing.isDeleted { return incoming.isDeleted }
        if incoming.modifiedAt != existing.modifiedAt {
            return incoming.modifiedAt > existing.modifiedAt
        }
        if incoming.isDeleted {
            let incomingIsAuthenticated =
                incoming.envelopeVersion == 2 && !incoming.encryptedPayload.isEmpty
            let existingIsAuthenticated =
                existing.envelopeVersion == 2 && !existing.encryptedPayload.isEmpty
            if incomingIsAuthenticated != existingIsAuthenticated {
                return incomingIsAuthenticated
            }
        }
        // CloudKit may present two live values with the same client timestamp. A stable digest
        // makes every device choose the same winner rather than retaining whichever value it saw.
        return deterministicRank(incoming).lexicographicallyPrecedes(deterministicRank(existing))
            == false && deterministicRank(incoming) != deterministicRank(existing)
    }

    private static func deterministicRank(_ record: SealedPrivateMeterCaptureContext) -> Data {
        SHA256.hash(data: record.conflictPolicyBytes).withUnsafeBytes { Data($0) }
    }
}

extension SealedPrivateMeterCaptureContext {
    fileprivate func withKeyFingerprint(_ fingerprint: String) -> Self {
        Self(
            envelopeVersion: envelopeVersion,
            id: id,
            capturedAt: capturedAt,
            modifiedAt: modifiedAt,
            isDeleted: isDeleted,
            keyFingerprint: fingerprint,
            encryptedPayload: encryptedPayload
        )
    }

    fileprivate var conflictPolicyBytes: Data {
        var data = authenticatedMetadata
        data.append(encryptedPayload)
        return data
    }

    fileprivate var authenticatedMetadata: Data {
        var data = Data("hypo.private-meter.envelope\u{0}".utf8)
        Self.append(UInt64(envelopeVersion), to: &data)
        data.append(contentsOf: id.uuidString.lowercased().utf8)
        data.append(0)
        Self.append(Self.milliseconds(capturedAt), to: &data)
        Self.append(Self.milliseconds(modifiedAt), to: &data)
        data.append(isDeleted ? 1 : 0)
        data.append(contentsOf: (keyFingerprint ?? "").utf8)
        return data
    }

    private static func append(_ value: UInt64, to data: inout Data) {
        var bigEndian = value.bigEndian
        withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
    }

    fileprivate static func milliseconds(_ date: Date) -> UInt64 {
        UInt64(bitPattern: Int64((date.timeIntervalSince1970 * 1_000).rounded()))
    }
}

public protocol PrivateMeterCaptureKeyProviding: Sendable {
    func key() async throws -> SymmetricKey
}

public protocol PrivateMeterCaptureCloudKeyProviding: Sendable {
    /// `allowCreation` is false when private CloudKit already contains records. In that case a new
    /// key would orphan existing ciphertext, so providers must wait for or recover the prior key.
    func key(allowCreation: Bool) async throws -> SymmetricKey
}

public enum PrivateMeterCaptureCloudKeyFingerprint {
    public static func value(for key: SymmetricKey) -> String {
        let bytes = key.withUnsafeBytes { Data($0) }
        return SHA256.hash(data: bytes).prefix(16).map { String(format: "%02x", $0) }.joined()
    }
}

public protocol PrivateMeterCaptureCloudSyncing: Sendable {
    func accountIdentifier() async throws -> String
    func records(expectedAccountIdentifier: String?) async throws
        -> [SealedPrivateMeterCaptureContext]
    func save(
        _ record: SealedPrivateMeterCaptureContext,
        expectedAccountIdentifier: String?
    ) async throws
    func delete(id: UUID, expectedAccountIdentifier: String?) async throws
    func deleteAll(expectedAccountIdentifier: String?) async throws
}

extension PrivateMeterCaptureCloudSyncing {
    public func records() async throws -> [SealedPrivateMeterCaptureContext] {
        try await records(expectedAccountIdentifier: nil)
    }

    public func save(_ record: SealedPrivateMeterCaptureContext) async throws {
        try await save(record, expectedAccountIdentifier: nil)
    }

    public func delete(id: UUID) async throws {
        try await delete(id: id, expectedAccountIdentifier: nil)
    }

    public func deleteAll() async throws {
        try await deleteAll(expectedAccountIdentifier: nil)
    }
}

public struct UnavailablePrivateMeterCaptureCloudSync: PrivateMeterCaptureCloudSyncing {
    public init() {}

    public func accountIdentifier() async throws -> String {
        throw PrivateMeterCaptureError.privateCloudUnavailable(
            "Private iCloud sync is not configured."
        )
    }

    public func records(expectedAccountIdentifier _: String?) async throws
        -> [SealedPrivateMeterCaptureContext]
    {
        throw PrivateMeterCaptureError.privateCloudUnavailable(
            "Private iCloud sync is not configured."
        )
    }

    public func save(
        _: SealedPrivateMeterCaptureContext,
        expectedAccountIdentifier _: String?
    ) async throws {
        throw PrivateMeterCaptureError.privateCloudUnavailable(
            "Private iCloud sync is not configured."
        )
    }

    public func delete(id _: UUID, expectedAccountIdentifier _: String?) async throws {
        throw PrivateMeterCaptureError.privateCloudUnavailable(
            "Private iCloud sync is not configured."
        )
    }

    public func deleteAll(expectedAccountIdentifier _: String?) async throws {
        throw PrivateMeterCaptureError.privateCloudUnavailable(
            "Private iCloud sync is not configured."
        )
    }
}

public actor InMemoryPrivateMeterCaptureCloudSync: PrivateMeterCaptureCloudSyncing {
    private var saved: [UUID: SealedPrivateMeterCaptureContext]
    private var accountID: String

    public init(
        records: [SealedPrivateMeterCaptureContext] = [],
        accountIdentifier: String = "in-memory-private-cloud"
    ) {
        saved = Dictionary(uniqueKeysWithValues: records.map { ($0.id, $0) })
        accountID = accountIdentifier
    }

    public func accountIdentifier() -> String { accountID }

    public func setAccountIdentifier(_ value: String) { accountID = value }

    public func records(expectedAccountIdentifier: String?) throws
        -> [SealedPrivateMeterCaptureContext]
    {
        try requireAccount(expectedAccountIdentifier)
        return saved.values.sorted { $0.capturedAt > $1.capturedAt }
    }

    public func save(
        _ record: SealedPrivateMeterCaptureContext,
        expectedAccountIdentifier: String?
    ) throws {
        try requireAccount(expectedAccountIdentifier)
        if let existing = saved[record.id],
            !PrivateMeterCaptureCloudConflictPolicy.shouldReplace(
                existing: existing,
                with: record
            )
        {
            return
        }
        saved[record.id] = record
    }

    public func delete(id: UUID, expectedAccountIdentifier: String?) throws {
        try requireAccount(expectedAccountIdentifier)
        saved[id] = nil
    }

    public func deleteAll(expectedAccountIdentifier: String?) throws {
        try requireAccount(expectedAccountIdentifier)
        saved.removeAll()
    }

    private func requireAccount(_ expected: String?) throws {
        guard expected == nil || expected == accountID else {
            throw PrivateMeterCaptureError.privateCloudAccountChanged
        }
    }
}

public actor EphemeralPrivateMeterCaptureKeyProvider: PrivateMeterCaptureKeyProviding {
    private let value: SymmetricKey

    public init(key: SymmetricKey = SymmetricKey(size: .bits256)) {
        value = key
    }

    public func key() -> SymmetricKey { value }
}

public actor EphemeralPrivateMeterCaptureCloudKeyProvider:
    PrivateMeterCaptureCloudKeyProviding
{
    private let value: SymmetricKey

    public init(key: SymmetricKey = SymmetricKey(size: .bits256)) {
        value = key
    }

    public func key(allowCreation _: Bool) -> SymmetricKey { value }
}

private struct MirroredPrivateMeterCaptureCloudKeyProvider:
    PrivateMeterCaptureCloudKeyProviding
{
    let base: any PrivateMeterCaptureKeyProviding

    func key(allowCreation _: Bool) async throws -> SymmetricKey {
        try await base.key()
    }
}

#if canImport(Security)
    /// A 256-bit payload key synchronized through the user's iCloud Keychain when that service is
    /// enabled. Sensor data is encrypted with this key before the private CloudKit adapter receives
    /// it; minimal record identity, time, and deletion metadata remains available for merging.
    public actor SynchronizableKeychainPrivateMeterCaptureKeyProvider:
        PrivateMeterCaptureCloudKeyProviding
    {
        private let service: String
        private let account: String

        public init(
            service: String = "app.graycard.hypo.private-meter-context",
            account: String = "capture-data-key-v1"
        ) {
            self.service = service
            self.account = account
        }

        public func key(allowCreation: Bool) throws -> SymmetricKey {
            if let data = try load() { return SymmetricKey(data: data) }
            guard allowCreation else {
                throw PrivateMeterCaptureError.privateCloudKeyUnavailable
            }
            let data = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
            let status = SecItemAdd(
                [
                    kSecClass: kSecClassGenericPassword,
                    kSecAttrService: service,
                    kSecAttrAccount: account,
                    kSecAttrSynchronizable: true,
                    kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock,
                    kSecValueData: data,
                ] as CFDictionary,
                nil
            )
            if status == errSecDuplicateItem, let existing = try load() {
                return SymmetricKey(data: existing)
            }
            guard status == errSecSuccess else {
                throw PrivateMeterCaptureError.keyUnavailable
            }
            return SymmetricKey(data: data)
        }

        private func load() throws -> Data? {
            var result: CFTypeRef?
            let status = SecItemCopyMatching(
                [
                    kSecClass: kSecClassGenericPassword,
                    kSecAttrService: service,
                    kSecAttrAccount: account,
                    kSecAttrSynchronizable: kSecAttrSynchronizableAny,
                    kSecReturnData: true,
                    kSecMatchLimit: kSecMatchLimitOne,
                ] as CFDictionary,
                &result
            )
            if status == errSecItemNotFound { return nil }
            guard status == errSecSuccess, let data = result as? Data else {
                throw PrivateMeterCaptureError.keyUnavailable
            }
            return data
        }
    }
#endif

/// An encrypted local-first context store. Device-only and private-cloud payloads use separate
/// keys; plaintext exists only while Hypo transcodes a context on one of the user's devices.
public actor EncryptedPrivateMeterCaptureContextStore: PrivateMeterCaptureContextStoring {
    private struct FileEnvelope: Codable {
        let version: Int
        var records: [SealedPrivateMeterCaptureContext]
    }

    private let fileURL: URL
    private let keyProvider: any PrivateMeterCaptureKeyProviding
    private let cloudKeyProvider: any PrivateMeterCaptureCloudKeyProviding
    private let cloud: any PrivateMeterCaptureCloudSyncing

    public init(
        fileURL: URL,
        keyProvider: any PrivateMeterCaptureKeyProviding,
        cloudKeyProvider: (any PrivateMeterCaptureCloudKeyProviding)? = nil,
        cloud: any PrivateMeterCaptureCloudSyncing = UnavailablePrivateMeterCaptureCloudSync()
    ) {
        self.fileURL = fileURL
        self.keyProvider = keyProvider
        self.cloudKeyProvider =
            cloudKeyProvider ?? MirroredPrivateMeterCaptureCloudKeyProvider(base: keyProvider)
        self.cloud = cloud
    }

    public func containsLocalPrivateData() -> Bool {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return false }
        guard let records = try? loadSealed() else { return true }
        return records.contains { !$0.isDeleted }
    }

    public func contexts() async throws -> [PrivateMeterCaptureContext] {
        let key = try await keyProvider.key()
        var sealed = try loadSealed()
        try sealed.filter(\.isDeleted).forEach { try validateTombstone($0, key: key) }
        let values = try sealed.filter { !$0.isDeleted }.map { try open($0, key: key) }
            .sorted { $0.capturedAt > $1.capturedAt }
        if sealed.contains(where: { !$0.isDeleted && $0.envelopeVersion == 1 }) {
            sealed = try sealed.map { record in
                guard !record.isDeleted, record.envelopeVersion == 1 else { return record }
                return try seal(
                    open(record, key: key),
                    key: key,
                    modifiedAt: record.modifiedAt
                )
            }
            try write(sealed)
        }
        return values
    }

    public func save(
        _ context: PrivateMeterCaptureContext,
        syncToPrivateCloud: Bool,
        expectedCloudAccountIdentifier: String?
    ) async throws {
        let key = try await keyProvider.key()
        let modifiedAt = Date()
        let sealed = try seal(context, key: key, modifiedAt: modifiedAt)
        var local = try loadSealed()
        // A capture ID is immutable. Retaining a tombstone prevents a delayed retry from
        // recreating data that the user already deleted.
        if local.contains(where: { $0.id == sealed.id && $0.isDeleted }) { return }
        local.removeAll { $0.id == sealed.id }
        local.append(sealed)
        try write(local)
        if syncToPrivateCloud {
            do {
                let remote = try await cloud.records(
                    expectedAccountIdentifier: expectedCloudAccountIdentifier
                )
                if let remoteDeletion = remote.first(where: { $0.id == context.id && $0.isDeleted }) {
                    let localDeletion = try authenticatedTombstone(
                        from: SealedPrivateMeterCaptureContext(
                            envelopeVersion: 2,
                            id: context.id,
                            capturedAt: context.capturedAt,
                            modifiedAt: max(modifiedAt, remoteDeletion.modifiedAt),
                            isDeleted: true,
                            encryptedPayload: Data()
                        ),
                        key: key
                    )
                    try write(local.filter { $0.id != context.id } + [localDeletion])
                    throw PrivateMeterCaptureError.privateContextAlreadyDeleted
                }
                let (cloudKey, fingerprint) = try await validatedCloudKey(for: remote)
                try await cloud.save(
                    try seal(
                        context,
                        key: cloudKey,
                        modifiedAt: modifiedAt,
                        keyFingerprint: fingerprint
                    ),
                    expectedAccountIdentifier: expectedCloudAccountIdentifier
                )
            } catch {
                if error as? PrivateMeterCaptureError == .privateContextAlreadyDeleted {
                    throw error
                }
                if error as? PrivateMeterCaptureError == .privateCloudAccountChanged {
                    throw PrivateMeterCaptureError.privateCloudAccountChangedAfterLocalSave
                }
                throw PrivateMeterCaptureError.privateCloudSaveFailedAfterLocalSave(
                    String(describing: error)
                )
            }
        }
    }

    public func delete(
        id: UUID,
        syncToPrivateCloud: Bool,
        expectedCloudAccountIdentifier: String?
    ) async throws {
        var local = loadSealedForDeletion()
        guard let existing = local.first(where: { $0.id == id }) else { return }
        var tombstone = unsignedTombstone(for: existing, deletedAt: Date())
        local.removeAll { $0.id == id }
        local.append(tombstone)
        // The first write replaces the sensitive ciphertext before any key or network access.
        try write(local)
        if let localKey = try? await keyProvider.key() {
            tombstone = (try? authenticatedTombstone(from: tombstone, key: localKey)) ?? tombstone
            local.removeAll { $0.id == id }
            local.append(tombstone)
            try write(local)
        }
        if syncToPrivateCloud {
            do {
                let remote = try await cloud.records(
                    expectedAccountIdentifier: expectedCloudAccountIdentifier
                )
                let cloudTombstone = try await cloudTombstone(
                    from: tombstone,
                    remote: remote
                )
                try await cloud.save(
                    cloudTombstone,
                    expectedAccountIdentifier: expectedCloudAccountIdentifier
                )
            } catch {
                if error as? PrivateMeterCaptureError == .privateCloudAccountChanged {
                    throw PrivateMeterCaptureError.privateCloudAccountChangedAfterLocalDeletion
                }
                throw PrivateMeterCaptureError.privateCloudDeletionPending(
                    String(describing: error)
                )
            }
        }
    }

    public func deleteAll(
        syncToPrivateCloud: Bool,
        expectedCloudAccountIdentifier: String?
    ) async throws {
        let deletedAt = Date()
        var tombstones = loadSealedForDeletion().map {
            unsignedTombstone(for: $0, deletedAt: deletedAt)
        }
        // This replacement is deliberately first. Deletion therefore succeeds locally without a
        // key, network, CloudKit account, or decryptable payload.
        try write(tombstones)
        let localTombstoneKey = try? await keyProvider.key()
        if let localTombstoneKey {
            tombstones = tombstones.map {
                (try? authenticatedTombstone(from: $0, key: localTombstoneKey)) ?? $0
            }
            try write(tombstones)
        }
        guard syncToPrivateCloud else { return }
        do {
            let remote = try await cloud.records(
                expectedAccountIdentifier: expectedCloudAccountIdentifier
            )
            let existingIDs = Set(tombstones.map(\.id))
            let remoteOnlyTombstones = remote.filter { !existingIDs.contains($0.id) }.map {
                unsignedTombstone(for: $0, deletedAt: deletedAt)
            }
            tombstones.append(contentsOf: remoteOnlyTombstones)
            if let localTombstoneKey {
                tombstones = tombstones.map {
                    (try? authenticatedTombstone(from: $0, key: localTombstoneKey)) ?? $0
                }
            }
            // Retain every marker locally before uploading any of them, so an interrupted batch is
            // retryable and no later pull can restore a record already selected for deletion.
            try write(tombstones)
            for tombstone in tombstones {
                try await cloud.save(
                    try await cloudTombstone(from: tombstone, remote: remote),
                    expectedAccountIdentifier: expectedCloudAccountIdentifier
                )
            }
        } catch {
            if error as? PrivateMeterCaptureError == .privateCloudAccountChanged {
                throw PrivateMeterCaptureError.privateCloudAccountChangedAfterLocalDeletion
            }
            throw PrivateMeterCaptureError.privateCloudDeletionPending(String(describing: error))
        }
    }

    public func privateCloudAccountIdentifier() async throws -> String {
        try await cloud.accountIdentifier()
    }

    public func synchronizePrivateCloud(expectedCloudAccountIdentifier: String?) async throws {
        let remote = try await cloud.records(
            expectedAccountIdentifier: expectedCloudAccountIdentifier
        )
        let local = try loadSealed()
        let localKey = try await keyProvider.key()
        let (cloudKey, fingerprint) = try await validatedCloudKey(for: remote)
        try local.filter(\.isDeleted).forEach { try validateTombstone($0, key: localKey) }
        try remote.filter(\.isDeleted).forEach { try validateTombstone($0, key: cloudKey) }
        var merged = Dictionary(uniqueKeysWithValues: local.map { ($0.id, $0) })
        for record in remote {
            if let existingLocal = merged[record.id] {
                if PrivateMeterCaptureCloudConflictPolicy.shouldReplace(
                    existing: existingLocal,
                    with: record
                ) {
                    let localized = try localRecord(
                        from: record,
                        cloudKey: cloudKey,
                        localKey: localKey
                    )
                    merged[record.id] = localized
                    if record.isDeleted, record.encryptedPayload.isEmpty {
                        try await cloud.save(
                            try cloudRecord(
                                from: localized,
                                localKey: localKey,
                                cloudKey: cloudKey,
                                keyFingerprint: fingerprint
                            ),
                            expectedAccountIdentifier: expectedCloudAccountIdentifier
                        )
                    }
                } else if PrivateMeterCaptureCloudConflictPolicy.shouldReplace(
                    existing: record,
                    with: existingLocal
                ) {
                    try await cloud.save(
                        try cloudRecord(
                            from: existingLocal,
                            localKey: localKey,
                            cloudKey: cloudKey,
                            keyFingerprint: fingerprint
                        ),
                        expectedAccountIdentifier: expectedCloudAccountIdentifier
                    )
                }
            } else {
                let localized = try localRecord(
                    from: record,
                    cloudKey: cloudKey,
                    localKey: localKey
                )
                merged[record.id] = localized
                if record.isDeleted, record.encryptedPayload.isEmpty {
                    try await cloud.save(
                        try cloudRecord(
                            from: localized,
                            localKey: localKey,
                            cloudKey: cloudKey,
                            keyFingerprint: fingerprint
                        ),
                        expectedAccountIdentifier: expectedCloudAccountIdentifier
                    )
                }
            }
        }
        let remoteIDs = Set(remote.map(\.id))
        for record in local where !remoteIDs.contains(record.id) {
            try await cloud.save(
                try cloudRecord(
                    from: record,
                    localKey: localKey,
                    cloudKey: cloudKey,
                    keyFingerprint: fingerprint
                ),
                expectedAccountIdentifier: expectedCloudAccountIdentifier
            )
        }
        try write(Array(merged.values))
    }

    public func exportJSON() async throws -> Data {
        let values = try await contexts()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(values)
    }

    private func seal(
        _ context: PrivateMeterCaptureContext,
        key: SymmetricKey,
        modifiedAt: Date,
        keyFingerprint: String? = nil
    ) throws -> SealedPrivateMeterCaptureContext {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let plaintext = try encoder.encode(context)
        let metadataRecord = SealedPrivateMeterCaptureContext(
            envelopeVersion: 2,
            id: context.id,
            capturedAt: context.capturedAt,
            modifiedAt: modifiedAt,
            keyFingerprint: keyFingerprint,
            encryptedPayload: Data()
        )
        let box = try AES.GCM.seal(
            plaintext,
            using: key,
            authenticating: metadataRecord.authenticatedMetadata
        )
        guard let combined = box.combined else {
            throw PrivateMeterCaptureError.corruptLocalStore
        }
        return SealedPrivateMeterCaptureContext(
            envelopeVersion: 2,
            id: context.id,
            capturedAt: context.capturedAt,
            modifiedAt: modifiedAt,
            keyFingerprint: keyFingerprint,
            encryptedPayload: combined
        )
    }

    private func localRecord(
        from cloudRecord: SealedPrivateMeterCaptureContext,
        cloudKey: SymmetricKey,
        localKey: SymmetricKey
    ) throws -> SealedPrivateMeterCaptureContext {
        guard !cloudRecord.isDeleted else {
            if let payload = try? authenticatedTombstone(from: cloudRecord, key: localKey) {
                return payload
            }
            return SealedPrivateMeterCaptureContext(
                envelopeVersion: cloudRecord.envelopeVersion,
                id: cloudRecord.id,
                capturedAt: cloudRecord.capturedAt,
                modifiedAt: cloudRecord.modifiedAt,
                isDeleted: true,
                encryptedPayload: Data()
            )
        }
        return try seal(
            open(cloudRecord, key: cloudKey),
            key: localKey,
            modifiedAt: cloudRecord.modifiedAt
        )
    }

    private func cloudRecord(
        from localRecord: SealedPrivateMeterCaptureContext,
        localKey: SymmetricKey,
        cloudKey: SymmetricKey,
        keyFingerprint: String
    ) throws -> SealedPrivateMeterCaptureContext {
        guard !localRecord.isDeleted else {
            return try authenticatedTombstone(
                from: localRecord.withKeyFingerprint(keyFingerprint),
                key: cloudKey
            )
        }
        return try seal(
            open(localRecord, key: localKey),
            key: cloudKey,
            modifiedAt: localRecord.modifiedAt,
            keyFingerprint: keyFingerprint
        )
    }

    private func validatedCloudKey(
        for remote: [SealedPrivateMeterCaptureContext]
    ) async throws -> (key: SymmetricKey, fingerprint: String) {
        let key = try await cloudKeyProvider.key(allowCreation: remote.isEmpty)
        let fingerprint = PrivateMeterCaptureCloudKeyFingerprint.value(for: key)
        for record in remote {
            if let existingFingerprint = record.keyFingerprint {
                guard existingFingerprint == fingerprint else {
                    throw PrivateMeterCaptureError.privateCloudKeyMismatch
                }
            } else if !record.isDeleted {
                throw PrivateMeterCaptureError.privateCloudKeyMismatch
            }
        }
        return (key, fingerprint)
    }

    private func open(
        _ record: SealedPrivateMeterCaptureContext,
        key: SymmetricKey
    ) throws -> PrivateMeterCaptureContext {
        do {
            let box = try AES.GCM.SealedBox(combined: record.encryptedPayload)
            let plaintext: Data
            switch record.envelopeVersion {
            case 1:
                plaintext = try AES.GCM.open(box, using: key)
            case 2:
                plaintext = try AES.GCM.open(
                    box,
                    using: key,
                    authenticating: record.authenticatedMetadata
                )
            default:
                throw PrivateMeterCaptureError.corruptLocalStore
            }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy =
                record.envelopeVersion == 1 ? .iso8601 : .millisecondsSince1970
            let context = try decoder.decode(PrivateMeterCaptureContext.self, from: plaintext)
            guard context.id == record.id,
                SealedPrivateMeterCaptureContext.milliseconds(context.capturedAt)
                    == SealedPrivateMeterCaptureContext.milliseconds(record.capturedAt)
            else {
                throw PrivateMeterCaptureError.corruptLocalStore
            }
            return context
        } catch {
            throw PrivateMeterCaptureError.corruptLocalStore
        }
    }

    private func loadSealed() throws -> [SealedPrivateMeterCaptureContext] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [] }
        do {
            let data = try Data(contentsOf: fileURL)
            let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let fileVersion = raw?["version"] as? Int ?? 1
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy =
                fileVersion == 1 ? .iso8601 : .millisecondsSince1970
            let envelope = try decoder.decode(
                FileEnvelope.self,
                from: data
            )
            guard envelope.version == 1 || envelope.version == 2 else {
                throw PrivateMeterCaptureError.corruptLocalStore
            }
            return envelope.records
        } catch let error as PrivateMeterCaptureError {
            throw error
        } catch {
            throw PrivateMeterCaptureError.corruptLocalStore
        }
    }

    /// Parses only envelope metadata for deletion. If even that metadata is corrupt, returning an
    /// empty list lets the caller atomically replace the unreadable file and erase its payload.
    private func loadSealedForDeletion() -> [SealedPrivateMeterCaptureContext] {
        (try? loadSealed()) ?? []
    }

    private func unsignedTombstone(
        for record: SealedPrivateMeterCaptureContext,
        deletedAt: Date
    ) -> SealedPrivateMeterCaptureContext {
        SealedPrivateMeterCaptureContext(
            envelopeVersion: 2,
            id: record.id,
            capturedAt: record.capturedAt,
            modifiedAt: max(record.modifiedAt, deletedAt),
            isDeleted: true,
            keyFingerprint: record.keyFingerprint,
            encryptedPayload: Data()
        )
    }

    private func authenticatedTombstone(
        from record: SealedPrivateMeterCaptureContext,
        key: SymmetricKey
    ) throws -> SealedPrivateMeterCaptureContext {
        let metadataRecord = SealedPrivateMeterCaptureContext(
            envelopeVersion: 2,
            id: record.id,
            capturedAt: record.capturedAt,
            modifiedAt: record.modifiedAt,
            isDeleted: true,
            keyFingerprint: record.keyFingerprint,
            encryptedPayload: Data()
        )
        let box = try AES.GCM.seal(
            Data(),
            using: key,
            authenticating: metadataRecord.authenticatedMetadata
        )
        guard let combined = box.combined else {
            throw PrivateMeterCaptureError.corruptLocalStore
        }
        return SealedPrivateMeterCaptureContext(
            envelopeVersion: 2,
            id: record.id,
            capturedAt: record.capturedAt,
            modifiedAt: record.modifiedAt,
            isDeleted: true,
            keyFingerprint: record.keyFingerprint,
            encryptedPayload: combined
        )
    }

    private func validateTombstone(
        _ record: SealedPrivateMeterCaptureContext,
        key: SymmetricKey
    ) throws {
        guard record.isDeleted, !record.encryptedPayload.isEmpty else { return }
        guard record.envelopeVersion == 2 else {
            throw PrivateMeterCaptureError.corruptLocalStore
        }
        do {
            let box = try AES.GCM.SealedBox(combined: record.encryptedPayload)
            let plaintext = try AES.GCM.open(
                box,
                using: key,
                authenticating: record.authenticatedMetadata
            )
            guard plaintext.isEmpty else { throw PrivateMeterCaptureError.corruptLocalStore }
        } catch {
            throw PrivateMeterCaptureError.corruptLocalStore
        }
    }

    private func cloudTombstone(
        from tombstone: SealedPrivateMeterCaptureContext,
        remote: [SealedPrivateMeterCaptureContext]
    ) async throws -> SealedPrivateMeterCaptureContext {
        let matchingFingerprint = remote.first { $0.id == tombstone.id }?.keyFingerprint
        let fallbackFingerprint =
            Set(remote.compactMap(\.keyFingerprint)).count == 1
            ? remote.compactMap(\.keyFingerprint).first : nil
        let fingerprint = matchingFingerprint ?? tombstone.keyFingerprint ?? fallbackFingerprint
        let unsigned = SealedPrivateMeterCaptureContext(
            envelopeVersion: 2,
            id: tombstone.id,
            capturedAt: tombstone.capturedAt,
            modifiedAt: tombstone.modifiedAt,
            isDeleted: true,
            keyFingerprint: fingerprint,
            encryptedPayload: Data()
        )
        guard let key = try? await cloudKeyProvider.key(allowCreation: remote.isEmpty) else {
            return unsigned
        }
        let actualFingerprint = PrivateMeterCaptureCloudKeyFingerprint.value(for: key)
        guard fingerprint == nil || fingerprint == actualFingerprint else {
            // Key loss must not block deletion. An unsigned marker retains the existing fingerprint
            // so the live ciphertext can still be removed on other devices.
            return unsigned
        }
        return try authenticatedTombstone(
            from: SealedPrivateMeterCaptureContext(
                envelopeVersion: 2,
                id: unsigned.id,
                capturedAt: unsigned.capturedAt,
                modifiedAt: unsigned.modifiedAt,
                isDeleted: true,
                keyFingerprint: actualFingerprint,
                encryptedPayload: Data()
            ),
            key: key
        )
    }

    private func write(_ records: [SealedPrivateMeterCaptureContext]) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        let envelope = FileEnvelope(
            version: 2,
            records: records.sorted { $0.capturedAt > $1.capturedAt }
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(envelope).write(
            to: fileURL,
            options: privateMeterCaptureWriteOptions
        )
    }
}
