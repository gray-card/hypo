import CryptoKit
import Foundation
import Security

public enum KeychainAccessibility: String, Codable, Hashable, Sendable {
    /// Available after first unlock; excluded from device backups and migration.
    case afterFirstUnlockThisDeviceOnly
    /// Available while unlocked; excluded from device backups and migration.
    case whenUnlockedThisDeviceOnly
}

public struct KeychainItemKey: Hashable, Codable, Sendable {
    public var service: String
    public var account: String
    public var accessGroup: String?

    public init(service: String, account: String, accessGroup: String? = nil) {
        self.service = service
        self.account = account
        self.accessGroup = accessGroup
    }
}

public enum KeychainError: Error, Equatable, Sendable {
    case unexpectedStatus(OSStatus)
    case invalidStoredData
}

/// Testable data-level Keychain boundary. It avoids exposing non-Sendable CFDictionary values.
public protocol KeychainDataStore: Sendable {
    func read(_ key: KeychainItemKey) async throws -> Data?
    func write(_ data: Data, for key: KeychainItemKey, accessibility: KeychainAccessibility) async throws
    func remove(_ key: KeychainItemKey) async throws
}

/// Security.framework generic-password implementation.
public actor SecurityKeychainDataStore: KeychainDataStore {
    public init() {}

    public func read(_ key: KeychainItemKey) throws -> Data? {
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
        guard let data = result as? Data else { throw KeychainError.invalidStoredData }
        return data
    }

    public func write(
        _ data: Data,
        for key: KeychainItemKey,
        accessibility: KeychainAccessibility
    ) throws {
        let query = baseQuery(key)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: accessibility.securityValue,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(updateStatus)
        }
        var addition = query
        attributes.forEach { addition[$0.key] = $0.value }
        let addStatus = SecItemAdd(addition as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw KeychainError.unexpectedStatus(addStatus) }
    }

    public func remove(_ key: KeychainItemKey) throws {
        let status = SecItemDelete(baseQuery(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }

    private func baseQuery(_ key: KeychainItemKey) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: key.service,
            kSecAttrAccount as String: key.account,
        ]
        if let accessGroup = key.accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        return query
    }
}

private extension KeychainAccessibility {
    var securityValue: CFString {
        switch self {
        case .afterFirstUnlockThisDeviceOnly: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        case .whenUnlockedThisDeviceOnly: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        }
    }
}

/// In-memory Keychain-shaped storage for previews and deterministic tests.
public actor InMemoryKeychainDataStore: KeychainDataStore {
    public struct Item: Equatable, Sendable {
        public var data: Data
        public var accessibility: KeychainAccessibility
    }

    private var items: [KeychainItemKey: Item]

    public init(items: [KeychainItemKey: Item] = [:]) { self.items = items }
    public func read(_ key: KeychainItemKey) -> Data? { items[key]?.data }
    public func write(_ data: Data, for key: KeychainItemKey, accessibility: KeychainAccessibility) {
        items[key] = Item(data: data, accessibility: accessibility)
    }
    public func remove(_ key: KeychainItemKey) { items.removeValue(forKey: key) }
    public func item(for key: KeychainItemKey) -> Item? { items[key] }
}

public actor KeychainOAuthSessionStore: OAuthSessionStore {
    private let keychain: any KeychainDataStore
    private let service: String
    private let accessGroup: String?
    private let accessibility: KeychainAccessibility
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(
        keychain: any KeychainDataStore = SecurityKeychainDataStore(),
        service: String,
        accessGroup: String? = nil,
        accessibility: KeychainAccessibility = .afterFirstUnlockThisDeviceOnly
    ) {
        self.keychain = keychain
        self.service = service
        self.accessGroup = accessGroup
        self.accessibility = accessibility
    }

    public func load(id: OAuthSessionID) async throws -> OAuthSession? {
        guard let data = try await keychain.read(key(for: id)) else { return nil }
        return try decoder.decode(OAuthSession.self, from: data)
    }

    public func save(_ session: OAuthSession) async throws {
        try await keychain.write(
            encoder.encode(session),
            for: key(for: session.id),
            accessibility: accessibility
        )
    }

    public func remove(id: OAuthSessionID) async throws {
        try await keychain.remove(key(for: id))
    }

    private func key(for id: OAuthSessionID) -> KeychainItemKey {
        KeychainItemKey(service: service, account: "oauth-session:\(id.rawValue)", accessGroup: accessGroup)
    }
}

public protocol DPoPKeyCustody: Sendable {
    func load(sessionID: OAuthSessionID) async throws -> P256.Signing.PrivateKey?
    func loadOrCreate(sessionID: OAuthSessionID) async throws -> P256.Signing.PrivateKey
    func remove(sessionID: OAuthSessionID) async throws
}

/// Stores a software P-256 private key in the Keychain. This does not claim Secure Enclave
/// interoperability; Secure Enclave signing requires a separate signer abstraction and key type.
public actor KeychainDPoPKeyCustody: DPoPKeyCustody {
    private let keychain: any KeychainDataStore
    private let service: String
    private let accessGroup: String?
    private let accessibility: KeychainAccessibility

    public init(
        keychain: any KeychainDataStore = SecurityKeychainDataStore(),
        service: String,
        accessGroup: String? = nil,
        accessibility: KeychainAccessibility = .afterFirstUnlockThisDeviceOnly
    ) {
        self.keychain = keychain
        self.service = service
        self.accessGroup = accessGroup
        self.accessibility = accessibility
    }

    public func load(sessionID: OAuthSessionID) async throws -> P256.Signing.PrivateKey? {
        guard let stored = try await keychain.read(key(for: sessionID)) else { return nil }
        return try P256.Signing.PrivateKey(rawRepresentation: stored)
    }

    public func loadOrCreate(sessionID: OAuthSessionID) async throws -> P256.Signing.PrivateKey {
        if let existing = try await load(sessionID: sessionID) { return existing }
        let itemKey = key(for: sessionID)
        let key = P256.Signing.PrivateKey()
        try await keychain.write(
            key.rawRepresentation,
            for: itemKey,
            accessibility: accessibility
        )
        return key
    }

    public func remove(sessionID: OAuthSessionID) async throws {
        try await keychain.remove(key(for: sessionID))
    }

    private func key(for id: OAuthSessionID) -> KeychainItemKey {
        KeychainItemKey(service: service, account: "dpop-p256:\(id.rawValue)", accessGroup: accessGroup)
    }
}
