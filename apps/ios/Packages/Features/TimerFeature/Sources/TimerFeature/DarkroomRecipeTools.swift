import DesignSystem
import Foundation
import SwiftUI

struct DevelopmentRecipeBrowser: View {
    let recipes: [DevelopmentRecipeSelection]
    let isLoading: Bool
    let selectedID: String
    let onSelect: (DevelopmentRecipeSelection) -> Void
    let onSave: (DevelopmentRecipeSelection) -> Void
    let onDelete: (DevelopmentRecipeSelection) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.hypoAppearance) private var appearance
    @AppStorage("hypo.darkroom.favoriteRecipeIDs") private var favoriteData = Data()
    @State private var query = ""
    @State private var showsFavorites = false
    @State private var recipeDraft: CustomDevelopmentRecipeDraft?
    @State private var pendingDeletion: DevelopmentRecipeSelection?

    var body: some View {
        let favorites = favoriteIDs
        let filteredRecipes = filteredRecipes(favorites: favorites)
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: HypoTheme.Space.two) {
                    Image(systemName: "magnifyingglass").accessibilityHidden(true)
                    TextField("Film, developer, dilution, or EI", text: $query)
                        .accessibilityIdentifier("timer.recipe-search")
                        .autocorrectionDisabled()
                    if !query.isEmpty {
                        Button("Clear search", systemImage: "xmark.circle.fill") { query = "" }
                            .labelStyle(.iconOnly)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                }
                .padding(.horizontal, HypoTheme.Space.three)
                .frame(minHeight: 44)
                .background(appearance.surface, in: RoundedRectangle(cornerRadius: HypoTheme.Space.two))
                .padding(.horizontal)
                .padding(.bottom, HypoTheme.Space.two)

                Picker("Recipe collection", selection: $showsFavorites) {
                    Text("All recipes").tag(false)
                    Text("Favorites").tag(true)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)

                List(filteredRecipes) { recipe in
                    recipeRow(recipe, isFavorite: favorites.contains(recipe.id))
                        .listRowBackground(appearance.surface)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .scrollDismissesKeyboard(.interactively)
                .overlay {
                    if filteredRecipes.isEmpty {
                        if isLoading {
                            ProgressView("Loading recipes…")
                        } else {
                            ContentUnavailableView(
                                showsFavorites && query.isEmpty
                                    ? "No favorite recipes" : "No matching recipes",
                                systemImage: showsFavorites ? "star" : "magnifyingglass"
                            )
                        }
                    }
                }
            }
            .background(appearance.background)
            .navigationTitle("Development recipes")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button("Add recipe", systemImage: "plus") { recipeDraft = CustomDevelopmentRecipeDraft() }
                        .accessibilityIdentifier("timer.add-recipe")
                }
            }
        }
        .sheet(item: $recipeDraft) { draft in
            CustomDevelopmentRecipeEditor(draft: draft, onSave: onSave)
                .darkroomTreatment()
        }
        .confirmationDialog(
            "Delete this device recipe?",
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if !$0 { pendingDeletion = nil } }
            ),
            presenting: pendingDeletion
        ) { recipe in
            Button("Delete recipe", role: .destructive) { onDelete(recipe) }
        }
    }

    private var favoriteIDs: Set<String> {
        Set((try? JSONDecoder().decode([String].self, from: favoriteData)) ?? [])
    }

    private func filteredRecipes(favorites: Set<String>) -> [DevelopmentRecipeSelection] {
        let words = query.split(whereSeparator: \.isWhitespace)
        return recipes.filter { recipe in
            (!showsFavorites || favorites.contains(recipe.id))
                && words.allSatisfy { word in
                    recipe.plan.name.localizedStandardContains(String(word))
                        || recipe.provenance.sourceLabel.localizedStandardContains(String(word))
                }
        }
    }

    private func recipeRow(_ recipe: DevelopmentRecipeSelection, isFavorite: Bool) -> some View {
        HStack(spacing: HypoTheme.Space.three) {
            Button {
                onSelect(recipe)
                dismiss()
            } label: {
                VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                    Text(recipe.plan.name).font(.headline)
                    Text(recipe.provenance.sourceLabel)
                        .font(.caption)
                        .foregroundStyle(appearance.muted)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(recipe.id == selectedID ? .isSelected : [])

            Button {
                var favorites = favoriteIDs
                if isFavorite { favorites.remove(recipe.id) } else { favorites.insert(recipe.id) }
                if let data = try? JSONEncoder().encode(favorites.sorted()) { favoriteData = data }
            } label: {
                Image(systemName: isFavorite ? "star.fill" : "star")
                    .foregroundStyle(appearance.accent)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isFavorite ? "Remove from favorites" : "Add to favorites")
            .accessibilityHint(recipe.plan.name)
        }
        .contextMenu {
            if recipe.provenance.origin == .local {
                Button("Edit recipe", systemImage: "square.and.pencil") {
                    recipeDraft = CustomDevelopmentRecipeDraft(recipe: recipe)
                }
                Button("Delete recipe", systemImage: "trash", role: .destructive) {
                    pendingDeletion = recipe
                }
            }
        }
    }
}

struct DilutionCalculator: View {
    let recipeDilution: String?

    @State private var volume = 500.0
    @State private var concentrateParts = 1.0
    @State private var waterParts = 0.0
    @State private var usesFluidOunces = false

    var body: some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
            if let recipeDilution { Text("Recipe dilution \(recipeDilution)").font(.subheadline) }
            Picker("Volume unit", selection: $usesFluidOunces) {
                Text("mL").tag(false)
                Text("US fl oz").tag(true)
            }
            .pickerStyle(.segmented)

            numberField("Working volume (\(unit))", value: $volume)
            numberField("Concentrate parts", value: $concentrateParts)
            numberField("Water parts", value: $waterParts)

            if let mix {
                LabeledContent("Concentrate", value: measurement(mix.concentrate))
                LabeledContent("Water", value: measurement(mix.water))
            } else {
                Text("Enter a positive working volume and concentrate ratio.").font(.caption)
            }
        }
        .onChange(of: usesFluidOunces) { _, usesFluidOunces in
            volume = usesFluidOunces ? volume / 29.5735295625 : volume * 29.5735295625
        }
        .task {
            guard let recipeDilution else { return }
            let parts = recipeDilution.split(separator: "+", omittingEmptySubsequences: false)
            guard parts.count == 2,
                let concentrate = Double(parts[0].trimmingCharacters(in: .whitespaces)),
                let water = Double(parts[1].trimmingCharacters(in: .whitespaces)),
                concentrate.isFinite, water.isFinite, concentrate > 0, water >= 0
            else { return }
            concentrateParts = concentrate
            waterParts = water
        }
    }

    private var unit: String { usesFluidOunces ? "US fl oz" : "mL" }

    private var mix: (concentrate: Double, water: Double)? {
        let total = concentrateParts + waterParts
        guard volume.isFinite, volume > 0, total.isFinite, concentrateParts > 0, waterParts >= 0 else {
            return nil
        }
        let concentrate = volume * (concentrateParts / total)
        return (concentrate, volume - concentrate)
    }

    private func numberField(_ title: String, value: Binding<Double>) -> some View {
        LabeledContent(title) {
            TextField(title, value: value, format: .number.precision(.fractionLength(0...2)))
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .textFieldStyle(.roundedBorder)
                #if os(iOS)
                    .keyboardType(.decimalPad)
                #endif
        }
    }

    private func measurement(_ value: Double) -> String {
        "\(value.formatted(.number.precision(.fractionLength(0...2)))) \(unit)"
    }
}
