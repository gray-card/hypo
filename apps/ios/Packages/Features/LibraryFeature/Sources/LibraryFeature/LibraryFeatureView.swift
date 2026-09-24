import DesignSystem
import SwiftUI

public struct LibraryFeatureView: View {
    @Bindable private var model: LibraryFeatureModel
    private let onOpenAccountSettings: () -> Void

    public init(
        model: LibraryFeatureModel,
        onOpenAccountSettings: @escaping () -> Void = {}
    ) {
        self.model = model
        self.onOpenAccountSettings = onOpenAccountSettings
    }

    public var body: some View {
        ZStack {
            HypoTheme.ColorToken.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: HypoTheme.Space.four) {
                    Text("Film, equipment, chemistry, and reusable recipes.")
                        .font(.callout)
                        .foregroundStyle(HypoTheme.ColorToken.muted)
                    categoryGroup("Materials", categories: [.rolls, .film, .chemistry])
                    categoryGroup("Equipment", categories: [.cameras, .lenses])
                    categoryGroup("Presets", categories: [.recipes])
                    loadFeedback
                }
                .padding(HypoTheme.Space.four)
            }
        }
        .foregroundStyle(HypoTheme.ColorToken.text)
        .navigationTitle("Library")
        .toolbar {
            ToolbarItem(placement: .automatic) { HypoToolbarWordmark() }
        }
        .navigationDestination(for: LibraryCategory.self) { category in
            categoryDetail(category)
        }
        .task { await model.load() }
        .sheet(
            isPresented: Binding(
                get: { model.presentedFieldAction != nil },
                set: { if !$0 { model.cancelFieldAction() } }
            )
        ) {
            fieldActionSheet
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private func categoryGroup(
        _ title: String,
        categories: [LibraryCategory]
    ) -> some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
            Text(title)
                .font(.caption.weight(.semibold))
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(HypoTheme.ColorToken.muted)
            InstrumentPanel {
                VStack(spacing: 0) {
                    ForEach(Array(categories.enumerated()), id: \.element) { index, category in
                        NavigationLink(value: category) {
                            HStack(spacing: HypoTheme.Space.three) {
                                Image(systemName: category.systemImage)
                                    .foregroundStyle(HypoTheme.ColorToken.accent)
                                    .frame(width: 30)
                                VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                                    Text(category.displayName)
                                        .font(.headline)
                                        .foregroundStyle(HypoTheme.ColorToken.text)
                                    Text(category.summary)
                                        .font(.caption)
                                        .foregroundStyle(HypoTheme.ColorToken.muted)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: HypoTheme.Space.two)
                                Text("\(itemCount(for: category))")
                                    .font(.callout.monospacedDigit())
                                    .foregroundStyle(HypoTheme.ColorToken.muted)
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(HypoTheme.ColorToken.muted)
                            }
                            .frame(minHeight: 56)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(category.summary)
                        if index < categories.count - 1 {
                            Divider().padding(.leading, 42)
                        }
                    }
                }
            }
        }
    }

    private func categoryDetail(_ category: LibraryCategory) -> some View {
        ZStack {
            HypoTheme.ColorToken.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: HypoTheme.Space.four) {
                    webLibraryLink(category)
                    warningNotice
                    if model.isLoading {
                        ProgressView("Loading library")
                    } else if model.filteredItems(for: category).isEmpty {
                        ContentUnavailableView.search(text: model.query)
                    } else {
                        LazyVStack(spacing: HypoTheme.Space.three) {
                            ForEach(model.filteredItems(for: category)) { item in
                                itemView(item)
                            }
                        }
                    }
                    loadFeedback
                }
                .padding(HypoTheme.Space.four)
            }
        }
        .foregroundStyle(HypoTheme.ColorToken.text)
        .navigationTitle(category.displayName)
        .searchable(text: $model.query, prompt: "Search \(category.displayName.lowercased())")
        .onAppear {
            model.category = category
            model.query = ""
        }
    }

    @ViewBuilder
    private var warningNotice: some View {
        if !model.dataWarnings.isEmpty {
            Label(
                "Some records could not be refreshed. Showing the last saved data.",
                systemImage: "arrow.triangle.2.circlepath"
            )
            .font(.footnote)
            .foregroundStyle(HypoTheme.ColorToken.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var loadFeedback: some View {
        if let presentation = model.errorPresentation {
            HypoErrorNotice(
                presentation,
                onRecovery: { Task { await model.load() } },
                onDismiss: model.dismissLoadError
            )
        }
        if let successMessage = model.fieldSuccessMessage {
            Label(successMessage, systemImage: "checkmark.circle.fill")
                .font(.footnote)
                .foregroundStyle(HypoTheme.ColorToken.success)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isStaticText)
        }
    }

    private func itemCount(for category: LibraryCategory) -> Int {
        model.items.lazy.filter { $0.category == category }.count
    }

    @ViewBuilder
    private func webLibraryLink(_ category: LibraryCategory) -> some View {
        Group {
            if let url = model.categoryWebURL(for: category) {
                HStack {
                    Text(
                        [.film, .cameras, .lenses].contains(category)
                            ? "Use quick actions here. Open web Hypo for full editing."
                            : "Open web Hypo to edit these records."
                    )
                    .font(.caption)
                    .foregroundStyle(HypoTheme.ColorToken.muted)
                    Spacer(minLength: HypoTheme.Space.two)
                    Link(destination: url) {
                        Label("Full editor", systemImage: "arrow.up.right.square")
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: 44)
                    }
                    .accessibilityHint("Opens the current library section in web Hypo")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func itemView(_ item: LibraryItem) -> some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                HStack(spacing: HypoTheme.Space.three) {
                    AsyncImage(url: item.imageURL) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Image(systemName: icon(item.category))
                            .font(.title2)
                            .foregroundStyle(HypoTheme.ColorToken.muted)
                    }
                    .frame(width: 52, height: 52)
                    .background(HypoTheme.ColorToken.elevated)
                    .clipShape(RoundedRectangle(cornerRadius: HypoTheme.Radius.regular))
                    .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                        Text(item.title).font(.headline)
                        if let subtitle = item.subtitle {
                            Text(subtitle).foregroundStyle(HypoTheme.ColorToken.muted)
                        }
                        if let detail = item.detail {
                            Text(detail).font(.caption).foregroundStyle(HypoTheme.ColorToken.muted)
                        }
                        if let provenance = item.provenance {
                            Label(provenance, systemImage: "doc.text.magnifyingglass")
                                .font(.caption2.monospaced())
                                .foregroundStyle(HypoTheme.ColorToken.accent)
                        }
                    }
                    Spacer()
                }
                .accessibilityElement(children: .combine)

                if item.fieldAction != nil || model.webURL(for: item) != nil {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: HypoTheme.Space.two) { itemActions(item) }
                        VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
                            itemActions(item)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func itemActions(_ item: LibraryItem) -> some View {
        if let action = item.fieldAction {
            Button {
                model.beginFieldAction(action)
            } label: {
                Label(localActionLabel(action), systemImage: localActionIcon(action))
                    .frame(minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(HypoTheme.ColorToken.accent)
            .foregroundStyle(HypoTheme.ColorToken.background)
            .disabled(isUnavailable(action))
            .accessibilityHint(localActionHint(action))
        }
        if let url = model.webURL(for: item) {
            Link(destination: url) {
                Label("Open in web Hypo", systemImage: "arrow.up.right.square")
                    .frame(minHeight: 44)
            }
            .buttonStyle(.bordered)
            .tint(HypoTheme.ColorToken.muted)
        }
    }

    private var fieldActionSheet: some View {
        NavigationStack {
            ZStack {
                HypoTheme.ColorToken.background.ignoresSafeArea()
                Form {
                    if let action = model.presentedFieldAction {
                        switch action {
                        case .loadFilmRoll(let stockpile):
                            Section("Film") {
                                LabeledContent("Reserve", value: stockpile.label)
                                LabeledContent("Remaining", value: "\(stockpile.quantity)")
                            }
                            Section("Load") {
                                TextField("Roll label (optional)", text: $model.rollLabel)
                                Picker("Camera (optional)", selection: $model.selectedCameraURI) {
                                    Text("Not recorded").tag(String?.none)
                                    ForEach(model.ownedCameras) { camera in
                                        Text(camera.title).tag(Optional(camera.id))
                                    }
                                }
                            }
                        case .quickAddGear(let selection):
                            Section(selection.kind == .camera ? "Camera" : "Lens") {
                                LabeledContent("Model", value: selection.label)
                                TextField("Nickname (optional)", text: $model.gearNickname)
                                TextField("Serial number (optional)", text: $model.gearSerialNumber)
                            }
                            Section {
                                Text(
                                    "Hypo adds the catalog model and your physical copy as separate linked records."
                                )
                                .font(.footnote)
                                .foregroundStyle(HypoTheme.ColorToken.muted)
                            }
                        }
                    }
                    if let presentation = model.fieldErrorPresentation {
                        Section {
                            HypoErrorNotice(
                                presentation,
                                onRecovery: {
                                    if presentation.recoveryAction == .signIn {
                                        model.cancelFieldAction()
                                        onOpenAccountSettings()
                                    } else {
                                        Task { await model.savePresentedFieldAction() }
                                    }
                                },
                                onDismiss: model.dismissFieldError
                            )
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .foregroundStyle(HypoTheme.ColorToken.text)
            .tint(HypoTheme.ColorToken.accent)
            .navigationTitle(fieldActionTitle)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.cancelFieldAction() }
                        .disabled(model.isSavingFieldAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await model.savePresentedFieldAction() }
                    }
                    .fontWeight(.semibold)
                    .disabled(model.isSavingFieldAction || fieldActionUnavailable)
                }
            }
            .overlay {
                if model.isSavingFieldAction {
                    ProgressView("Saving")
                        .padding(HypoTheme.Space.four)
                        .background(
                            HypoTheme.ColorToken.elevated,
                            in: RoundedRectangle(cornerRadius: HypoTheme.Radius.regular)
                        )
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var fieldActionTitle: String {
        switch model.presentedFieldAction {
        case .loadFilmRoll: "Load a roll"
        case .quickAddGear(let selection):
            selection.kind == .camera ? "Add camera" : "Add lens"
        case nil: "Library action"
        }
    }

    private var fieldActionUnavailable: Bool {
        guard let action = model.presentedFieldAction else { return true }
        return isUnavailable(action)
    }

    private func localActionLabel(_ action: LibraryFieldAction) -> String {
        switch action {
        case .loadFilmRoll(let stockpile): stockpile.quantity > 0 ? "Load a roll" : "Reserve empty"
        case .quickAddGear(let selection): selection.kind == .camera ? "Add camera" : "Add lens"
        }
    }

    private func localActionIcon(_ action: LibraryFieldAction) -> String {
        switch action {
        case .loadFilmRoll: "camera.roll"
        case .quickAddGear(let selection): selection.kind == .camera ? "camera.badge.ellipsis" : "plus"
        }
    }

    private func localActionHint(_ action: LibraryFieldAction) -> String {
        switch action {
        case .loadFilmRoll: "Creates a loaded roll and decrements this reserve"
        case .quickAddGear: "Adds this catalog model and your copy to the signed-in account"
        }
    }

    private func isUnavailable(_ action: LibraryFieldAction) -> Bool {
        if case .loadFilmRoll(let stockpile) = action { return stockpile.quantity <= 0 }
        return false
    }

    private func icon(_ category: LibraryCategory) -> String {
        category.systemImage
    }
}
