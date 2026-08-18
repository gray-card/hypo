#!/usr/bin/env bash

set -euo pipefail

ios_root="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$ios_root/../.." && pwd)"
workspace="$ios_root/Hypo.xcworkspace"
privacy_manifest="$ios_root/App/PrivacyInfo.xcprivacy"
app_info="$ios_root/App/Info.plist"
app_entitlements="$ios_root/App/Hypo.entitlements"
system_extension_info="$ios_root/Extensions/SystemIntegration/Info.plist"
system_extension_entitlements="$ios_root/Extensions/SystemIntegration/SystemIntegration.entitlements"
system_extension_privacy_manifest="$ios_root/Extensions/SystemIntegration/PrivacyInfo.xcprivacy"
app_icon="$ios_root/App/Assets.xcassets/AppIcon.appiconset/HypoAppIcon.png"
oauth_metadata="$repo_root/public/ios-client-metadata.json"
release_ref=""
app_bundle=""
compiled_build_version=""
require_signature=false

usage() {
    cat <<'EOF'
Usage: release-preflight.sh [--release-ref ios-vX.Y.Z] [--app /path/to/Hypo.app]
                            [--build-version POSITIVE_INTEGER] [--require-signature]

Checks source release metadata. When --app is supplied, also checks the compiled
bundle's identity, version, privacy manifest, executable, and deployment target.
Use --build-version when release automation overrides CURRENT_PROJECT_VERSION.
Use --require-signature for an archive or export that must have distribution
signatures and the reviewed app, app-group, and CloudKit entitlements.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --release-ref)
            [[ $# -ge 2 ]] || { usage >&2; exit 2; }
            release_ref="$2"
            shift 2
            ;;
        --app)
            [[ $# -ge 2 ]] || { usage >&2; exit 2; }
            app_bundle="$2"
            shift 2
            ;;
        --build-version)
            [[ $# -ge 2 ]] || { usage >&2; exit 2; }
            compiled_build_version="$2"
            shift 2
            ;;
        --require-signature)
            require_signature=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

fail() {
    echo "Release preflight failed: $*" >&2
    exit 1
}

if [[ "$require_signature" == true && -z "$app_bundle" ]]; then
    fail "--require-signature requires --app"
fi

plist_value() {
    /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2>/dev/null || true
}

plist_canonical() {
    /usr/libexec/PlistBuddy -c Print "$1"
}

echo "Validating Xcode release settings"
build_settings="$(
    xcodebuild \
        -workspace "$workspace" \
        -scheme Hypo \
        -configuration Release \
        -destination 'generic/platform=iOS' \
        -disableAutomaticPackageResolution \
        -onlyUsePackageVersionsFromResolvedFile \
        -showBuildSettings
)"

setting() {
    local key="$1"
    awk -F ' = ' -v key="$key" '
        /^Build settings for action build and target Hypo:/ { in_hypo = 1; next }
        /^Build settings for action build and target / { in_hypo = 0 }
        in_hypo && $1 ~ "^[[:space:]]*" key "$" { print $2; exit }
    ' \
        <<<"$build_settings"
}

bundle_id="$(setting PRODUCT_BUNDLE_IDENTIFIER)"
marketing_version="$(setting MARKETING_VERSION)"
build_version="$(setting CURRENT_PROJECT_VERSION)"
deployment_target="$(setting IPHONEOS_DEPLOYMENT_TARGET)"
targeted_device_family="$(setting TARGETED_DEVICE_FAMILY)"
supported_platforms="$(setting SUPPORTED_PLATFORMS)"
generated_info_plist="$(setting GENERATE_INFOPLIST_FILE)"
info_plist_file="$(setting INFOPLIST_FILE)"
app_icon_name="$(setting ASSETCATALOG_COMPILER_APPICON_NAME)"
camera_usage_description="$(plist_value "$app_info" NSCameraUsageDescription)"
location_usage_description="$(plist_value "$app_info" NSLocationWhenInUseUsageDescription)"
motion_usage_description="$(plist_value "$app_info" NSMotionUsageDescription)"
background_refresh_identifiers="$(plist_value "$app_info" BGTaskSchedulerPermittedIdentifiers)"
background_modes="$(plist_value "$app_info" UIBackgroundModes)"
url_types="$(plist_value "$app_info" CFBundleURLTypes)"
uses_non_exempt_encryption="$(plist_value "$app_info" ITSAppUsesNonExemptEncryption)"
swift_version="$(setting SWIFT_VERSION)"
strict_concurrency="$(setting SWIFT_STRICT_CONCURRENCY)"
code_sign_entitlements="$(setting CODE_SIGN_ENTITLEMENTS)"

[[ "$bundle_id" == "app.graycard.hypo" ]] || fail "unexpected bundle identifier '$bundle_id'"
[[ "$marketing_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || \
    fail "MARKETING_VERSION must be X.Y.Z, found '$marketing_version'"
[[ "$build_version" =~ ^[1-9][0-9]*$ ]] || \
    fail "CURRENT_PROJECT_VERSION must be a positive integer, found '$build_version'"
if [[ -n "$compiled_build_version" && ! "$compiled_build_version" =~ ^[1-9][0-9]*$ ]]; then
    fail "--build-version must be a positive integer, found '$compiled_build_version'"
fi
[[ "$deployment_target" == "17.0" ]] || \
    fail "the release deployment target must be iOS 17.0, found '$deployment_target'"
[[ "$targeted_device_family" == "1" ]] || \
    fail "Hypo must remain iPhone-only for this release, found device family '$targeted_device_family'"
[[ " $supported_platforms " == *" iphoneos "* ]] || fail "iphoneos is not a supported platform"
[[ " $supported_platforms " == *" iphonesimulator "* ]] || \
    fail "iphonesimulator is not a supported platform"
[[ "$generated_info_plist" == "NO" ]] || fail "the target must use the reviewed Info.plist"
[[ "$info_plist_file" == "Info.plist" ]] || fail "the target must use App/Info.plist"
[[ "$app_icon_name" == "AppIcon" ]] || fail "the AppIcon asset is not configured"
[[ -n "$camera_usage_description" ]] || fail "NSCameraUsageDescription is missing"
[[ -n "$location_usage_description" ]] || \
    fail "NSLocationWhenInUseUsageDescription is missing"
[[ -n "$motion_usage_description" ]] || fail "NSMotionUsageDescription is missing"
[[ "$background_refresh_identifiers" == *"app.graycard.hypo.sync-refresh"* ]] || \
    fail "the sync BGAppRefreshTask identifier is missing"
[[ "$background_modes" == *"fetch"* ]] || \
    fail "the app must declare the fetch background mode"
[[ "$url_types" == *"hypo"* && "$url_types" == *"app.graycard.hypo"* ]] || \
    fail "the app URL schemes are missing"
[[ "$uses_non_exempt_encryption" == "false" ]] || \
    fail "ITSAppUsesNonExemptEncryption must record the reviewed exempt-encryption classification"
[[ "$swift_version" == "6.0" ]] || fail "the app target must compile in Swift 6 mode"
[[ "$strict_concurrency" == "complete" ]] || fail "strict concurrency must remain complete"
[[ "$code_sign_entitlements" == "Hypo.entitlements" ]] || \
    fail "the app-group entitlements file is not configured"

if [[ -n "$release_ref" ]]; then
    expected_ref="ios-v$marketing_version"
    [[ "$release_ref" == "$expected_ref" ]] || \
        fail "release ref '$release_ref' does not match MARKETING_VERSION (expected '$expected_ref')"
fi

echo "Validating privacy and App Store source metadata"
plutil -lint \
    "$app_info" \
    "$privacy_manifest" \
    "$app_entitlements" \
    "$system_extension_info" \
    "$system_extension_entitlements" \
    "$system_extension_privacy_manifest" >/dev/null
for entitlements in "$app_entitlements" "$system_extension_entitlements"; do
    groups="$(plist_value "$entitlements" com.apple.security.application-groups)"
    [[ "$groups" == *"group.app.graycard.hypo"* ]] || \
        fail "$(basename "$entitlements") is missing the shared app group"
done
icloud_containers="$(plist_value "$app_entitlements" com.apple.developer.icloud-container-identifiers)"
icloud_services="$(plist_value "$app_entitlements" com.apple.developer.icloud-services)"
associated_domains="$(plist_value "$app_entitlements" com.apple.developer.associated-domains)"
[[ "$icloud_containers" == *"iCloud.app.graycard.hypo"* ]] || \
    fail "Hypo.entitlements is missing the private CloudKit container"
[[ "$icloud_services" == *"CloudKit"* ]] || \
    fail "Hypo.entitlements is missing the CloudKit service"
[[ "$associated_domains" == *"applinks:hypo.graycard.app"* ]] || \
    fail "Hypo.entitlements is missing the production universal-link domain"
[[ "$(plist_value "$privacy_manifest" NSPrivacyTracking)" == "false" ]] || \
    fail "NSPrivacyTracking must be false"
[[ "$(plist_value "$privacy_manifest" NSPrivacyTrackingDomains)" == "Array {"$'\n'"}" ]] || \
    fail "NSPrivacyTrackingDomains must be empty"
[[ "$(plist_value "$system_extension_privacy_manifest" NSPrivacyTracking)" == "false" ]] || \
    fail "SystemIntegration NSPrivacyTracking must be false"
[[ "$(plist_value "$system_extension_privacy_manifest" NSPrivacyTrackingDomains)" == \
    "Array {"$'\n'"}" ]] || fail "SystemIntegration tracking domains must be empty"
[[ "$(plist_value "$system_extension_privacy_manifest" NSPrivacyCollectedDataTypes)" == \
    "Array {"$'\n'"}" ]] || fail "SystemIntegration must not declare collected data"
collected_data_types="$(plist_value "$privacy_manifest" NSPrivacyCollectedDataTypes)"
for data_type in \
    NSPrivacyCollectedDataTypeUserID \
    NSPrivacyCollectedDataTypeOtherUserContent \
    NSPrivacyCollectedDataTypePreciseLocation \
    NSPrivacyCollectedDataTypeDeviceID \
    NSPrivacyCollectedDataTypeOtherDataTypes; do
    [[ "$collected_data_types" == *"$data_type"* ]] || \
        fail "the privacy manifest is missing $data_type"
done
node - "$privacy_manifest" "$system_extension_privacy_manifest" <<'NODE'
const { execFileSync } = require("node:child_process");

function readPlist(path) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path], {
    encoding: "utf8",
  }));
}

