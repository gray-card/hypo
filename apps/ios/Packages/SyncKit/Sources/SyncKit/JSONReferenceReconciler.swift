import Foundation

public enum JSONReferenceReconciler {
    /// Replaces exact string values throughout a JSON object. Non-JSON data is returned unchanged.
    public static func replacing(_ oldURI: String, with newURI: String, in data: Data) -> Data {
        guard let object = try? JSONSerialization.jsonObject(with: data) else { return data }
        let changed = replace(oldURI, with: newURI, in: object)
        return (try? JSONSerialization.data(withJSONObject: changed, options: [.sortedKeys])) ?? data
    }

    private static func replace(_ oldURI: String, with newURI: String, in value: Any) -> Any {
        if let string = value as? String { return string == oldURI ? newURI : string }
        if let array = value as? [Any] { return array.map { replace(oldURI, with: newURI, in: $0) } }
        if let dictionary = value as? [String: Any] {
            return dictionary.mapValues { replace(oldURI, with: newURI, in: $0) }
        }
        return value
    }
}
