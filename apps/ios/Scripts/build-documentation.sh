#!/usr/bin/env bash

set -euo pipefail

ios_root="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$ios_root/../.." && pwd)"
output_path="${1:-$repo_root/.derived-data/hypo-ios-docc-static}"

case "$output_path" in
    "" | / | "$repo_root" | "$ios_root" | "$repo_root/docs" | "$repo_root/docs/site")
        echo "Refusing to replace an unsafe documentation output path: $output_path" >&2
        exit 1
        ;;
esac

command -v xcrun >/dev/null 2>&1 || {
    echo "Building DocC documentation requires Xcode and xcrun." >&2
    exit 1
}

work_directory="$(mktemp -d "${TMPDIR:-/tmp}/hypo-ios-docc.XXXXXX")"
current_package_directory=""

clean_current_package() {
    if [[ -z "$current_package_directory" ]]; then
        return
    fi

    swift package --package-path "$current_package_directory" clean >/dev/null 2>&1 || true
    swift package --package-path "$current_package_directory" reset >/dev/null 2>&1 || true
    rm -rf "$current_package_directory/.build" "$current_package_directory/build"
    current_package_directory=""
}

cleanup() {
    clean_current_package
    rm -rf "$work_directory"
}

trap cleanup EXIT

export CLANG_MODULE_CACHE_PATH="$work_directory/clang-module-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$work_directory/swift-module-cache"

packages=(
    "ATProtoClient|$ios_root/Packages/ATProtoClient"
    "CatalogKit|$ios_root/Packages/CatalogKit"
    "DesignSystem|$ios_root/Packages/DesignSystem"
    "DiagnosticsKit|$ios_root/Packages/DiagnosticsKit"
    "HypoLexicon|$ios_root/Packages/HypoLexicon"
    "MeterEngine|$ios_root/Packages/MeterEngine"
    "PanprotoKit|$ios_root/Packages/PanprotoKit"
    "PersistenceKit|$ios_root/Packages/PersistenceKit"
    "PhotometryKit|$ios_root/Packages/PhotometryKit"
    "SyncKit|$ios_root/Packages/SyncKit"
    "SystemIntegrationKit|$ios_root/Packages/SystemIntegrationKit"
    "TimerEngine|$ios_root/Packages/TimerEngine"
    "LibraryFeature|$ios_root/Packages/Features/LibraryFeature"
    "LoggerFeature|$ios_root/Packages/Features/LoggerFeature"
    "MeterFeature|$ios_root/Packages/Features/MeterFeature"
    "SettingsFeature|$ios_root/Packages/Features/SettingsFeature"
    "SyncStatusFeature|$ios_root/Packages/Features/SyncStatusFeature"
    "TimerFeature|$ios_root/Packages/Features/TimerFeature"
)

archives=()
for package_specification in "${packages[@]}"; do
    module="${package_specification%%|*}"
    package_directory="${package_specification#*|}"
    current_package_directory="$package_directory"
    catalog="$package_directory/Sources/$module/$module.docc"
    symbol_output="$package_directory/.build/hypo-docc-symbols/$module"
    module_symbols="$work_directory/module-symbols/$module"
    archive="$work_directory/archives/$module.doccarchive"

    if [[ ! -f "$catalog/$module.md" ]]; then
        echo "Missing $module documentation catalog at $catalog" >&2
        exit 1
    fi

    echo "Extracting $module symbols"
    mkdir -p "$symbol_output" "$module_symbols" "$(dirname "$archive")"
    swift build \
        --disable-sandbox \
        --package-path "$package_directory" \
        --target "$module" \
        -Xswiftc -emit-symbol-graph \
        -Xswiftc -emit-symbol-graph-dir \
        -Xswiftc "$symbol_output"

    symbol_graph="$symbol_output/$module.symbols.json"
    if [[ ! -f "$symbol_graph" ]]; then
        echo "Swift did not emit the expected symbol graph: $symbol_graph" >&2
        exit 1
    fi
    cp "$symbol_graph" "$module_symbols/"

    echo "Compiling $module documentation"
    xcrun docc convert "$catalog" \
        --additional-symbol-graph-dir "$module_symbols" \
        --output-path "$archive" \
        --fallback-display-name "$module" \
        --fallback-bundle-identifier "app.graycard.hypo.documentation.$module" \
        --fallback-bundle-version 1 \
        --checkout-path "$repo_root" \
        --source-service github \
        --source-service-base-url "https://github.com/gray-card/hypo/blob/main" \
        --no-transform-for-static-hosting \
        --disable-parameters-and-returns-validation \
        --warnings-as-errors
    archives+=("$archive")
    clean_current_package
done

combined_archive="$work_directory/Hypo-iOS.doccarchive"
xcrun docc merge "${archives[@]}" \
    --output-path "$combined_archive" \
    --synthesized-landing-page-name "Hypo for iOS" \
    --synthesized-landing-page-kind "Package" \
    --synthesized-landing-page-topics-style detailedGrid

rm -rf "$output_path"
mkdir -p "$(dirname "$output_path")"
xcrun docc process-archive transform-for-static-hosting "$combined_archive" \
    --output-path "$output_path" \
    --hosting-base-path docs/ios-api

test -f "$output_path/index.html"
test -d "$output_path/data/documentation"
echo "Built combined Hypo iOS documentation at $output_path"
