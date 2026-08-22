import Foundation
import Testing

@testable import SystemIntegrationKit

@Test func canonicalRoutesRoundTrip() throws {
    let routes: [HypoDeepLink] = [
        .log(aperture: "5.6", shutterSpeed: "1/125"),
        .meter(mode: .spot),
        .timer(recipe: "C-41 38 °C"),
        .library,
        .settings,
    ]

    for route in routes {
        #expect(HypoDeepLink(url: route.url) == route)
    }
}

@Test func universalLinksMapToTheSameRoutes() throws {
    #expect(
        HypoDeepLink(url: try #require(URL(string: "https://hypo.graycard.app/app/meter?mode=incident")))
            == .meter(mode: .incident)
    )
    #expect(
        HypoDeepLink(url: try #require(URL(string: "https://hypo.graycard.app/app/timer/ECN-2")))
            == .timer(recipe: "ECN-2")
    )
}

@Test func unsupportedAndMalformedRoutesAreRejected() throws {
    #expect(HypoDeepLink(url: try #require(URL(string: "other://meter"))) == nil)
    #expect(HypoDeepLink(url: try #require(URL(string: "hypo://unknown"))) == nil)
    #expect(HypoDeepLink(url: try #require(URL(string: "https://example.com/app/meter"))) == nil)
}
