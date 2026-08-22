import Foundation

/// The integrity-checked catalog snapshot staged from web Hypo at build time.
public enum BundledCatalog {
    public static func load() throws -> CatalogSnapshot {
        guard let root = Bundle.module.url(forResource: "Catalog", withExtension: nil) else {
            throw BundledCatalogError.resourceMissing
        }
        return try CatalogSnapshot.load(from: root)
    }
}

public enum BundledCatalogError: Error, Equatable, Sendable {
    case resourceMissing
}
