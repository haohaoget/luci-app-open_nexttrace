-- Model the documented nixio contracts, including waitpid(false) for a live
-- child, to exercise the real supervisor without spawning router processes.
local f = assert(io.open("luci-app-open_nexttrace/root/usr/libexec/rpcd/open_nexttrace", "r"))
local source = f:read("*a"); f:close()
source = source:gsub("^#![^\n]+\n", "")
local boundary = assert(source:find('\nif arg[1] == "list" then', 1, true))
source = source:sub(1, boundary - 1) .. "\nreturn {methods=methods, supervise=supervise, identity=identity, locked=locked, setup=setup}"
local assertions = 0
local function check(value, message) assertions = assertions + 1; assert(value, message) end
local function clone(value)
    if type(value) ~= "table" then return value end
    local result = {}; for k, v in pairs(value) do result[k] = clone(v) end; return result
end
local function fixture()
    local files, jsons, signals, waits = {}, {}, {}, {}
    local base = "/tmp/open-nexttrace/"
    local model = { now = 0, sleep_step = 1, files = files, signals = signals, waits = waits, locks = 0 }
    local function stat(pid, start, state)
        return pid .. " (lua worker) " .. (state or "S") .. string.rep(" 0", 18) .. " " .. (start or "123")
    end
    files["/proc/42/stat"] = stat(42)
    files["/dev/urandom"] = string.rep("a", 16)
    local json = {
        stringify = function(value) jsons[#jsons + 1] = clone(value); return tostring(#jsons) end,
        parse = function(value) return clone(jsons[tonumber(value)]) end
    }
    local function put_state(value) files[base .. "state.json"] = json.stringify(value) end
    model.put_state = put_state
    model.state = function() return json.parse(files[base .. "state.json"]) end
    model.procstat = stat
    put_state({id = "job", status = "running", pid = 42, identity = "123"})
    local fakeio = {
        open = function(path, mode)
            if mode == "rb" and not files[path] then return nil end
            if mode == "wb" then files[path] = "" end
            return {
                read = function(_, size) return (files[path] or ""):sub(1, size) end,
                write = function(_, value) files[path] = value; return true end,
                close = function() return true end
            }
        end,
        popen = function(command)
            check(command == "/usr/libexec/open-nexttrace/nexttrace --help 2>/dev/null", "help command must be constant")
            return { read = function() return model.help or "--raw --map --dev" end, close = function() end }
        end
    }
    local fs = {
        lstat = function() return {type = "dir", uid = 0} end, chmod = function() return true end,
        access = function() return model.available ~= false end,
        rename = function(a, b) files[b], files[a] = files[a], nil; return true end,
        stat = function(path, key)
            if path == "/usr/libexec/open-nexttrace/nexttrace" then return 1234 end
            return #(files[path] or "")
        end
    }
    local nixio = {
        const = {SIGCHLD = 17}, umask = function() end,
        open = function(path, mode)
            if path:match("/stdout$") or path:match("/stderr$") then files[path] = "" end
            return {
                lock = function() model.locks = model.locks + 1; return not model.busy end,
                close = function() return true end
            }
        end,
        fork = function() return model.fork_pid or 42 end,
        sysinfo = function() return {uptime = model.now} end,
        waitpid = function(pid, flags)
            model.waited_pid = pid
            local next_wait = table.remove(waits, 1)
            if next_wait then return unpack(next_wait) end
            if flags == "nohang" then return false end
            return pid, "signaled", 9
        end,
        nanosleep = function() model.now = model.now + model.sleep_step end,
        kill = function(pid, signal) signals[#signals + 1] = {pid, signal} end
    }
    local policy = dofile("luci-app-open_nexttrace/root/usr/lib/lua/open_nexttrace/policy.lua")
    local modules = {nixio = nixio, ["nixio.fs"] = fs, ["luci.jsonc"] = json,
        ["open_nexttrace.policy"] = policy,
        ubus = {connect = function() return {call = function() return {interface = {}} end, close = function() end} end}}
    local env = setmetatable({io = fakeio, os = {time = function() return 1000 end, exit = function() end},
        require = function(name) return assert(modules[name], name) end}, {__index = _G})
    local chunk = assert(loadstring(source, "backend")); setfenv(chunk, env)
    return chunk(), model
end

do
    local b, m = fixture()
    m.waits[1], m.waits[2] = {false}, {42, "exited", 0}
    b.supervise("job", {"--raw", "example.com"})
    check(m.now == 1, "false waitpid result is a live process, not failure")
    check(m.state().status == "done", "normal completion")
    check(#m.signals == 0, "completed child is not signaled")
end
do
    local b, m = fixture()
    m.files["/tmp/open-nexttrace/cancel"] = "job"
    b.supervise("job", {})
    check(m.state().status == "stopped", "cancel completes")
    check(#m.signals == 2 and m.signals[1][2] == 15 and m.signals[2][2] == 9, "TERM then KILL unresponsive child")
    check(m.signals[1][1] == 42 and m.waited_pid == 42, "signal and reap only owned child")
end
do
    local b, m = fixture()
    m.sleep_step = 181
    b.supervise("job", {})
    check(m.state().status == "error" and m.state().error:find("180"), "deadline is enforced with monotonic uptime")
end
do
    local b, m = fixture()
    m.waits[1] = {42, "exited", 1}
    b.supervise("job", {})
    check(m.state().status == "error" and m.state().exit_code == 1, "core failure is visible")
end
do
    local b, m = fixture()
    check(b.methods.start({target = "example.com"}).error ~= nil, "reject simultaneous trace")
    check(b.methods.stop({id = "old"}).error ~= nil, "stale stop cannot cancel new job")
    check(not m.files["/tmp/open-nexttrace/cancel"], "stale stop writes nothing")
    check(b.methods.status({id = "old"}).status == "replaced", "stale status is distinguished")
    m.files["/proc/42/stat"] = m.procstat(42, "456")
    check(b.methods.status({}).status == "error", "PID reuse detected")
end
do
    local b, m = fixture()
    m.files["/proc/42/stat"] = m.procstat(42, "123", "Z")
    check(b.identity(42) == nil, "zombie does not keep task running")
    m.busy = true
    local called = false
    local response = b.locked(function() called = true end)
    check(response.error and not called, "mutations serialized by lock")
end
for _, modern in ipairs({false, true}) do
    local b, m = fixture()
    m.put_state({status = "idle"})
    m.help = modern and "--raw --traceroute" or "--raw"
    local result = b.locked(function(lock) return b.methods.start({target = "example.com", ubus_rpc_session = "secret"}, lock) end)
    check(result.status == "running" and result.id == string.rep("61", 16), "start creates random task id")
    check(m.state().identity == "123", "start records PID identity")
    check(m.state().options.ubus_rpc_session == nil, "session tokens must never be persisted or exposed")
end
do
    local b, m = fixture()
    m.put_state({id = "job", status = "done"})
    m.files["/tmp/open-nexttrace/stdout"] = "source device has no suitable address\n"
    local response = b.methods.status({})
    check(response.status == "error", "zero-exit setup failure must not look successful")
    check(response.diagnostics:find("source device", 1, true), "stdout errors exposed in diagnostic log")
end
print("backend: " .. assertions .. " assertions passed")
