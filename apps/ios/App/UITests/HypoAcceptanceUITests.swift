import XCTest

@MainActor
final class HypoAcceptanceUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOfflineMutationSurvivesRelaunchAndConvergesAfterReconnect() {
        let app = makeApp(fixture: "synchronization", reset: true, network: "offline")
        app.launch()

        let logTab = app.tabBars.buttons["Log"]
        XCTAssertTrue(logTab.waitForExistence(timeout: 10))
        logTab.tap()
        XCTAssertTrue(app.staticTexts["Acceptance roll"].waitForExistence(timeout: 10))
        element("logger.log-frame", in: app).tap()
        XCTAssertTrue(app.staticTexts["Frame 1 logged"].waitForExistence(timeout: 10))
        assertSyncValue("1 change waiting", in: app)

        element("sync.status", in: app).tap()
        XCTAssertTrue(app.staticTexts["New exposure"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Ready to sync"].exists)
        app.buttons["Done"].tap()

        app.terminate()
        app.launchEnvironment["HYPO_UI_TEST_RESET"] = "0"
        app.launch()
        assertSyncValue("1 change waiting", in: app)
        element("sync.status", in: app).tap()
        XCTAssertTrue(app.staticTexts["New exposure"].waitForExistence(timeout: 10))
        app.buttons["Done"].tap()

        app.terminate()
        app.launchEnvironment["HYPO_UI_TEST_NETWORK"] = "online"
        app.launch()
        assertSyncValue("No changes waiting", in: app)
        element("sync.status", in: app).tap()
        XCTAssertTrue(app.staticTexts["No changes are waiting."].waitForExistence(timeout: 10))
        app.buttons["Done"].tap()
        assertLabel(
            "Frame 1 · Kodak Tri-X 400",
            for: "acceptance.sync.remote-record",
            in: app
        )

        app.terminate()
        app.launch()
        assertSyncValue("No changes waiting", in: app)
        assertLabel(
            "Frame 1 · Kodak Tri-X 400",
            for: "acceptance.sync.remote-record",
            in: app
        )
    }

    func testColdStartCustomSchemeDeepLinkSelectsTimerRecipe() {
        let app = makeApp(fixture: "deep-link", reset: true)
        app.launchEnvironment["HYPO_UI_TEST_INITIAL_URL"] = "hypo://timer/ECN-2"
        app.launch()

        XCTAssertEqual(element("acceptance.deep-link.route", in: app).label, "Timer · ECN-2")
        XCTAssertEqual(
            element("acceptance.deep-link.detail", in: app).label,
            "Opened before the first screen appeared."
        )
    }

    func testColdStartUniversalLinkSelectsIncidentMeter() {
        let app = makeApp(fixture: "deep-link", reset: true)
        app.launchEnvironment["HYPO_UI_TEST_INITIAL_URL"] =
            "https://hypo.graycard.app/app/meter?mode=incident"
        app.launch()

        XCTAssertEqual(element("acceptance.deep-link.route", in: app).label, "Meter · Incident")
    }

    func testSharedSnapshotExposesExtensionRenderingMetadata() {
        let app = makeApp(fixture: "shared-snapshot", reset: true)
        app.launch()

        XCTAssertEqual(element("acceptance.snapshot.roll-label", in: app).label, "Roll 12")
        XCTAssertEqual(element("acceptance.snapshot.stock", in: app).label, "Tri-X 400")
        XCTAssertEqual(element("acceptance.snapshot.frames", in: app).label, "17 of 36")
        XCTAssertEqual(element("acceptance.snapshot.timer-recipe", in: app).label, "D-76 1+1")
        XCTAssertEqual(element("acceptance.snapshot.timer-stage", in: app).label, "Develop")
        XCTAssertEqual(
            element("acceptance.snapshot.reading", in: app).label,
            "EV 11, at ISO 100, f/5.6, 1/250"
        )
    }

    func testRepresentativeAccessibleFlowHasStableLabelsAndIdentifiers() {
        let app = makeApp(fixture: "accessibility", reset: true)
        app.launch()

        let heading = element("acceptance.accessibility.heading", in: app)
        XCTAssertEqual(heading.label, "Accessible logging flow")

        let action = element("acceptance.accessibility.continue", in: app)
        XCTAssertEqual(action.label, "Log frame at f/5.6 and 1/125")
        action.tap()

        XCTAssertEqual(element("acceptance.accessibility.result", in: app).label, "Frame logged")
    }

    private func makeApp(
        fixture: String,
        reset: Bool,
        network: String = "offline"
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "HYPO_UI_TESTING": "1",
            "HYPO_UI_TEST_FIXTURE": fixture,
            "HYPO_UI_TEST_NETWORK": network,
            "HYPO_UI_TEST_RESET": reset ? "1" : "0",
        ]
        return app
    }

    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        // SwiftUI can expose both a semantic wrapper and its interactive child with the same
        // identifier. Pin the query to one stable match so value predicates do not fail merely
        // because a newer simulator runtime retains both accessibility nodes.
        let element = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 10), "Missing accessibility identifier \(identifier)")
        return element
    }

    private func assertSyncValue(_ expected: String, in app: XCUIApplication) {
        let status = element("sync.status", in: app)
        let predicate = NSPredicate(format: "value == %@", expected)
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: status)
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectation], timeout: 10),
            .completed,
            "Expected sync status \(expected), found \(String(describing: status.value))."
        )
    }

    private func assertLabel(
        _ expected: String,
        for identifier: String,
        in app: XCUIApplication
    ) {
        let value = element(identifier, in: app)
        let predicate = NSPredicate(format: "label == %@", expected)
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: value)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed)
    }
}
