import DesignSystemSnapshotSupport
import Testing

@testable import DesignSystem

@Suite("Component gallery snapshots")
struct ComponentGallerySnapshotTests {
    @Test("The gallery covers every supported appearance and text-size geometry")
    func sceneMatrixIsComplete() {
        #expect(HypoComponentGalleryScene.snapshots.count == 4)
        #expect(
            Set(HypoComponentGalleryScene.snapshots.map(\.id)) == [
                "standard-standard",
                "standard-accessibility",
                "darkroom-standard",
                "darkroom-accessibility",
            ]
        )
        #expect(
            HypoComponentGalleryScene.snapshots
                .filter { $0.textSize == .accessibility }
                .allSatisfy { $0.viewport.height > 1_180 }
        )
        #expect(HypoComponentGalleryTextSize.accessibility.dynamicTypeSize == .accessibility5)
    }

    @Test("Vector references match the reviewed gallery snapshots")
    func vectorReferenceFingerprints() {
        let expected = [
            "standard-standard": "ea25f3ae5ffa44a7",
            "standard-accessibility": "c011b7a281ce5b63",
            "darkroom-standard": "24d52f46bf69b756",
            "darkroom-accessibility": "249b43924a971d36",
        ]
        let renderer = ComponentGalleryReferenceRenderer()

        for scene in HypoComponentGalleryScene.snapshots {
            #expect(renderer.fingerprint(for: scene) == expected[scene.id])
        }
    }

    @Test("Reference snapshots carry the controls and states under review")
    func vectorReferencesContainReviewTargets() {
        let renderer = ComponentGalleryReferenceRenderer()

        for scene in HypoComponentGalleryScene.snapshots {
            let snapshot = renderer.svg(for: scene)
            #expect(snapshot.contains("Save reading"))
            #expect(snapshot.contains("Meter ready"))
            #expect(snapshot.contains("Aperture"))
            #expect(snapshot.contains("Meter difference"))
            #expect(snapshot.contains("Saved locally"))
            #expect(snapshot.contains("Waiting to sync"))
            #expect(snapshot.contains("Review required"))
            #expect(!snapshot.contains("generatedAt"))
        }
    }
}
