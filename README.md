# luci-app-open_nexttrace

OpenWrt / LuCI 路由追踪可视化插件。界面参考 [OpenTrace](https://github.com/Archeb/opentrace)，探测使用 [NextTrace 官方发布的核心二进制](https://github.com/nxtrace/NTrace-core/releases)，不在固件构建时编译 Go。

界面顺序：**顶部工具栏 → 实时逐跳结果 → 路由地图**。安装后进入 **网络 → Open NextTrace**。

## 功能

- 域名 / IPv4 / IPv6，ICMP / TCP / UDP，端口、跳数、探测次数、超时、rDNS 和 IP 数据源设置。
- 每秒刷新核心的 RAW 输出，显示 IP、每次 RTT、位置、组织、ASN、主机名和本跳未响应比例；保留同一跳不同响应 IP。
- Leaflet 地图随追踪更新；表格和地图互相定位、跨日期变更线连接、完整路径缩放、CSV 导出。
- 出口接口默认是“默认出口（系统路由）”，此时**不传 `--dev`**；一个或多个 WAN 都保持系统默认选路。
- 下拉框读取 netifd 的在线接口，优先展示带默认路由的 WAN，显示 `wan / wan6 · pppoe-wan` 这样的逻辑接口与实际设备对应关系。选中后传入实际 `l3_device`，适用于 PPPoE、VLAN、多 WAN，也保留 VPN / LAN 手动诊断选项。
- 单台路由器同时一个任务，支持停止、刷新页面恢复当前任务、异常状态和日志展示；180 秒总时限、128 KiB 输出阈值，结果留在 `/tmp`，重启后清除。
- 页面设置保存在当前浏览器；新任务保留默认出口，避免浏览器记住已失效的 WAN。正在运行/最近一次任务会显示该任务实际选择的出口。

## 目录

```text
luci-app-open_nexttrace/   LuCI 页面、地图、rpcd 接口和 ACL
open-nexttrace-core/       预编译核心软件包、版本和各架构 SHA-256
scripts/update-core.py    稳定版更新脚本
.github/workflows/       每日更新、测试、手动/标签触发 SDK 构建
tests/                   协议解析、参数、进程管理、更新器与打包元数据测试
tests/preview/           使用模拟数据加载真实页面代码的浏览器预览
opentrace/               本地参考项目，不纳入插件构建或 Git
NTrace-core/             本地参考项目，不纳入插件构建或 Git
```

## 编译进 OpenWrt

面向采用 JavaScript LuCI 的 OpenWrt，当前 GitHub Actions 同时使用 **25.12.5** SDK 构建 APK、使用 **24.10.8** SDK 构建 opkg/IPK。此目录是包含两个包的 feed，不是单个包；将两个软件包目录一起加入源码树。

```sh
# 在 OpenWrt 源码根目录执行，将 /path/to/... 替换为本仓库位置
mkdir -p package/open-nexttrace
cp -a /path/to/luci-app-open_nexttrace/luci-app-open_nexttrace package/open-nexttrace/
cp -a /path/to/luci-app-open_nexttrace/open-nexttrace-core package/open-nexttrace/

./scripts/feeds update -a
./scripts/feeds install -a
make menuconfig
# LuCI -> Applications -> luci-app-open_nexttrace
# 自动选中 Network -> open-nexttrace-core
make package/open-nexttrace/open-nexttrace-core/compile V=s
make package/open-nexttrace/luci-app-open_nexttrace/compile V=s
```

也可发布此仓库后，在 `feeds.conf.default` 中加入 `src-git open_nexttrace <你的仓库地址>`，然后更新该 feed 并安装两个包。不要同时用复制目录和 feed 两种方式安装，以免重名。

核心下载地址固定到版本，OpenWrt 下载阶段检查 SHA-256。核心保持官方二进制原样，不重新编译、不再次 strip；按官方命令名安装到 `/usr/bin/nexttrace`，可以直接在 SSH 中运行 `nexttrace` 调试。软件包声明与其他 `nexttrace` 包冲突，避免两个包同时拥有同一路径。完整核心在部分架构上体积较大，请根据固件剩余空间选择设备。

支持的映射：

| OpenWrt 架构 | 上游资产后缀 |
| --- | --- |
| x86_64 / i386 | amd64 / 386 |
| aarch64（aarch64_cortex-a53 / a72 / a76 / generic） | arm64 |
| arm，Cortex-A / Cortex-R | armv7 |
| arm，ARM1176 / ARM11 MPCore | armv6 |
| 其他 arm | armv5（保守兼容） |
| mips / mipsel | 按 `CONFIG_SOFT_FLOAT` 选择 mips(le) 或 mips(le)_softfloat |
| mips64 / mips64el | mips64 / mips64le |
| powerpc64 / powerpc64le | ppc64 / ppc64le |
| riscv64 / loongarch64 | riscv64 / loong64 |
| s390x | s390x |

以上覆盖当前 NextTrace 发布页列出的全部 Linux 资产。MIPS64 上游只提供 mips64 / mips64le，没有 softfloat 变体，因此仍需由具体 OpenWrt SDK 和真机确认 ABI。ARM64 应匹配 64 位系统架构；32 位 ARM 系统即使 CPU 支持 ARM64，也应使用 ARM 资产。

## 安装独立软件包

从与你设备架构及固件版本匹配的 SDK 构建产物中取出两个包。OpenWrt 25.12 示例：

```sh
apk update
apk add --allow-untrusted --force-non-repository /tmp/open-nexttrace-core-*.apk /tmp/luci-app-open_nexttrace-*.apk
/etc/init.d/rpcd restart
```

OpenWrt 24.10 及其他使用 opkg 的固件安装 IPK：

```sh
opkg update
opkg install /tmp/open-nexttrace-core_*.ipk /tmp/luci-app-open_nexttrace_*.ipk
/etc/init.d/rpcd restart
```

依赖包括 `luci-base`、`lua`、`luci-lib-nixio`、`luci-lib-jsonc`、`libubus-lua` 和 CA 证书。安装时由包管理器解决依赖。自行签名或配置可信软件源后可省略 `--allow-untrusted`。APK 与 IPK 必须匹配固件的包管理器、OpenWrt 版本和 CPU 架构，不要跨版本或跨格式安装。打开 LuCI 的 **网络 → Open NextTrace**，填写目标并开始即可，不需要另外运行核心的 Web 服务或开放端口。

## GitHub Actions 每日更新

推送本仓库到 GitHub 后，在 Actions 中启用工作流并允许 `GITHUB_TOKEN` 写入仓库内容。

- `Update NextTrace core`：每天 **北京时间 03:23** 检查最新正式 release，也可手动运行。读取 GitHub 资产的 SHA-256；没有 digest 时下载计算。必须取得全部支持架构，才原子更新 `open-nexttrace-core/version.mk`；拒绝预发布、缺失资产、非法 URL / 哈希和降级。仅文件变化时提交，无变化不创建提交。受保护分支若不允许机器人推送，需按仓库规则改用 PR 流程。
- `Check plugin`：push / PR 运行 Node、Python、Lua 5.1 测试。
- `Build OpenWrt packages`：手动触发或推送 `v*` 标签时，直接使用官方 `ghcr.io/openwrt/sdk` 容器构建 25.12.5 APK 和 24.10.8 IPK。矩阵包含 x86_64、mipsel_24kc、aarch64_cortex-a53、aarch64_cortex-a72、aarch64_cortex-a76、aarch64_generic；每个 artifact 名称都标明格式、架构和版本。容器在执行 `make defconfig` 前同时放入核心包和 LuCI 包，再分别编译并检查两个安装包均已产出。

机器人用 `GITHUB_TOKEN` 推送更新通常不会再次触发 push 工作流；每日任务的职责是更新版本与哈希。需要新安装包时手动运行构建工作流。此更新不在路由器上静默下载、替换正在使用的核心。

手动更新及完整下载校验：

```sh
python3 scripts/update-core.py
python3 scripts/update-core.py --verify-downloads
```

## 运行行为与边界

- 默认选路交给系统和现有策略路由。`--dev` 由核心解释，不修改 OpenWrt 网络配置或 mwan3 规则；DNS、GeoIP API 的网络访问仍由系统选路。实际多 WAN 出口应通过各 WAN 的抓包核对。
- v1.7.3 没有新源码中的 `--traceroute` 参数。后端检测安装核心的 `--help`，仅在支持时使用该参数，兼容后续默认模式变化。
- 地理位置来自所选数据源；接口地址、私网、中间节点可能没有坐标。地图仅连接每跳首个有坐标的响应，虚线跨过未定位跳点，不表示精确物理路径或完整 ECMP 拓扑。
- 地图代码随包分发，瓦片由浏览器访问 OpenStreetMap；瓦片不可达时保留路由节点和表格，并显示提示。GeoIP 服务与 DNS 的可用性也会影响结果。
- RAW 输出没有完整的结构化终止原因；“追踪结束”仅表示核心已结束，不据此宣称目标已到达。中间节点未响应比例也不等同于端到端丢包。
- 只向有相应 LuCI ACL 的用户开放 `info/status/start/stop`。后端按参数数组启动核心，限制目标、协议、数值与在线接口；不开放任意 shell 或任意文件访问。拥有本插件读取权限的会话共享最近一次诊断结果，写入权限可停止当前共享任务；不会存储或返回 LuCI 会话令牌。

## 本地验证

```sh
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
lua5.1 tests/policy_test.lua
lua5.1 tests/backend_test.lua

# 仅用于界面验证，模拟 RPC 和路由数据，不会发送探测
python3 -m http.server 8765 --bind 127.0.0.1
# 打开 http://127.0.0.1:8765/tests/preview/
```

Lua 生命周期测试模拟 nixio 接口；Makefile 映射测试使用 GNU make 和 SDK include 桩，**不等价于 OpenWrt 构建**。本项目已在 aarch64、apk-tools 3 的 OpenWrt 路由器上验证 rpcd 注册、默认 WAN、指定第二 WAN、RAW 解析和任务状态；发布前仍应执行工作流构建，并在目标固件上验收 IPv6、TCP/UDP、停止、刷新恢复、断网/GeoIP 不可达和只读 ACL。

许可证：GPL-3.0-only。上游与地图组件声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
