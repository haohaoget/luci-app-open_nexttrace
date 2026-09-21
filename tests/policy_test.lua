package.path = "luci-app-open_nexttrace/root/usr/lib/lua/?.lua;" .. package.path
local policy = require "open_nexttrace.policy"
local count = 0
local function check(value, message) count = count + 1; assert(value, message) end
local dump = { interface = {
    { interface = "lan", l3_device = "br-lan", up = true, ["ipv4-address"] = {{address = "192.168.1.1"}} },
    { interface = "wan", l3_device = "pppoe-wan", device = "eth0.2", up = true,
        ["ipv4-address"] = {{address = "198.51.100.2"}}, ["dns-server"] = {"1.1.1.1"},
        route = {{target = "0.0.0.0", mask = 0}} },
    { interface = "wan6", l3_device = "pppoe-wan", up = true,
        ["ipv6-address"] = {{address = "2001:db8::2"}}, route = {{target = "::", mask = 0}} },
    { interface = "wan2", l3_device = "eth1", up = false, ["ipv4-address"] = {{address = "192.0.2.2"}} },
    { interface = "vpn", l3_device = "wg0", up = true, ["ipv4-address"] = {{address = "10.0.0.1"}} },
    { interface = "loopback", l3_device = "lo", up = true },
} }
local interfaces = policy.interfaces(dump)
check(#interfaces == 5, "exclude loopback")
check(interfaces[1].wan and interfaces[1].device == "pppoe-wan", "default-route WAN first; prefer l3_device")
check(interfaces[1].dns[1] == "1.1.1.1", "interface DNS servers are exposed")
local function args(options, explicit) return table.concat(policy.build(options, interfaces, explicit), " ") end
check(not args({target = "example.com"}):find("--dev", 1, true), "default route must omit --dev")
check(not args({target = "example.com"}):find("--traceroute", 1, true), "v1.7.3 compatibility")
check(args({target = "example.com"}, true):find("--traceroute", 1, true), "new core explicit mode")
check(args({target = "example.com", device = "pppoe-wan"}):find("--dev pppoe-wan", 1, true), "selected actual device")
check(args({target = "::1", family = "6", device = "pppoe-wan"}):find("-6", 1, true), "IPv6 across shared WAN device")
check(args({target = "1.1.1.1", protocol = "udp"}):find("--port 33494", 1, true), "UDP default port")
check(args({target = "1.1.1.1", protocol = "tcp", port = 443}):find("--tcp --port 443", 1, true), "TCP port")
check(args({target = "1.1.1.1", rdns = false}):find("--no-rdns", 1, true), "disable RDNS")
check(args({target = "1.1.1.1", provider = "IPAPI.com"}):find("IPAPI.com", 1, true), "IP-API.com provider")
local resolver = policy.resolver({target = "example.com", family = "4", dns_server = "1.1.1.1",
    dns_port = 53, dns_source = "198.51.100.2"}, interfaces)
check(resolver.server == "1.1.1.1" and resolver.source == "198.51.100.2", "custom DNS policy")
check(policy.resolver({target = "1.1.1.1", dns_server = "8.8.8.8"}, interfaces) == nil, "literal IP skips DNS")
check(not pcall(policy.resolver, {target = "example.com", dns_server = "bad"}, interfaces), "reject hostname DNS server")
check(not pcall(policy.resolver, {target = "example.com", dns_server = "1.1.1.1", dns_source = "192.0.2.2"}, interfaces), "reject offline DNS source")
for _, target in ipairs({";id", "example.com;reboot", "$(id)", "`id`", "--help", "a b", "a\nb", "https://example.com", "a/b", "a_b", string.rep("a", 254), ""}) do
    check(not pcall(policy.build, {target = target}, interfaces), "reject unsafe target " .. target)
end
for _, target in ipairs({"example.com", "1.1.1.1", "2001:db8::1", "::1", "xn--fiqs8s.example"}) do
    check(pcall(policy.build, {target = target}, interfaces), "accept " .. target)
end
for _, option in ipairs({{device = "eth1"}, {device = "not-found"}, {device = "eth0;id"}, {device = "wg0", family = "6"},
    {protocol = "shell"}, {family = "7"}, {max_hops = 65}, {queries = 0}, {timeout = 5001}, {port = 65536},
    {queries = "3"}, {queries = 1.5}, {provider = "bad"}, {rdns = "true"}}) do
    option.target = "example.com"
    check(not pcall(policy.build, option, interfaces), "reject invalid option")
end
check(#policy.interfaces({}) == 0, "empty interfaces")
check(policy.target("example.com") == false and policy.target("1.1.1.1") == true, "distinguish domain and literal IP")
check(not pcall(policy.target, "example.com;id"), "resolver rejects unsafe domain")
print("policy: " .. count .. " assertions passed")
