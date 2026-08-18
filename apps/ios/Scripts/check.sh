#!/usr/bin/env bash

set -euo pipefail

ios_root="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$ios_root/../.." && pwd)"
module_cache="${TMPDIR:-/tmp}/hypo-ios-swift-module-cache"
clang_cache="${TMPDIR:-/tmp}/hypo-ios-clang-module-cache"
workspace="$ios_root/Hypo.xcworkspace"

export CLANG_MODULE_CACHE_PATH="$clang_cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$module_cache"

cleanup_build_artifacts() {
    rm -rf \
        "$repo_root/public/catalog" \
        "$module_cache" \
        "$clang_cache"
    if [[ "${CI:-}" != "true" ]]; then
        rm -rf \
            "$repo_root/.derived-data/hypo-ios" \
            "$repo_root/.derived-data/hypo-ios-device"
    fi
}
trap cleanup_build_artifacts EXIT

echo "Checking generated HypoLexicon artifacts"
node "$ios_root/Scripts/generate-hypo-lexicon-swift.mjs" --check

echo "Checking generated OAuth client artifacts"
node "$repo_root/scripts/gen-client-metadata.mjs" --check

echo "Checking bundled catalog snapshot"
node "$repo_root/scripts/build-catalog-shards.mjs"
node "$ios_root/Scripts/stage-catalog-snapshot.mjs" --check

echo "Checking the shared Panproto TypeScript/Swift corpus"
node "$repo_root/scripts/check-panproto-conformance.mjs"

echo "Checking release source metadata and dependency pins"
"$ios_root/Scripts/release-preflight.sh"

echo "Checking shell scripts"
while IFS= read -r -d '' script; do
    bash -n "$script"
done < <(find "$ios_root/Scripts" -name '*.sh' -print0)

swift_files=()
while IFS= read -r -d '' file; do
    swift_files+=("$file")
done < <(
    find "$ios_root/App" "$ios_root/Extensions" "$ios_root/Packages" \
        -name '*.swift' -not -path '*/.build/*' -print0
)

echo "Checking swift-format"
swift format lint \
    --configuration "$ios_root/.swift-format" \
    --strict \
    --parallel \
    "${swift_files[@]}"

if command -v swiftlint >/dev/null 2>&1; then
    echo "Checking SwiftLint"
    (cd "$ios_root" && swiftlint lint --strict --no-cache --config .swiftlint.yml)
elif [[ "${CI:-}" == "true" ]]; then
    echo "SwiftLint is required in CI." >&2
    exit 1
else
    echo "SwiftLint is not installed; skipping its local check." >&2
fi

clean_package_build() {
    local package_directory="$1"
    case "$package_directory" in
        "$ios_root"/Packages/*) ;;
        *)
            echo "Refusing to clean unexpected package path: $package_directory" >&2
            return 1
            ;;
    esac
    echo "Cleaning $(basename "$package_directory") after tests"
    swift package --package-path "$package_directory" clean
    swift package --package-path "$package_directory" reset
    rm -rf "$package_directory/.build" "$package_directory/build"
}

while IFS= read -r manifest; do
    package_directory="$(dirname "$manifest")"
    echo "Testing $(basename "$package_directory")"
    if swift test \
        --disable-sandbox \
        --package-path "$package_directory" \
        -Xswiftc -warnings-as-errors
    then
        clean_package_build "$package_directory"
    else
        test_status=$?
        clean_package_build "$package_directory"
        exit "$test_status"
    fi
done < <(find "$ios_root/Packages" -name .build -prune -o -name Package.swift -print | sort)

echo "Building the iOS application"
xcodebuild \
    -workspace "$workspace" \
    -scheme Hypo \
    -configuration Debug \
    -sdk iphonesimulator \
    -arch arm64 \
    -disableAutomaticPackageResolution \
    -onlyUsePackageVersionsFromResolvedFile \
    SYMROOT="$repo_root/.derived-data/hypo-ios/sym" \
    OBJROOT="$repo_root/.derived-data/hypo-ios/obj" \
    CODE_SIGNING_ALLOWED=NO \
    GCC_TREAT_WARNINGS_AS_ERRORS=YES \
    LD_WARNINGS_AS_ERRORS=YES \
    SWIFT_SUPPRESS_WARNINGS=NO \
    SWIFT_TREAT_WARNINGS_AS_ERRORS=YES \
    build

echo "Compiling the iOS application for a physical-device SDK"
xcodebuild \
    -workspace "$workspace" \
    -scheme Hypo \
    -configuration Release \
    -sdk iphoneos \
    -arch arm64 \
    -disableAutomaticPackageResolution \
    -onlyUsePackageVersionsFromResolvedFile \
    SYMROOT="$repo_root/.derived-data/hypo-ios-device/sym" \
    OBJROOT="$repo_root/.derived-data/hypo-ios-device/obj" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    GCC_TREAT_WARNINGS_AS_ERRORS=YES \
    LD_WARNINGS_AS_ERRORS=YES \
    SWIFT_SUPPRESS_WARNINGS=NO \
    SWIFT_TREAT_WARNINGS_AS_ERRORS=YES \
    VALIDATE_PRODUCT=YES \
    build

echo "Checking the compiled simulator application"
"$ios_root/Scripts/release-preflight.sh" \
    --app "$repo_root/.derived-data/hypo-ios/sym/Debug-iphonesimulator/Hypo.app"

echo "Checking the compiled physical-device application"
"$ios_root/Scripts/release-preflight.sh" \
    --app "$repo_root/.derived-data/hypo-ios-device/sym/Release-iphoneos/Hypo.app"
