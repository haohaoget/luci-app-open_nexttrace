include $(TOPDIR)/rules.mk

LUCI_TITLE:=OpenTrace-style visual traceroute for OpenWrt
LUCI_DEPENDS:=+open-nexttrace-core +luci-base +lua +luci-lib-nixio +luci-lib-jsonc +libubus-lua
LUCI_PKGARCH:=all
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-3.0-only

define Build/Prepare/luci-app-open_nexttrace
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/libexec/rpcd/open_nexttrace
endef

include $(TOPDIR)/feeds/luci/luci.mk
