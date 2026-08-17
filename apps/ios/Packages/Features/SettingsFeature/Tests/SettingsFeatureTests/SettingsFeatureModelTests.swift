import ATProtoClient
import Foundation
import XCTest

@testable import SettingsFeature

private enum SettingsClientTestError: Error {
    case failed
}

private actor SettingsAuthenticationClientFake: SettingsAuthenticationClient {
    var restored: OAuthSession?
    var signedIn: OAuthSession
    var refreshed: OAuthSession
    var delay: Duration?
    var signInError: Error?
    private(set) var identifiers: [String] = []
    private(set) var signOutCount = 0

    init(session: OAuthSession) {
        signedIn = session
        refreshed = session
    }

    func signIn(identifier: String, sessionID: OAuthSessionID) async throws -> OAuthSession {
        identifiers.append(identifier)
        if let delay { try await Task.sleep(for: delay) }
        if let signInError { throw signInError }
        return signedIn
    }

    func restore(sessionID: OAuthSessionID) -> OAuthSession? { restored }
    func refresh(sessionID: OAuthSessionID) -> OAuthSession { refreshed }
    func signOut(sessionID: OAuthSessionID) { signOutCount += 1 }

    func setRestored(_ session: OAuthSession?) { restored = session }
    func setRefreshed(_ session: OAuthSession) { refreshed = session }
    func setDelay(_ delay: Duration?) { self.delay = delay }
    func setSignInError(_ error: Error?) { signInError = error }
    func receivedIdentifiers() -> [String] { identifiers }
    func receivedSignOutCount() -> Int { signOutCount }
}

@MainActor
final class SettingsFeatureModelTests: XCTestCase, @unchecked Sendable {
    private let sessionID = OAuthSessionID(rawValue: "primary")

    private func session(token: String = "access-1") -> OAuthSession {
        OAuthSession(
            id: sessionID,
            issuer: URL(string: "https://auth.example")!,
            subject: "did:plc:alice",
            pdsURL: URL(string: "https://pds.example")!,
            accessToken: token,
            refreshToken: "refresh-1",
            scope: "atproto repo:app.graycard.instance.exposure"
        )
    }

    func testSignInTrimsIdentifierAndPublishesSession() async {
        let client = SettingsAuthenticationClientFake(session: session())
        var published: OAuthSession?
        let model = SettingsFeatureModel(client: client, sessionID: sessionID) {
            published = $0
        }
        model.identifier = "  @alice.example  "

        model.signIn()
        await model.waitForCurrentOperation()

        let identifiers = await client.receivedIdentifiers()
        XCTAssertEqual(identifiers, ["@alice.example"])
        XCTAssertEqual(model.session, session())
        XCTAssertEqual(published, session())
        XCTAssertNil(model.operation)
        XCTAssertNil(model.authenticationError)
    }

    func testRestoreRefreshAndSignOutReplacePublishedSession() async {
        let client = SettingsAuthenticationClientFake(session: session())
        await client.setRestored(session())
        let refreshed = session(token: "access-2")
        await client.setRefreshed(refreshed)
        var published: [OAuthSession?] = []
        let model = SettingsFeatureModel(client: client, sessionID: sessionID) {
            published.append($0)
        }

        model.restore()
        await model.waitForCurrentOperation()
        model.refresh()
        await model.waitForCurrentOperation()
        model.signOut()
        await model.waitForCurrentOperation()

        XCTAssertEqual(published, [session(), refreshed, nil])
        XCTAssertNil(model.session)
        let signOutCount = await client.receivedSignOutCount()
        XCTAssertEqual(signOutCount, 1)
    }

    func testCancellationReturnsToSignedOutWithoutAnError() async {
        let client = SettingsAuthenticationClientFake(session: session())
        await client.setDelay(.seconds(10))
        let model = SettingsFeatureModel(client: client, sessionID: sessionID)
        model.identifier = "alice.example"

        model.signIn()
        XCTAssertEqual(model.operation, .signingIn)
        model.cancelCurrentOperation()
        await model.waitForCurrentOperation()

        XCTAssertNil(model.operation)
        XCTAssertNil(model.session)
        XCTAssertNil(model.authenticationError)
    }

    func testIdentityErrorHasApproachableRecoveryCopy() async {
        let client = SettingsAuthenticationClientFake(session: session())
        await client.setSignInError(
            ATProtoIdentityResolutionError.invalidIdentifier("not a handle")
        )
        let model = SettingsFeatureModel(client: client, sessionID: sessionID)
        model.identifier = "not a handle"

        model.signIn()
        await model.waitForCurrentOperation()

        XCTAssertEqual(model.authenticationError?.title, "Account not found")
        XCTAssertEqual(
            model.authenticationError?.message,
            "Enter a full handle such as alice.example, or an account DID."
        )
    }

    func testExpiredExternalCallbackIsIgnoredDuringActiveSignIn() async {
        let client = SettingsAuthenticationClientFake(session: session())
        await client.setDelay(.seconds(10))
        let model = SettingsFeatureModel(client: client, sessionID: sessionID)
        model.identifier = "alice.example"

        model.signIn()
        model.receiveExpiredCallback()
        XCTAssertNil(model.authenticationError)

        model.cancelCurrentOperation()
        model.receiveExpiredCallback()
        XCTAssertEqual(model.authenticationError?.title, "Sign-in link expired")
    }
}
