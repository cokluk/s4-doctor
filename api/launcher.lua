local RESOURCE = GetCurrentResourceName()
local IS_WINDOWS = GetResourcePath(RESOURCE):find('\\', 1, true) ~= nil

local API_PORT = tonumber(GetConvar('s4_doctor_port', '4789')) or 4789
local weStartedApi = false

local function resourceRoot()
    return GetResourcePath(RESOURCE):gsub('\\', '/')
end

local function joinPath(...)
    local sep = IS_WINDOWS and '\\' or '/'
    return table.concat({ ... }, sep)
end

local function fileExists(path)
    local f = io.open(path, 'rb')
    if not f then
        return false
    end
    f:close()
    return true
end

local function hasExpress()
    local root = resourceRoot()
    local candidates = {
        joinPath(root, 'node_modules', 'express', 'package.json'),
        joinPath(root, 'api', 'node_modules', 'express', 'package.json'),
    }

    for i = 1, #candidates do
        if fileExists(candidates[i]) then
            return true
        end
    end

    return false
end

local function waitForDependencies(timeoutMs)
    local deadline = GetGameTimer() + timeoutMs

    while GetGameTimer() < deadline do
        if hasExpress() then
            return true
        end
        Wait(500)
    end

    return false
end

local function healthUrl()
    return ('http://127.0.0.1:%d/health'):format(API_PORT)
end

local function probeHealth()
    local healthy = false
    local responded = false

    PerformHttpRequest(healthUrl(), function(status)
        healthy = status == 200
        responded = true
    end, 'GET', '', { ['Content-Type'] = 'application/json' })

    while not responded do
        Wait(0)
    end

    return healthy
end

local function waitForHealth(timeoutMs)
    local deadline = GetGameTimer() + timeoutMs

    while GetGameTimer() < deadline do
        if probeHealth() then
            return true
        end
        Wait(500)
    end

    return false
end

local function resolveNodeBinary()
    local handle = io.popen('node -v 2>&1')
    if handle then
        local out = handle:read('*a') or ''
        handle:close()
        if out:match('^v%d') then
            return 'node'
        end
    end

    return 'node'
end

local function spawnApiProcess()
    local root = resourceRoot()
    local serverJs = joinPath(root, 'api', 'server.js')
    local nodeBin = resolveNodeBinary()

    local logPath = joinPath(root, 'api_debug.log')
    
    if IS_WINDOWS then
        local cmd = ('cmd /c "set S4_DOCTOR_PORT=%d && start /B "" "%s" "%s" > "%s" 2>&1"'):format(API_PORT, nodeBin, serverJs, logPath)
        os.execute(cmd)
        return
    end

    os.execute(('S4_DOCTOR_PORT=%d nohup %s "%s" > "%s" 2>&1 &'):format(API_PORT, nodeBin, serverJs, logPath))
end

local function pidFilePath()
    return joinPath(resourceRoot(), 'api', '.api.pid')
end

local function readPidFile()
    local f = io.open(pidFilePath(), 'r')
    if not f then
        return nil
    end

    local pid = tonumber(f:read('*a'))
    f:close()
    return pid
end

local function killApiProcess()
    if not weStartedApi then
        return
    end

    local pid = readPidFile()
    if pid then
        if IS_WINDOWS then
            os.execute(('taskkill /F /PID %d > nul 2>&1'):format(pid))
        else
            os.execute(('kill %d 2>/dev/null'):format(pid))
        end
    end

    os.remove(pidFilePath())
    weStartedApi = false
end

CreateThread(function()
    print('^3[s4-doctor]^0 Waiting for yarn dependencies (ensure ^2yarn^0 resource is running)...')

    if not waitForDependencies(120000) then
        print('^1[s4-doctor]^0 express not found — start ^2ensure yarn^0 before ^2ensure s4-doctor^0')
        return
    end

    if probeHealth() then
        print('^2[s4-doctor]^0 Node API already running on port ' .. API_PORT .. ' (using existing instance)')
        return
    end

    print('^3[s4-doctor]^0 Starting Node API on port ' .. API_PORT .. '...')
    spawnApiProcess()
    weStartedApi = true

    if waitForHealth(20000) then
        print('^2[s4-doctor]^0 Node API ready at http://127.0.0.1:' .. API_PORT)
        return
    end

    print('^1[s4-doctor]^0 Node API did not respond — check that Node.js is available to FXServer')
    weStartedApi = false
end)

AddEventHandler('onResourceStop', function(res)
    if res ~= RESOURCE then
        return
    end
    killApiProcess()
end)
