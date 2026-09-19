#!/bin/bash

set -euo pipefail

PACKAGE_FORMAT="${1:?package format is required}"
TARGET_ARCH="${2:?target architecture is required}"

case "$PACKAGE_FORMAT" in
	(ipk|apk) ;;
	(*)
		echo "Unsupported package format: $PACKAGE_FORMAT" >&2
		exit 2
		;;
esac

cd /builder

echo "Preparing OpenWrt feeds for ${TARGET_ARCH} (${PACKAGE_FORMAT})"
./scripts/feeds update -a
./scripts/feeds install -a

# Add both local packages before make generates tmp/.packageinfo. This avoids
# the stale package metadata produced when SDK helpers install them one by one.
rm -rf package/open-nexttrace-core package/luci-app-open_nexttrace
cp -a /workspace/open-nexttrace-core package/open-nexttrace-core
cp -a /workspace/luci-app-open_nexttrace package/luci-app-open_nexttrace

make defconfig

echo "Building open-nexttrace-core"
make package/open-nexttrace-core/compile -j"$(nproc)" V=s

echo "Building luci-app-open_nexttrace"
make package/luci-app-open_nexttrace/compile -j"$(nproc)" V=s

for package in open-nexttrace-core luci-app-open_nexttrace; do
	mapfile -t files < <(find /builder/bin/packages -type f -name "${package}*.${PACKAGE_FORMAT}")
	if (( ${#files[@]} == 0 )); then
		echo "No ${PACKAGE_FORMAT} package was produced for ${package}" >&2
		exit 1
	fi
	printf '%s\n' "${files[@]}"
done
