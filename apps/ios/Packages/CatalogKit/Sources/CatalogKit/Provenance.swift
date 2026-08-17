import Foundation

public extension CatalogItem {
    var provenanceBadge: ProvenanceBadge {
        let documents: [[String: JSONValue]]
        if case .array(let values) = fields["documents"] {
            documents = values.compactMap {
                if case .object(let object) = $0 { return object }
                return nil
            }
        } else {
            documents = []
        }
        let first = documents.first
        let publisher = first?["publisher"]?.stringValue
        let kind = first?["kind"]?.stringValue
        let asset: [String: JSONValue]?
        if case .object(let value) = first?["asset"] { asset = value } else { asset = nil }
        let support: ProvenanceBadge.Support
        if kind == "technical-data", publisher != nil {
            support = .manufacturer
        } else if publisher != nil {
            support = .published
        } else if fields["derivedFrom"] != nil || fields["derivation"] != nil {
            support = .derived
        } else if fields["source"] != nil {
            support = .community
        } else {
            support = .unknown
        }

        return ProvenanceBadge(
            support: support,
            publisher: publisher,
            documentTitle: asset?["title"]?.stringValue,
            page: first?["page"]?.stringValue,
            table: first?["table"]?.stringValue
        )
    }
}
