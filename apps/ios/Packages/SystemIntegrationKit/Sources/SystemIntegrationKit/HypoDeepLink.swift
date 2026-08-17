import Foundation

public enum HypoMeterMode: String, Codable, CaseIterable, Hashable, Sendable {
    case reflected
    case spot
    case incident
}

public enum HypoDeepLink: Hashable, Sendable {
    case log(aperture: String?, shutterSpeed: String?)
    case meter(mode: HypoMeterMode?)
    case timer(recipe: String?)
    case library
    case settings

    public var url: URL {
        var components = URLComponents()
        components.scheme = "hypo"

        switch self {
        case let .log(aperture, shutterSpeed):
            components.host = "log"
            components.queryItems = [
                aperture.map { URLQueryItem(name: "aperture", value: $0) },
                shutterSpeed.map { URLQueryItem(name: "shutter", value: $0) },
            ].compactMap { $0 }
        case let .meter(mode):
            components.host = "meter"
            if let mode {
                components.queryItems = [URLQueryItem(name: "mode", value: mode.rawValue)]
            }
        case let .timer(recipe):
            components.host = "timer"
            if let recipe {
                components.path = "/\(recipe)"
            }
        case .library:
            components.host = "library"
        case .settings:
            components.host = "settings"
        }

        guard let url = components.url else {
            preconditionFailure("Every Hypo route must produce a valid URL.")
        }
        return url
    }

    public init?(url: URL) {
        let route: String
        let routeArguments: ArraySlice<String>
        let path = url.pathComponents.filter { $0 != "/" }

        if url.scheme?.lowercased() == "hypo", let host = url.host?.lowercased() {
            route = host
            routeArguments = path[...]
        } else if url.scheme?.lowercased() == "https",
            url.host?.lowercased() == "hypo.graycard.app",
            path.count >= 2,
            path[0].lowercased() == "app"
        {
            route = path[1].lowercased()
            routeArguments = path.dropFirst(2)
        } else {
            return nil
        }

        let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let query = Dictionary(
            queryItems.map { ($0.name.lowercased(), $0.value) },
            uniquingKeysWith: { first, _ in first }
        )

        switch route {
        case "log", "logger":
            self = .log(
                aperture: query["aperture"] ?? nil,
                shutterSpeed: query["shutter"] ?? nil
            )
        case "meter":
            self = .meter(mode: (query["mode"] ?? nil).flatMap(HypoMeterMode.init(rawValue:)))
        case "timer":
            self = .timer(recipe: routeArguments.first)
        case "library":
            self = .library
        case "settings", "account":
            self = .settings
        default:
            return nil
        }
    }
}
