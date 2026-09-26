import Foundation

public enum CatalogSearch {
    public static func normalize(_ value: String) -> String {
        value
            .decomposedStringWithCompatibilityMapping
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en"))
            .lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    static func search(
        domain: String,
        items: [CatalogItem],
        query: String,
        fields: Set<String>?
    ) -> [CatalogSearchResult] {
        let query = normalize(query)
        guard !query.isEmpty else { return [] }
        return items.enumerated().compactMap { index, item in
            let label = normalize(item.label)
            let values = Set(
                item.fields
                    .filter { fields?.contains($0.key) ?? true }
                    .flatMap { $0.value.scalarStrings() }
                    .map(normalize)
                    .filter { !$0.isEmpty }
            )
            let score = relevance(query: query, label: label, values: values)
            guard score > 0 else { return nil }
            return CatalogSearchResult(
                domain: domain,
                item: item,
                score: score - Double(index) / 1_000_000_000
            )
        }
    }

    private static func relevance(query: String, label: String, values: Set<String>) -> Double {
        if label == query { return 1_000 }
        if label.hasPrefix(query) { return 850 - Double(min(100, label.count - query.count)) }
        if let range = label.range(of: query) {
            return 700 - Double(min(100, label.distance(from: label.startIndex, to: range.lowerBound)))
        }

        let queryTokens = query.split(separator: " ").map(String.init)
        let valueTokens = values.flatMap { $0.split(separator: " ").map(String.init) }
        var tokenScore = 0.0
        for token in queryTokens {
            if valueTokens.contains(token) {
                tokenScore += 100
            } else if valueTokens.contains(where: { $0.hasPrefix(token) }) {
                tokenScore += 75
            } else if values.contains(where: { $0.contains(token) }) {
                tokenScore += 45
            } else {
                return fuzzy(query: query, label: label, values: values)
            }
        }
        return 450 + tokenScore
    }

    private static func fuzzy(query: String, label: String, values: Set<String>) -> Double {
        guard query.count >= 3 else { return 0 }
        let maximum = max(1, min(3, query.count / 4))
        var best = maximum + 1
        for candidate in [label] + values.filter({ $0.count <= 80 }) {
            best = min(best, boundedDistance(query, candidate, maximum: maximum))
            for token in candidate.split(separator: " ") {
                best = min(best, boundedDistance(query, String(token), maximum: maximum))
            }
        }
        return best <= maximum ? 250 - Double(best * 40) : 0
    }

    private static func boundedDistance(_ left: String, _ right: String, maximum: Int) -> Int {
        let left = Array(left)
        let right = Array(right)
        guard abs(left.count - right.count) <= maximum else { return maximum + 1 }
        var previous = Array(0...right.count)
        for row in 1...left.count {
            var current = [row]
            var rowMinimum = row
            for column in 1...right.count {
                let value = min(
                    previous[column] + 1,
                    current[column - 1] + 1,
                    previous[column - 1] + (left[row - 1] == right[column - 1] ? 0 : 1)
                )
                current.append(value)
                rowMinimum = min(rowMinimum, value)
            }
            if rowMinimum > maximum { return maximum + 1 }
            previous = current
        }
        return previous[right.count]
    }
}
