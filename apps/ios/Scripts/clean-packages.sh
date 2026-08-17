#!/usr/bin/env bash

set -euo pipefail

ios_root="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$ios_root/../.." && pwd)"

while IFS= read -r manifest; do
    package_directory="$(dirname "$manifest")"
    case "$package_directory" in
        "$ios_root"/Packages/*) ;;
        *)
            echo "Refusing to clean unexpected package path: $package_directory" >&2
            exit 1
            ;;
    esac
    echo "Cleaning $(basename "$package_directory")"
    swift package --package-path "$package_directory" clean
    swift package --package-path "$package_directory" reset
    rm -rf "$package_directory/.build" "$package_directory/build"
done < <(find "$ios_root/Packages" -name .build -prune -o -name Package.swift -print | sort)

echo "Cleaning application and retained Xcode evidence"
rm -rf \
    "$ios_root/App/build" \
    "$repo_root/.derived-data/hypo-ios" \
    "$repo_root/.derived-data/hypo-ios-device" \
    "$repo_root/.derived-data/hypo-ios-ui-tests" \
    "$repo_root/.derived-data/hypo-ios-testflight-ui-tests" \
    "$repo_root/.derived-data/design-system-gallery" \
    "$repo_root/docs/site/build" \
    "$repo_root/docs/site/static/ios-api" \
    "$repo_root/docs/site/.docusaurus" \
    "$repo_root/node_modules/.cache" \
    "$repo_root/node_modules/.vite"
