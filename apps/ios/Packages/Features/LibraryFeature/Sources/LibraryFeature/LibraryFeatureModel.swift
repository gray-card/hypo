import DesignSystem
import Foundation
import HypoLexicon
import Observation
import SyncKit

@MainActor
@Observable
public final class LibraryFeatureModel {
    public var category: LibraryCategory = .rolls
    public var query = ""
    public private(set) var items: [LibraryItem] = []
    public private(set) var isLoading = false
    public private(set) var errorPresentation: HypoErrorPresentation?
    public var errorMessage: String? { errorPresentation?.message }
    public private(set) var dataWarnings: [LibraryDataWarning] = []
    public var presentedFieldAction: LibraryFieldAction?
    public var rollLabel = ""
    public var selectedCameraURI: String?
    public var gearNickname = ""
    public var gearSerialNumber = ""
    public private(set) var isSavingFieldAction = false
    public private(set) var fieldErrorPresentation: HypoErrorPresentation?
    public var fieldErrorMessage: String? { fieldErrorPresentation?.message }
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
        filteredItems(for: category)
    }

    public func filteredItems(for category: LibraryCategory) -> [LibraryItem] {
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
        categoryWebURL(for: category)
    }

    public func categoryWebURL(for category: LibraryCategory) -> URL? {
        LibraryWebTarget.library(tab: webTab(category)).url(relativeTo: webBaseURL)
    }

    public var categorySupportsFieldActions: Bool {
        category == .film || category == .cameras || category == .lenses
    }

    public func webURL(for item: LibraryItem) -> URL? {
        item.webTarget?.url(relativeTo: webBaseURL)
    }

    public func beginFieldAction(_ action: LibraryFieldAction) {
        fieldErrorPresentation = nil
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
        fieldErrorPresentation = nil
    }

    public func savePresentedFieldAction(now: Date = Date()) async {
        guard let action = presentedFieldAction, !isSavingFieldAction else { return }
        isSavingFieldAction = true
        fieldErrorPresentation = nil
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
            fieldErrorPresentation = fieldPresentation(for: error)
            HypoErrorReporter.record(error, presentation: fieldErrorPresentation!)
        }
    }

    public func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            items = try await provider.items()
            dataWarnings = await provider.warnings()
            errorPresentation = nil
        } catch {
            errorPresentation = HypoErrorPresenter.presentation(for: .libraryUnavailable)
            HypoErrorReporter.record(error, presentation: errorPresentation!)
        }
    }

    public func dismissLoadError() {
        errorPresentation = nil
    }

    public func dismissFieldError() {
        fieldErrorPresentation = nil
    }

    private func fieldPresentation(for error: any Error) -> HypoErrorPresentation {
        if let syncError = error as? ATProtoSyncAdapterError,
            case .missingSession = syncError
        {
            return HypoErrorPresenter.presentation(for: .librarySaveRequiresSignIn)
        }
        guard let fieldError = error as? LibraryFieldError else {
            return HypoErrorPresenter.presentation(for: .librarySaveUnavailable)
        }
        switch fieldError {
        case .writerUnavailable:
            return HypoErrorPresenter.presentation(for: .librarySaveRequiresSignIn)
        case .malformedCatalogItem, .invalidRecord:
            return HypoErrorPresenter.presentation(for: .librarySaveUnavailable)
        default:
            return HypoErrorPresenter.presentation(
                for: .validation(message: fieldError.errorDescription ?? "Check this entry.")
            )
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
        case .chemistry: "chemistry"
        case .recipes: "workflows"
        }
    }
}
