import Foundation
import HypoLexicon
import Observation

@MainActor
@Observable
public final class LibraryFeatureModel {
    public var category: LibraryCategory = .rolls
    public var query = ""
    public private(set) var items: [LibraryItem] = []
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?
    public private(set) var dataWarnings: [LibraryDataWarning] = []
    public var presentedFieldAction: LibraryFieldAction?
    public var rollLabel = ""
    public var selectedCameraURI: String?
    public var gearNickname = ""
    public var gearSerialNumber = ""
    public private(set) var isSavingFieldAction = false
    public private(set) var fieldErrorMessage: String?
    public private(set) var fieldSuccessMessage: String?

    private let provider: any LibraryProviding
    private let fieldWriter: any LibraryFieldSemanticWriting
    private let webBaseURL: URL

    public init(
        provider: any LibraryProviding,
        fieldWriter: any LibraryFieldSemanticWriting = UnavailableLibraryFieldWriter(),
        webBaseURL: URL = URL(string: "https://hypo.graycard.app/")!
    ) {
        self.provider = provider
        self.fieldWriter = fieldWriter
        self.webBaseURL = webBaseURL
    }

    public var filteredItems: [LibraryItem] {
        let categoryItems = items.filter { $0.category == category }
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return categoryItems }
        return categoryItems.filter {
            $0.title.localizedStandardContains(normalized)
                || ($0.subtitle?.localizedStandardContains(normalized) ?? false)
        }
    }

    public var ownedCameras: [LibraryItem] {
        items.filter {
            guard let uri = try? ATURI($0.id) else { return false }
            return uri.collection == GeneratedRecordNSID.instanceCamera
        }
        .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }

    public var categoryWebURL: URL? {
        LibraryWebTarget.library(tab: webTab(category)).url(relativeTo: webBaseURL)
    }

    public var categorySupportsFieldActions: Bool {
        category == .film || category == .cameras || category == .lenses
    }

    public func webURL(for item: LibraryItem) -> URL? {
        item.webTarget?.url(relativeTo: webBaseURL)
    }

    public func beginFieldAction(_ action: LibraryFieldAction) {
        fieldErrorMessage = nil
        fieldSuccessMessage = nil
        rollLabel = ""
        selectedCameraURI = nil
        gearNickname = ""
        gearSerialNumber = ""
        presentedFieldAction = action
    }

    public func cancelFieldAction() {
        guard !isSavingFieldAction else { return }
        presentedFieldAction = nil
        fieldErrorMessage = nil
    }

    public func savePresentedFieldAction(now: Date = Date()) async {
        guard let action = presentedFieldAction, !isSavingFieldAction else { return }
        isSavingFieldAction = true
        fieldErrorMessage = nil
        defer { isSavingFieldAction = false }

        do {
            let receipt: LibraryFieldWriteReceipt
            switch action {
            case .loadFilmRoll(let stockpile):
                let camera = try selectedCameraURI.map(ATURI.init)
                let request = FilmRollLoadRequest(
                    stockpile: stockpile,
                    camera: camera,
                    label: normalized(rollLabel),
                    loadedAt: now
                )
                try LibraryFieldRequestValidator.validate(request)
                receipt = try await fieldWriter.loadFilmRoll(request)
                fieldSuccessMessage = "Roll loaded. It is queued for sync."
            case .quickAddGear(let selection):
                let request = GearQuickAddRequest(
                    selection: selection,
                    nickname: normalized(gearNickname),
                    serialNumber: normalized(gearSerialNumber),
                    createdAt: now
                )
                try LibraryFieldRequestValidator.validate(request)
                receipt = try await fieldWriter.quickAddGear(request)
                fieldSuccessMessage = "\(selection.label) added. It is queued for sync."
            }
            _ = receipt
            presentedFieldAction = nil
            await load()
        } catch {
            fieldErrorMessage =
                (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        }
    }

    public func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            items = try await provider.items()
            dataWarnings = await provider.warnings()
            errorMessage = nil
        } catch {
            errorMessage = String(describing: error)
        }
    }

    private func normalized(_ value: String) -> String? {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private func webTab(_ category: LibraryCategory) -> String {
        switch category {
        case .rolls, .film: "film"
        case .cameras: "cameras"
        case .lenses: "lenses"
        case .chemistry, .recipes: "darkroom"
        }
    }
}
