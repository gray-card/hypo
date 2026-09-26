import CryptoKit
import Foundation
import Testing
@testable import CatalogKit

@Suite("Catalog snapshot")
struct CatalogSnapshotTests {
    @Test("The bundled production snapshot is present and passes integrity checks")
    func bundledSnapshot() throws {
        let snapshot = try BundledCatalog.load()
        #expect(
            snapshot.manifest.shards.keys.sorted() == [
                "cameras", "darkroom-products", "dev-times", "film-stocks", "lenses",
            ])
        #expect(snapshot.shards["cameras"]?.items.isEmpty == false)
        #expect(snapshot.shards["lenses"]?.items.isEmpty == false)
        #expect(snapshot.search("Nikon", domains: ["cameras"]).isEmpty == false)
    }

    @Test("Integrity-checked snapshots search labels, alternate fields, and typos")
    func loadAndSearch() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let item = CatalogItem(fields: [
            "catalogKind": .string("lensType"),
            "make": .string("Nikon"),
            "model": .string("Nikkor 50mm f/1.4 pre-AI"),
            "alternativeNames": .array([.string("Nikkor 50mm f/1.4 non-AI")]),
        ])
        let shard = CatalogShard(schemaVersion: 1, domain: "lenses", sources: [], items: [item])
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        var shardData = try encoder.encode(shard)
        shardData.append(0x0A)
        let digest = SHA256.hash(data: shardData).map { String(format: "%02x", $0) }.joined()
        let catalogHash = String(repeating: "a", count: 64)
        let version = directory.appendingPathComponent(catalogHash, isDirectory: true)
        try FileManager.default.createDirectory(at: version, withIntermediateDirectories: true)
        try shardData.write(to: version.appendingPathComponent("lenses.json"))
        let manifest = CatalogManifest(
            schemaVersion: 1,
            hashAlgorithm: "sha256",
            catalogHash: catalogHash,
            shards: [
                "lenses": CatalogShardDescriptor(
                    path: "\(catalogHash)/lenses.json",
                    sha256: digest,
                    bytes: shardData.count,
                    itemCount: 1
                )
            ]
        )
        try encoder.encode(manifest).write(to: directory.appendingPathComponent("manifest.json"))

        let snapshot = try CatalogSnapshot.load(from: directory)
        #expect(snapshot.search("nikon").first?.item == item)
        #expect(snapshot.search("non ai").first?.item == item)
        #expect(snapshot.search("nikkrr").first?.item == item)
        #expect(snapshot.item(identity: item.stableIdentity) == item)
    }

    @Test("Tampered shard bodies fail closed")
    func tamper() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let catalogHash = String(repeating: "b", count: 64)
        let version = directory.appendingPathComponent(catalogHash, isDirectory: true)
        try FileManager.default.createDirectory(at: version, withIntermediateDirectories: true)
        let data = Data("{}\n".utf8)
        try data.write(to: version.appendingPathComponent("cameras.json"))
        let manifest = CatalogManifest(
            schemaVersion: 1,
            hashAlgorithm: "sha256",
            catalogHash: catalogHash,
            shards: [
                "cameras": CatalogShardDescriptor(
                    path: "\(catalogHash)/cameras.json",
                    sha256: String(repeating: "0", count: 64),
                    bytes: data.count,
                    itemCount: 0
                )
            ]
        )
        try JSONEncoder().encode(manifest).write(to: directory.appendingPathComponent("manifest.json"))

        #expect(throws: CatalogError.self) {
            try CatalogSnapshot.load(from: directory)
        }
    }
}
