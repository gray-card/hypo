import CryptoKit
import Foundation

/// An immutable, integrity-checked catalog snapshot shipped with one app release.
public struct CatalogSnapshot: Sendable {
    public let manifest: CatalogManifest
    public let shards: [String: CatalogShard]

    public init(manifest: CatalogManifest, shards: [String: CatalogShard]) {
        self.manifest = manifest
        self.shards = shards
    }

    public static func load(from directory: URL) throws -> CatalogSnapshot {
        let decoder = JSONDecoder()
        let manifestData = try Data(contentsOf: directory.appendingPathComponent("manifest.json"))
        let manifest: CatalogManifest
        do {
            manifest = try decoder.decode(CatalogManifest.self, from: manifestData)
        } catch {
            throw CatalogError.malformedManifest(String(describing: error))
        }
        guard manifest.schemaVersion == 1 else {
            throw CatalogError.unsupportedSchemaVersion(manifest.schemaVersion)
        }
        guard manifest.hashAlgorithm == "sha256" else {
            throw CatalogError.unsupportedHashAlgorithm(manifest.hashAlgorithm)
        }
        guard isDigest(manifest.catalogHash) else {
            throw CatalogError.malformedManifest("The catalog hash is not SHA-256.")
        }

        var shards: [String: CatalogShard] = [:]
        for (domain, descriptor) in manifest.shards {
            guard isSafe(path: descriptor.path),
                descriptor.path.hasPrefix("\(manifest.catalogHash)/")
            else {
                throw CatalogError.unsafePath(descriptor.path)
            }
            let url = directory.appendingPathComponent(descriptor.path)
            guard FileManager.default.fileExists(atPath: url.path) else {
                throw CatalogError.missingShard(domain)
            }
            let data = try Data(contentsOf: url)
            guard data.count == descriptor.bytes else {
                throw CatalogError.byteCount(
                    domain: domain,
                    expected: descriptor.bytes,
                    actual: data.count
                )
            }
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard digest == descriptor.sha256 else {
                throw CatalogError.digest(domain: domain, expected: descriptor.sha256, actual: digest)
            }
            let shard = try decoder.decode(CatalogShard.self, from: data)
            guard shard.schemaVersion == 1 else {
                throw CatalogError.unsupportedSchemaVersion(shard.schemaVersion)
            }
            guard shard.domain == domain else {
                throw CatalogError.domain(expected: domain, actual: shard.domain)
            }
            guard shard.items.count == descriptor.itemCount else {
                throw CatalogError.itemCount(
                    domain: domain,
                    expected: descriptor.itemCount,
                    actual: shard.items.count
                )
            }
            shards[domain] = shard
        }
        return CatalogSnapshot(manifest: manifest, shards: shards)
    }

    public func item(identity: String, in domain: String? = nil) -> CatalogItem? {
        let candidates = domain.flatMap { shards[$0].map { [$0] } } ?? Array(shards.values)
        return candidates.lazy.flatMap(\.items).first { $0.stableIdentity == identity }
    }

    public func search(
        _ query: String,
        domains: Set<String>? = nil,
        fields: Set<String>? = nil,
        limit: Int = 50
    ) -> [CatalogSearchResult] {
        guard limit > 0 else { return [] }
        return
            shards
            .filter { domains?.contains($0.key) ?? true }
            .flatMap {
                CatalogSearch.search(domain: $0.key, items: $0.value.items, query: query, fields: fields)
            }
            .sorted {
                if $0.score == $1.score { return $0.item.label < $1.item.label }
                return $0.score > $1.score
            }
            .prefix(limit)
            .map { $0 }
    }

    private static func isDigest(_ value: String) -> Bool {
        value.count == 64 && value.allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }

    private static func isSafe(path: String) -> Bool {
        !path.isEmpty && !path.contains("\\") && !path.split(separator: "/").contains("..")
    }
}