function normalizedAccessedAPIs(document) {
  return Object.fromEntries(
    (document.NSPrivacyAccessedAPITypes ?? []).map((entry) => [
      entry.NSPrivacyAccessedAPIType,
      [...(entry.NSPrivacyAccessedAPITypeReasons ?? [])].sort(),
    ]).sort(([left], [right]) => left.localeCompare(right))
  );
}

function assertExact(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} required-reason API declarations differ from the reviewed set`);
  }
}

assertExact(
  normalizedAccessedAPIs(readPlist(process.argv[2])),
  {
    NSPrivacyAccessedAPICategorySystemBootTime: ["8FFB.1"],
    NSPrivacyAccessedAPICategoryUserDefaults: ["1C8F.1", "CA92.1"],
  },
  "Hypo"
);
assertExact(
  normalizedAccessedAPIs(readPlist(process.argv[3])),
  { NSPrivacyAccessedAPICategoryUserDefaults: ["1C8F.1"] },
  "SystemIntegration"
);
NODE

icon_properties="$(sips -g pixelWidth -g pixelHeight -g hasAlpha "$app_icon")"
grep -q 'pixelWidth: 1024' <<<"$icon_properties" || fail "the App Store icon must be 1024 pixels wide"
grep -q 'pixelHeight: 1024' <<<"$icon_properties" || fail "the App Store icon must be 1024 pixels high"
grep -q 'hasAlpha: no' <<<"$icon_properties" || fail "the App Store icon must not contain an alpha channel"

# The single-quoted program is JavaScript; its template literal must not expand in the shell.
# shellcheck disable=SC2016
node -e '
const fs = require("node:fs");
const metadata = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const expected = {
  client_id: "https://hypo.graycard.app/ios-client-metadata.json",
  application_type: "native",
  token_endpoint_auth_method: "none",
};
for (const [key, value] of Object.entries(expected)) {
  if (metadata[key] !== value) throw new Error(`${key} must be ${value}`);
}
if (metadata.dpop_bound_access_tokens !== true) throw new Error("DPoP must be required");
if (!metadata.redirect_uris?.includes("app.graycard.hypo:/oauth/callback")) {
  throw new Error("native redirect URI is missing");
}
if (!metadata.grant_types?.includes("authorization_code") ||
    !metadata.grant_types?.includes("refresh_token")) {
  throw new Error("authorization_code and refresh_token grants are required");
}
if (typeof metadata.scope !== "string" || !metadata.scope.startsWith("atproto ")) {
  throw new Error("ATProto OAuth scope is missing");
}
' "$oauth_metadata"

for resolved in \
    "$ios_root/Hypo.xcworkspace/xcshareddata/swiftpm/Package.resolved" \
    "$ios_root/Packages/PanprotoKit/Package.resolved"; do
    [[ -f "$resolved" ]] || fail "missing SwiftPM pin file: $resolved"
done
# The single-quoted program is JavaScript; its template literals must not expand in the shell.
# shellcheck disable=SC2016
node -e '
const fs = require("node:fs");
const paths = process.argv.slice(1);
const documents = paths.map((path) => JSON.parse(fs.readFileSync(path, "utf8")));
const normalizedPins = documents.map((resolved) => JSON.stringify(resolved.pins ?? []));
if (!normalizedPins.every((pins) => pins === normalizedPins[0])) {
  throw new Error("workspace and PanprotoKit SwiftPM pins differ");
}
const resolved = documents[0];
const pin = resolved.pins?.find((candidate) => candidate.identity === "panproto-swift");
if (!pin) throw new Error("panproto-swift pin is missing");
if (pin.location !== "https://github.com/panproto/panproto-swift.git") {
  throw new Error(`unexpected panproto-swift source: ${pin.location}`);
}
if (pin.state?.version !== "0.70.1" ||
    pin.state?.revision !== "99855a0bc4c2f9cc43abe130b6753fbc626ccbce") {
  throw new Error("panproto-swift must remain pinned to reviewed release 0.70.1");
}
' \
    "$ios_root/Hypo.xcworkspace/xcshareddata/swiftpm/Package.resolved" \
    "$ios_root/Packages/PanprotoKit/Package.resolved"

if [[ -z "$app_bundle" ]]; then
    echo "Release source metadata is valid for Hypo $marketing_version ($build_version)."
    exit 0
fi

echo "Validating compiled application bundle"
[[ -d "$app_bundle" ]] || fail "compiled app does not exist: $app_bundle"
compiled_plist="$app_bundle/Info.plist"
compiled_privacy="$app_bundle/PrivacyInfo.xcprivacy"
[[ -f "$compiled_plist" ]] || fail "compiled app is missing Info.plist"
[[ -f "$compiled_privacy" ]] || fail "compiled app is missing PrivacyInfo.xcprivacy"
plutil -lint "$compiled_plist" "$compiled_privacy" >/dev/null
[[ "$(plist_canonical "$privacy_manifest")" == \
    "$(plist_canonical "$compiled_privacy")" ]] || \
    fail "compiled privacy manifest differs from the reviewed source manifest"

[[ "$(plist_value "$compiled_plist" CFBundleIdentifier)" == "$bundle_id" ]] || \
    fail "compiled bundle identifier differs from the release setting"
[[ "$(plist_value "$compiled_plist" CFBundleShortVersionString)" == "$marketing_version" ]] || \
    fail "compiled marketing version differs from the release setting"
expected_compiled_build="${compiled_build_version:-$build_version}"
[[ "$(plist_value "$compiled_plist" CFBundleVersion)" == "$expected_compiled_build" ]] || \
    fail "compiled build number differs from the expected build '$expected_compiled_build'"
[[ "$(plist_value "$compiled_plist" MinimumOSVersion)" == "$deployment_target" ]] || \
    fail "compiled minimum OS differs from the release setting"
[[ -n "$(plist_value "$compiled_plist" NSCameraUsageDescription)" ]] || \
    fail "compiled app is missing NSCameraUsageDescription"
[[ -n "$(plist_value "$compiled_plist" NSLocationWhenInUseUsageDescription)" ]] || \
    fail "compiled app is missing NSLocationWhenInUseUsageDescription"
[[ -n "$(plist_value "$compiled_plist" NSMotionUsageDescription)" ]] || \
    fail "compiled app is missing NSMotionUsageDescription"
compiled_background_identifiers="$(plist_value "$compiled_plist" BGTaskSchedulerPermittedIdentifiers)"
compiled_background_modes="$(plist_value "$compiled_plist" UIBackgroundModes)"
compiled_url_types="$(plist_value "$compiled_plist" CFBundleURLTypes)"
[[ "$compiled_background_identifiers" == *"app.graycard.hypo.sync-refresh"* ]] || \
    fail "compiled app is missing the sync BGAppRefreshTask identifier"
[[ "$compiled_background_modes" == *"fetch"* ]] || \
    fail "compiled app is missing the fetch background mode"
[[ "$compiled_url_types" == *"hypo"* && "$compiled_url_types" == *"app.graycard.hypo"* ]] || \
    fail "compiled app is missing its URL schemes"

timer_extension="$app_bundle/PlugIns/TimerActivity.appex"
system_extension="$app_bundle/PlugIns/SystemIntegration.appex"
for extension in "$timer_extension" "$system_extension"; do
    [[ -d "$extension" ]] || fail "compiled app is missing $(basename "$extension")"
    extension_plist="$extension/Info.plist"
    plutil -lint "$extension_plist" >/dev/null
    [[ "$(plist_value "$extension_plist" MinimumOSVersion)" == "$deployment_target" ]] || \
        fail "$(basename "$extension") does not target iOS $deployment_target"
done
[[ "$(plist_value "$timer_extension/Info.plist" CFBundleIdentifier)" == \
    "app.graycard.hypo.TimerActivity" ]] || fail "unexpected TimerActivity bundle identifier"
[[ "$(plist_value "$system_extension/Info.plist" CFBundleIdentifier)" == \
    "app.graycard.hypo.SystemIntegration" ]] || fail "unexpected SystemIntegration bundle identifier"
[[ -f "$system_extension/Metadata.appintents/extract.actionsdata" ]] || \
    fail "SystemIntegration is missing extracted App Intents metadata"
compiled_system_privacy="$system_extension/PrivacyInfo.xcprivacy"
[[ -f "$compiled_system_privacy" ]] || \
    fail "SystemIntegration is missing PrivacyInfo.xcprivacy"
plutil -lint "$compiled_system_privacy" >/dev/null
[[ "$(plist_canonical "$system_extension_privacy_manifest")" == \
    "$(plist_canonical "$compiled_system_privacy")" ]] || \
    fail "compiled SystemIntegration privacy manifest differs from the reviewed source manifest"

if [[ "$require_signature" == true ]]; then
    echo "Validating distribution signatures and signed entitlements"
    signed_entitlements_directory="$(mktemp -d "${TMPDIR:-/tmp}/hypo-entitlements.XXXXXX")"
    trap 'rm -r "$signed_entitlements_directory"' EXIT

    signed_entitlements() {
        local bundle="$1"
        local destination="$2"
        codesign --verify --strict --verbose=2 "$bundle"
        codesign -d --entitlements :- "$bundle" >"$destination" 2>/dev/null || \
            fail "could not read signed entitlements from $(basename "$bundle")"
        [[ -s "$destination" ]] || \
            fail "$(basename "$bundle") has no signed entitlements"
        plutil -lint "$destination" >/dev/null || \
            fail "$(basename "$bundle") has malformed signed entitlements"
    }

    app_signed_entitlements="$signed_entitlements_directory/Hypo.plist"
    timer_signed_entitlements="$signed_entitlements_directory/TimerActivity.plist"
    system_signed_entitlements="$signed_entitlements_directory/SystemIntegration.plist"
    signed_entitlements "$app_bundle" "$app_signed_entitlements"
    signed_entitlements "$timer_extension" "$timer_signed_entitlements"
    signed_entitlements "$system_extension" "$system_signed_entitlements"

    signed_app_identifier="$(plist_value "$app_signed_entitlements" application-identifier)"
    signed_timer_identifier="$(plist_value "$timer_signed_entitlements" application-identifier)"
    signed_system_identifier="$(plist_value "$system_signed_entitlements" application-identifier)"
    signed_team="$(plist_value "$app_signed_entitlements" com.apple.developer.team-identifier)"
    signed_timer_team="$(plist_value "$timer_signed_entitlements" com.apple.developer.team-identifier)"
    signed_system_team="$(plist_value "$system_signed_entitlements" com.apple.developer.team-identifier)"
    signed_app_groups="$(plist_value "$app_signed_entitlements" com.apple.security.application-groups)"
    signed_icloud_containers="$(plist_value "$app_signed_entitlements" com.apple.developer.icloud-container-identifiers)"
    signed_icloud_services="$(plist_value "$app_signed_entitlements" com.apple.developer.icloud-services)"
    signed_associated_domains="$(plist_value "$app_signed_entitlements" com.apple.developer.associated-domains)"
    signed_system_groups="$(plist_value "$system_signed_entitlements" com.apple.security.application-groups)"
    [[ -n "$signed_team" && "$signed_timer_team" == "$signed_team" && \
        "$signed_system_team" == "$signed_team" ]] || \
        fail "signed app and extensions do not share one Apple team"
    [[ "$signed_app_identifier" == *.app.graycard.hypo ]] || \
        fail "signed Hypo.app has an unexpected application identifier"
    [[ "$signed_timer_identifier" == *.app.graycard.hypo.TimerActivity ]] || \
        fail "signed TimerActivity has an unexpected application identifier"
    [[ "$signed_system_identifier" == *.app.graycard.hypo.SystemIntegration ]] || \
        fail "signed SystemIntegration has an unexpected application identifier"
    [[ "$signed_app_groups" == *"group.app.graycard.hypo"* ]] || \
        fail "signed Hypo.app is missing the shared app group"
    [[ "$signed_system_groups" == *"group.app.graycard.hypo"* ]] || \
        fail "signed SystemIntegration is missing the shared app group"
    [[ "$signed_icloud_containers" == *"iCloud.app.graycard.hypo"* ]] || \
        fail "signed Hypo.app is missing the private CloudKit container"
    [[ "$signed_icloud_services" == *"CloudKit"* ]] || \
        fail "signed Hypo.app is missing the CloudKit service"
    [[ "$signed_associated_domains" == *"applinks:hypo.graycard.app"* ]] || \
        fail "signed Hypo.app is missing the production universal-link domain"
fi

executable_name="$(plist_value "$compiled_plist" CFBundleExecutable)"
executable="$app_bundle/$executable_name"
[[ -x "$executable" ]] || fail "compiled app executable is missing"
lipo -info "$executable" | grep -q 'arm64' || fail "compiled app does not contain arm64"

compiled_minos="$({ vtool -show-build "$executable" || otool -l "$executable"; } | \
    awk '/minos/{print $2; exit}')"
[[ "$compiled_minos" == "17.0" ]] || \
    fail "compiled executable must have an iOS 17.0 minimum, found '$compiled_minos'"

echo "Compiled Hypo.app is valid for release metadata and minimum-target checks."
