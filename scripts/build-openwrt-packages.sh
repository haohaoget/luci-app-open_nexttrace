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
./scripts/feeds install -p luci \
	ca-bundle \
	lua \
	libubus-lua \
	luci-base \
	luci-lib-nixio \
	luci-lib-jsonc

# Use a conventional hyphenated build directory while retaining the published
# package name luci-app-open_nexttrace in its Makefile.
rm -rf package/open-nexttrace-core package/luci-app-open-nexttrace
cp -a /workspace/open-nexttrace-core package/open-nexttrace-core
cp -a /workspace/luci-app-open_nexttrace package/luci-app-open-nexttrace

# feeds install may have generated package metadata before the local packages
# existed. Force one clean metadata pass with both packages present.
rm -f tmp/.packageinfo tmp/.packagedeps tmp/.config-package.in tmp/.config-feeds.in

# Selecting the packages lets OpenWrt order and stage their complete dependency
# graph. Calling an unselected package target can start LuCI libraries before
# the base feed has installed headers such as lua.h and netlink/msg.h.
cat >> .config <<'EOF'
CONFIG_PACKAGE_open-nexttrace-core=m
CONFIG_PACKAGE_luci-app-open_nexttrace=m
EOF
make defconfig

grep -q '^CONFIG_PACKAGE_open-nexttrace-core=m$' .config
grep -q '^CONFIG_PACKAGE_luci-app-open_nexttrace=m$' .config

echo "Building open-nexttrace-core"
make package/open-nexttrace-core/compile -j1 V=s

echo "Building luci-app-open_nexttrace"
make package/luci-app-open-nexttrace/compile -j1 V=s

for package in open-nexttrace-core luci-app-open_nexttrace; do
	mapfile -t files < <(find /builder/bin/packages -type f -name "${package}*.${PACKAGE_FORMAT}")
	if (( ${#files[@]} == 0 )); then
		echo "No ${PACKAGE_FORMAT} package was produced for ${package}" >&2
		exit 1
	fi
	printf '%s\n' "${files[@]}"
done
