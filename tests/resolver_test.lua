package.path = "luci-app-open_nexttrace/root/usr/lib/lua/?.lua;" .. package.path
local resolver = require "open_nexttrace.resolver"
local count = 0
local function check(value, message) count = count + 1; assert(value, message) end
local function u16(value) return resolver._u16(value) end
local question = "\7example\3com\0" .. u16(1) .. u16(1)
local response = u16(0x1234) .. u16(0x8180) .. u16(1) .. u16(1) .. u16(0) .. u16(0) ..
    question .. "\192\12" .. u16(1) .. u16(1) .. "\0\0\0\60" .. u16(4) .. string.char(1, 1, 1, 1)
local address, problem = resolver._parse(response, 0x1234, 1)
check(address == "1.1.1.1" and problem == nil, "parse compressed A response")
check(resolver._parse(response, 0x9999, 1) == nil, "reject mismatched transaction")
check(resolver._parse(response:sub(1, -3), 0x1234, 1) == nil, "reject truncated record")
print("resolver: " .. count .. " assertions passed")
