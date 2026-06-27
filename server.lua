local RESOURCE = GetCurrentResourceName()
local Doctors = { server = {}, client = {} }
local Pending = {}
local logPushQueue = {}
local LogBuffer = {
    server = {},
    client = {},
    seq = 0,
}
local function randomHex(len)
    local t = {}
    for _ = 1, len do
        t[#t + 1] = string.format('%x', math.random(0, 15))
    end
    return table.concat(t)
end
local function debugLog(msg, ...)
    if Config.Debug then
        print(('[s4-doctor] ' .. msg):format(...))
    end
end
local function isTargetAllowed(name)
    if not Config.AllowedTargets or #Config.AllowedTargets == 0 then return true end
    for _, v in ipairs(Config.AllowedTargets) do
        if v == name then return true end
    end
    return false
end
local function classifyLevel(msg)
    if type(msg) ~= 'string' then return 'info' end
    local lower = msg:lower()
    if lower:find('^1') or lower:find('error') or lower:find('failed') or lower:find('exception') then
        return 'error'
    end
    if lower:find('^3') or lower:find('warn') or lower:find('warning') then
        return 'warning'
    end
    return 'info'
end
local function stripColorCodes(msg)
    if type(msg) ~= 'string' then return tostring(msg) end
    return msg:gsub('%^%d', ''):gsub('~%a~', '')
end
local function getPlayerNameSafe(src)
    if not src or src == 0 then return nil end
    return GetPlayerName(src) or ('player:' .. tostring(src))
end
local function normalizeEntry(entry)
    entry.source = entry.source or 'server'
    entry.side = entry.side or entry.source
    entry.level = entry.level or 'info'
    entry.message = stripColorCodes(entry.message or '')
    entry.timestamp = entry.timestamp or (os.time() * 1000)
    return entry
end
local function broadcastNuiLog(entry)
    if not Config.NuiEnabled then return end
    TriggerClientEvent('s4-doctor:hub:nuiLog', -1, entry)
end
local function queueLogPush(entry)
    logPushQueue[#logPushQueue + 1] = entry
end
local function pushLog(entry)
    LogBuffer.seq = LogBuffer.seq + 1
    entry = normalizeEntry(entry)
    entry.id = LogBuffer.seq
    entry.seq = LogBuffer.seq
    local buf = entry.source == 'client' and LogBuffer.client or LogBuffer.server
    buf[#buf + 1] = entry
    local maxSize = Config.LogBufferSize
    while #buf > maxSize do
        table.remove(buf, 1)
    end
    queueLogPush(entry)
    broadcastNuiLog(entry)
end
local function matchesLogFilters(entry, opts)
    local since = tonumber(opts.since) or 0
    if entry.timestamp < since then return false end
    if opts.sinceSeq then
        local sinceSeq = tonumber(opts.sinceSeq) or 0
        if (entry.seq or entry.id or 0) <= sinceSeq then return false end
    end
    if opts.level and opts.level ~= '' and entry.level ~= opts.level then
        return false
    end
    local playerId = opts.playerId and tonumber(opts.playerId) or nil
    if playerId and entry.playerId ~= playerId then return false end
    return true
end
local function filterLogs(buf, opts)
    local out = {}
    for _, entry in ipairs(buf) do
        if matchesLogFilters(entry, opts) then
            out[#out + 1] = entry
        end
    end
    table.sort(out, function(a, b) return (a.seq or a.id) < (b.seq or b.id) end)
    local limit = math.min(tonumber(opts.limit) or 100, 500)
    if #out > limit then
        local trimmed = {}
        local start = #out - limit + 1
        for i = start, #out do
            trimmed[#trimmed + 1] = out[i]
        end
        out = trimmed
    end
    return out
end
local function getLogs(opts)
    opts = opts or {}
    local source = opts.source or 'all'
    local combined = {}
    if source == 'server' or source == 'all' then
        for _, entry in ipairs(filterLogs(LogBuffer.server, opts)) do
            combined[#combined + 1] = entry
        end
    end
    if source == 'client' or source == 'all' then
        for _, entry in ipairs(filterLogs(LogBuffer.client, opts)) do
            combined[#combined + 1] = entry
        end
    end
    table.sort(combined, function(a, b) return (a.seq or a.id) < (b.seq or b.id) end)
    return combined
end
local function buildLogsResponse(opts)
    opts = opts or {}
    local source = opts.source or 'all'
    local response = {
        success = true,
        meta = {
            bufferSize = Config.LogBufferSize,
            latestSeq = LogBuffer.seq,
        },
    }
    if source == 'all' then
        response.server = {
            count = 0,
            logs = filterLogs(LogBuffer.server, opts),
        }
        response.client = {
            count = 0,
            logs = filterLogs(LogBuffer.client, opts),
        }
        response.server.count = #response.server.logs
        response.client.count = #response.client.logs
    elseif source == 'server' then
        local logs = filterLogs(LogBuffer.server, opts)
        response.server = { count = #logs, logs = logs }
    elseif source == 'client' then
        local logs = filterLogs(LogBuffer.client, opts)
        response.client = { count = #logs, logs = logs }
    end
    return response
end
local function clearLogs(source)
    if source == 'server' or source == 'all' then LogBuffer.server = {} end
    if source == 'client' or source == 'all' then LogBuffer.client = {} end
end
local _print = print
local _trace = Citizen and Citizen.Trace or nil
local function captureServerLog(message, meta)
    if type(message) ~= 'string' or message == '' then return end
    pushLog({
        source = 'server',
        side = 'server',
        level = classifyLevel(message),
        message = message,
        resource = meta and meta.resource or RESOURCE,
        channel = meta and meta.channel or nil,
    })
end
if RegisterConsoleListener then
    RegisterConsoleListener(function(channel, message)
        local resName = channel and channel:match('script:(.+)') or nil
        captureServerLog(message, { resource = resName, channel = channel })
    end)
else
    print = function(...)
        local parts = {}
        for i = 1, select('#', ...) do
            parts[i] = tostring(select(i, ...))
        end
        captureServerLog(table.concat(parts, '\t'))
        _print(...)
    end
    if _trace then
        Citizen.Trace = function(msg)
            captureServerLog(msg)
            _trace(msg)
        end
    end
end
RegisterNetEvent('s4-doctor:hub:clientLog', function(entries)
    local src = source
    if type(entries) ~= 'table' then return end
    local playerName = getPlayerNameSafe(src)
    for _, entry in ipairs(entries) do
        if type(entry) == 'table' and type(entry.message) == 'string' then
            pushLog({
                source = 'client',
                side = 'client',
                playerId = src,
                playerName = playerName,
                level = entry.level or classifyLevel(entry.message),
                message = entry.message,
                resource = entry.resource,
                channel = entry.channel,
            })
        end
    end
end)
RegisterNetEvent('s4-doctor:hub:requestNuiSnapshot', function()
    local src = source
    local limit = Config.NuiSnapshotLimit or 200
    local logs = getLogs({ source = 'all', limit = limit, since = 0 })
    TriggerClientEvent('s4-doctor:hub:nuiSnapshot', src, { logs = logs })
end)
local function listDoctorsPayload()
    local list = { server = {}, client = {} }
    for name, info in pairs(Doctors.server) do
        list.server[#list.server + 1] = { resource = name, framework = info.framework, registeredAt = info.at }
    end
    for name, info in pairs(Doctors.client) do
        local entry = { resource = name, framework = info.framework, registeredAt = info.at, players = {} }
        if info.players then
            for pid, at in pairs(info.players) do
                local n = tonumber(pid)
                if n and PlayerResolver.isOnline(n) then
                    entry.players[#entry.players + 1] = { playerId = n, registeredAt = at }
                end
            end
        end
        list.client[#list.client + 1] = entry
    end
    table.sort(list.server, function(a, b) return a.resource < b.resource end)
    table.sort(list.client, function(a, b) return a.resource < b.resource end)
    return list
end
local function syncDoctorsToBridge()
    bridgeRequest('POST', '/internal/doctors', { doctors = listDoctorsPayload() })
end
local function syncPlayersToBridge()
    if not PlayerResolver or not PlayerResolver.getOnlineList then return end
    bridgeRequest('POST', '/internal/players', { players = PlayerResolver.getOnlineList() })
end
RegisterNetEvent('s4-doctor:doctor:registerServer', function(res, frameworkType)
    if type(res) ~= 'string' then return end
    Doctors.server[res] = { framework = frameworkType or 'standalone', at = os.time() }
    debugLog('server doctor registered: %s', res)
    syncDoctorsToBridge()
end)
RegisterNetEvent('s4-doctor:doctor:registerClient', function(res, frameworkType)
    local src = source
    if type(res) ~= 'string' then return end
    Doctors.client[res] = Doctors.client[res] or { framework = frameworkType or 'standalone', at = os.time(), players = {} }
    Doctors.client[res].framework = frameworkType or Doctors.client[res].framework
    Doctors.client[res].players[src] = os.time()
    Doctors.client[res].at = os.time()
    debugLog('client doctor registered: %s (player %s)', res, src)
    syncDoctorsToBridge()
end)
AddEventHandler('playerDropped', function()
    local src = source
    for _, info in pairs(Doctors.client) do
        if info.players then info.players[src] = nil end
    end
    syncDoctorsToBridge()
end)
AddEventHandler('onResourceStop', function(res)
    Doctors.server[res] = nil
    Doctors.client[res] = nil
    syncDoctorsToBridge()
end)
RegisterNetEvent('s4-doctor:hub:clientResult', function(requestId, result)
    local p = Pending[requestId]
    if not p then return end
    p.clientResult = result
    p.clientDone = true
end)
AddEventHandler('s4-doctor:hub:result', function(requestId, result)
    local p = Pending[requestId]
    if not p then return end
    p.result = result
    p.done = true
end)
local function validateBridgeCommand(cmd, requireFull)
    if type(cmd) ~= 'table' then
        return false, 'body must be a JSON object'
    end
    if cmd.type == 'console' then
        if type(cmd.command) ~= 'string' or cmd.command == '' then
            return false, 'empty command'
        end
        return true
    end
    if requireFull then
        if not cmd.targetResource or type(cmd.targetResource) ~= 'string' then
            return false, 'missing targetResource'
        end
        if not isTargetAllowed(cmd.targetResource) then
            return false, 'targetResource not allowed'
        end
        local validTypes = {
            localFunction = true, export = true, event = true,
            frameworkCallback = true, command = true, resource = true,
        }
        if not validTypes[cmd.executionType] then
            return false, 'invalid executionType'
        end
        if not cmd.targetName or type(cmd.targetName) ~= 'string' then
            return false, 'missing targetName'
        end
    end
    return true
end
local function enrichCommand(cmd)
    return {
        requestId = cmd.requestId or ('req_' .. randomHex(16)),
        targetResource = cmd.targetResource,
        executionType = cmd.executionType,
        frameworkType = cmd.frameworkType,
        targetName = cmd.targetName,
        arguments = cmd.arguments or {},
        exportResource = cmd.exportResource,
        eventSide = cmd.eventSide,
        callbackSide = cmd.callbackSide or 'server',
        side = cmd.side or 'server',
        playerId = cmd.playerId,
    }
end
local function unpackArgs(args)
    if type(args) ~= 'table' then return end
    return table.unpack(args)
end
local function makeResult(ok, data, err, extra)
    local r = {
        success = ok,
        data = data,
        error = err,
        via = 'hub',
    }
    if extra then
        for k, v in pairs(extra) do r[k] = v end
    end
    return r
end
local function hubExecuteExport(payload)
    local res = payload.exportResource or payload.targetResource
    if GetResourceState(res) ~= 'started' then
        return makeResult(false, nil, ('export resource not started: %s'):format(res))
    end
    local okFn, fn = pcall(function()
        return exports[res][payload.targetName]
    end)
    if not okFn or type(fn) ~= 'function' then
        return makeResult(false, nil, ('export not found: %s:%s'):format(res, payload.targetName))
    end
    local ok, result = pcall(fn, unpackArgs(payload.arguments))
    if not ok then return makeResult(false, nil, tostring(result)) end
    return makeResult(true, result)
end
local function hubExecuteEvent(payload)
    local side = payload.eventSide or payload.side or 'server'
    local args = payload.arguments or {}
    if side == 'server' then
        TriggerEvent(payload.targetName, unpackArgs(args))
        return makeResult(true, { triggered = true, event = payload.targetName, side = 'server' })
    end
    if side == 'client' then
        local pid = payload.playerId
        if not pid then
            pid = select(1, PlayerResolver.resolve(payload, Doctors.client))
        end
        pid = tonumber(pid)
        if not pid or not PlayerResolver.isOnline(pid) then
            return makeResult(false, nil, 'no players online for client event')
        end
        payload.playerId = pid
        TriggerClientEvent(payload.targetName, pid, unpackArgs(args))
        return makeResult(true, { triggered = true, event = payload.targetName, side = 'client', playerId = pid })
    end
    return makeResult(false, nil, 'invalid event side')
end
local function hubExecuteFrameworkCallback(payload)
    local fw = payload.frameworkType or 'standalone'
    local side = payload.callbackSide or 'server'
    local name = payload.targetName
    local args = payload.arguments or {}
    if fw == 'ox' and GetResourceState('ox_lib') == 'started' then
        local src = args._source or payload.playerId or 0
        local ok, result = pcall(function()
            if lib and lib.callback and lib.callback.await then
                return lib.callback.await(name, src, unpackArgs(args))
            end
            error('ox_lib lib.callback not available')
        end)
        if ok then return makeResult(true, result) end
        return makeResult(false, nil, tostring(result))
    end
    if (fw == 'qbcore' or fw == 'qbx') and GetResourceState('qb-core') == 'started' then
        if side == 'server' then
            TriggerEvent('QBCore:Server:TriggerCallback', name, args._source or 0, args)
            return makeResult(true, { triggered = true, callback = name, framework = fw })
        end
    end
    if fw == 'esx' and GetResourceState('es_extended') == 'started' then
        if side == 'server' then
            TriggerEvent('esx:triggerServerCallback', name, args._source or 0, args)
            return makeResult(true, { triggered = true, callback = name, framework = 'esx' })
        end
    end
    if side == 'client' then
        return nil, 'delegate_client'
    end
    return makeResult(false, nil, ('framework callback not supported via hub: %s/%s'):format(fw, side))
end
local function hubExecuteResource(payload)
    local action = payload.targetName
    local resourceName = payload.targetResource
    local ok, cmdOrErr = ResourceManager.runAction(action, resourceName)
    if not ok then
        return makeResult(false, nil, cmdOrErr)
    end
    pushLog({
        source = 'server',
        side = 'server',
        level = 'info',
        message = '[s4-doctor] resource: ' .. cmdOrErr,
    })
    return makeResult(true, {
        action = action,
        resource = resourceName,
        executed = cmdOrErr,
    })
end
local function hubExecuteCommand(payload)
    local cmdStr = payload.targetName
    if payload.arguments and #payload.arguments > 0 then
        local parts = { cmdStr }
        for _, v in ipairs(payload.arguments) do
            parts[#parts + 1] = tostring(v)
        end
        cmdStr = table.concat(parts, ' ')
    end
    local valid, reason = ResourceManager.validateConsoleCommand(cmdStr)
    if not valid then
        return makeResult(false, nil, reason)
    end
    ExecuteCommand(cmdStr)
    return makeResult(true, { executed = cmdStr })
end
local function hubExecuteDirect(payload)
    local t = payload.executionType
    if t == 'export' then return hubExecuteExport(payload) end
    if t == 'event' then return hubExecuteEvent(payload) end
    if t == 'frameworkCallback' then
        local result, delegate = hubExecuteFrameworkCallback(payload)
        if delegate == 'delegate_client' then return nil, delegate end
        return result
    end
    if t == 'command' then return hubExecuteCommand(payload) end
    if t == 'resource' then return hubExecuteResource(payload) end
    return makeResult(false, nil, ('hub cannot execute directly: %s'):format(t))
end
local function waitForResult(requestId, timeout)
    local deadline = GetGameTimer() + timeout
    while GetGameTimer() < deadline do
        local p = Pending[requestId]
        if p and p.done then return p.result, nil end
        Wait(50)
    end
    return nil, 'timeout'
end
local function waitForClientResult(requestId, timeout)
    local deadline = GetGameTimer() + timeout
    while GetGameTimer() < deadline do
        local p = Pending[requestId]
        if p and p.clientDone then return p.clientResult, nil end
        Wait(50)
    end
    return nil, 'timeout'
end
local function resetPendingClient(requestId)
    Pending[requestId] = { done = false, clientDone = false }
end
local function triggerClientExecute(eventName, payload)
    local players = GetPlayers()
    if #players == 0 then
        return nil, 'no players online — join the server to run client-side tests'
    end
    local tryIds = {}
    local seen = {}
    local function add(id)
        id = tonumber(id)
        if id and not seen[id] and PlayerResolver.isOnline(id) then
            seen[id] = true
            tryIds[#tryIds + 1] = id
        end
    end
    add(payload.playerId)
    local res = payload.targetResource
    local doc = res and Doctors.client[res]
    if doc and doc.players then
        for pid, _ in pairs(doc.players) do add(pid) end
    end
    for _, id in ipairs(players) do add(id) end
    local lastErr = 'timeout'
    local resolvedNote
    for _, pid in ipairs(tryIds) do
        resetPendingClient(payload.requestId)
        payload.playerId = pid
        TriggerClientEvent(eventName, pid, payload)
        local result, waitErr = waitForClientResult(payload.requestId, Config.RequestTimeout)
        if not waitErr then
            if pid ~= (payload.playerId or pid) then
                resolvedNote = ('auto-selected player %d'):format(pid)
            end
            if resolvedNote and type(result) == 'table' then
                result.resolvedPlayerNote = resolvedNote
            end
            result = result or {}
            if type(result) == 'table' then result.playerId = pid end
            return result, nil, pid
        end
        lastErr = waitErr
    end
    return nil, lastErr .. (' (tried %d player(s): %s)'):format(#tryIds, table.concat(tryIds, ', '))
end
local function applyClientPlayer(payload)
    local pid, note, err = PlayerResolver.resolve(payload, Doctors.client)
    if not pid then
        return nil, err or 'no players online'
    end
    payload.playerId = pid
    return pid, note
end
local function collectRecentClientErrors(sinceSeq, playerId)
    local opts = { source = 'client', sinceSeq = sinceSeq or 0, limit = 50 }
    if playerId then opts.playerId = playerId end
    local errors = {}
    for _, entry in ipairs(filterLogs(LogBuffer.client, opts)) do
        if entry.level == 'error' then
            errors[#errors + 1] = entry
        end
    end
    return errors
end
local function executeViaDoctor(payload)
    local res = payload.targetResource
    local side = payload.side
    if side == 'server' then
        TriggerEvent('s4-doctor:doctor:executeServer', payload)
        return waitForResult(payload.requestId, Config.RequestTimeout)
    end
    local note
    local pid, resolveNote = applyClientPlayer(payload)
    if not pid then return nil, resolveNote end
    note = resolveNote
    local result, waitErr = triggerClientExecute('s4-doctor:doctor:executeClient', payload)
    if note and type(result) == 'table' then result.resolvedPlayerNote = note end
    return result, waitErr
end
local function executeViaClientHub(payload)
    local note
    local pid, resolveNote = applyClientPlayer(payload)
    if not pid then return nil, resolveNote end
    note = resolveNote
    local result, waitErr = triggerClientExecute('s4-doctor:hub:executeDirect', payload)
    if note and type(result) == 'table' then result.resolvedPlayerNote = note end
    return result, waitErr
end
local function executeCommand(cmd)
    local ok, err = validateBridgeCommand(cmd, true)
    if not ok then return { success = false, error = err } end
    if cmd.type == 'console' then
        return runConsoleCommand(cmd.command, cmd.requestId)
    end
    local payload = enrichCommand(cmd)
    local res = payload.targetResource
    local side = payload.side
    local execType = payload.executionType
    local sinceSeq = LogBuffer.seq
    if execType == 'resource' then
        local result = hubExecuteResource(payload)
        if type(result) == 'table' and result.success == false then
            return {
                success = false,
                error = result.error or 'resource action failed',
                requestId = payload.requestId,
                result = result,
            }
        end
        return { success = true, requestId = payload.requestId, result = result }
    end
    Pending[payload.requestId] = { done = false, clientDone = false }
    local result, waitErr
    if execType == 'localFunction' then
        if side == 'server' and Doctors.server[res] then
            result, waitErr = executeViaDoctor(payload)
            local shouldFallback = type(result) == 'table' and result.success == false
                and type(result.error) == 'string'
                and (result.error:find('local function not found') or result.error:find('use Doctor%.expose'))
            if shouldFallback and #GetPlayers() > 0 then
                payload.side = 'client'
                local pid, _, err = PlayerResolver.resolve(payload, Doctors.client)
                if pid then
                    payload.playerId = pid
                    resetPendingClient(payload.requestId)
                    result, waitErr = executeViaDoctor(payload)
                else
                    waitErr = err
                end
            end
        else
            if side == 'client' or #GetPlayers() > 0 then
                payload.side = 'client'
                local pid, _, err = PlayerResolver.resolve(payload, Doctors.client)
                if not pid then
                    Pending[payload.requestId] = nil
                    return { success = false, error = err or 'no players online', requestId = payload.requestId }
                end
                payload.playerId = pid
            elseif side == 'server' and not Doctors.server[res] then
                Pending[payload.requestId] = nil
                return {
                    success = false,
                    error = ('localFunction requires doctor.lua in %s (shared_script \'@s4-doctor/doctor.lua\')'):format(res),
                    requestId = payload.requestId,
                }
            end
            result, waitErr = executeViaDoctor(payload)
        end
    elseif side == 'client' then
        payload.side = 'client'
        local pid, _, err = PlayerResolver.resolve(payload, Doctors.client)
        if not pid then
            Pending[payload.requestId] = nil
            return { success = false, error = err or 'no players online', requestId = payload.requestId }
        end
        payload.playerId = pid
        if execType == 'localFunction' then
            result, waitErr = executeViaDoctor(payload)
        else
            result = hubExecuteDirect(payload)
            if result == nil then
                result, waitErr = executeViaClientHub(payload)
            end
        end
    elseif side == 'server' then
        result = hubExecuteDirect(payload)
        if result == nil then
            if Doctors.server[res] then
                result, waitErr = executeViaDoctor(payload)
            else
                result, waitErr = executeViaClientHub(payload)
            end
        end
    else
        if Doctors.client[res] then
            result, waitErr = executeViaDoctor(payload)
        else
            result, waitErr = executeViaClientHub(payload)
        end
    end
    Pending[payload.requestId] = nil
    if waitErr then
        local response = {
            success = false,
            error = waitErr,
            requestId = payload.requestId,
            playerId = payload.playerId,
            clientErrors = collectRecentClientErrors(sinceSeq, payload.playerId),
        }
        return response
    end
    if type(result) == 'table' and result.success == false then
        return {
            success = false,
            error = result.error or 'execution failed',
            requestId = payload.requestId,
            result = result,
            playerId = payload.playerId,
            clientErrors = collectRecentClientErrors(sinceSeq, payload.playerId),
        }
    end
    return {
        success = true,
        requestId = payload.requestId,
        result = result,
        playerId = payload.playerId,
        clientLogs = filterLogs(LogBuffer.client, { sinceSeq = sinceSeq, playerId = payload.playerId, limit = 20 }),
        clientErrors = collectRecentClientErrors(sinceSeq, payload.playerId),
    }
end
function runConsoleCommand(cmdStr, requestId)
    if type(cmdStr) ~= 'string' or cmdStr == '' then
        return { success = false, error = 'empty command' }
    end
    local valid, reason = ResourceManager.validateConsoleCommand(cmdStr)
    if not valid then
        return { success = false, error = reason, requestId = requestId }
    end
    ExecuteCommand(cmdStr)
    pushLog({ source = 'server', side = 'server', level = 'info', message = '[s4-doctor] console: ' .. cmdStr })
    return { success = true, executed = cmdStr, requestId = requestId }
end
exports('GetDiagnostics', function()
    return {
        players = PlayerResolver.getOnlineList(),
        doctors = listDoctorsPayload(),
        clientLogCount = #LogBuffer.client,
        serverLogCount = #LogBuffer.server,
    }
end)
exports('Execute', function(cmd)
    if type(cmd) == 'string' then cmd = json.decode(cmd) end
    return executeCommand(cmd or {})
end)
exports('GetLogs', function(opts)
    if type(opts) == 'string' then opts = json.decode(opts) end
    opts = opts or {}
    if opts.format == 'response' then
        return buildLogsResponse(opts)
    end
    return getLogs(opts)
end)
exports('ClearLogs', function(source)
    clearLogs(source or 'all')
    return true
end)
exports('ListDoctors', function()
    return listDoctorsPayload()
end)
function bridgeRequest(method, path, body, cb)
    local url = Config.BridgeUrl .. path
    local payload = body and json.encode(body) or ''
    PerformHttpRequest(url, function(status, responseBody)
        if cb then cb(status, responseBody) end
    end, method, payload, { ['Content-Type'] = 'application/json' })
end
local function flushLogPush()
    if #logPushQueue == 0 then return end
    local batch = logPushQueue
    logPushQueue = {}
    bridgeRequest('POST', '/internal/logs', { logs = batch })
end
local function handlePendingCommand(cmd)
    if type(cmd) ~= 'table' then return end
    CreateThread(function()
        local requestId = cmd.requestId
        local result
        if cmd.type == 'console' then
            result = runConsoleCommand(cmd.command, requestId)
        else
            result = executeCommand(cmd)
        end
        bridgeRequest('POST', '/internal/result', {
            requestId = requestId,
            result = result,
        })
    end)
end
local function pollPending()
    bridgeRequest('GET', '/internal/pending', nil, function(status, body)
        if status ~= 200 or not body or body == '' then return end
        local ok, data = pcall(json.decode, body)
        if not ok or type(data) ~= 'table' or type(data.pending) ~= 'table' then return end
        for _, cmd in ipairs(data.pending) do
            handlePendingCommand(cmd)
        end
    end)
end
local function registerWithBridge()
    bridgeRequest('POST', '/internal/register', {
        resource = RESOURCE,
        version = '2.1.0',
        doctors = listDoctorsPayload(),
    })
end
CreateThread(function()
    for _ = 1, 60 do
        local ready = false
        local responded = false
        PerformHttpRequest(Config.BridgeUrl .. '/health', function(status)
            ready = status == 200
            responded = true
        end, 'GET')
        while not responded do Wait(0) end
        if ready then break end
        Wait(1000)
    end
    registerWithBridge()
    print('^2[s4-doctor]^0 Node bridge: ' .. Config.BridgeUrl)
    while true do
        Wait(Config.BridgePollMs)
        pollPending()
        flushLogPush()
        syncPlayersToBridge()
    end
end)
RegisterCommand('s4doctor', function(source, args)
    local sub = args[1]
    if sub == 'ui' then
        if source == 0 then
            print('[s4-doctor] NUI panel opens on the player client only. In-game use /s4doctorui.')
        else
            TriggerClientEvent('s4-doctor:hub:toggleUi', source)
        end
        return
    end
    if source ~= 0 then return end
    if sub == 'logs' then
        local src = args[2] or 'all'
        local limit = tonumber(args[3]) or 20
        local logs = getLogs({ source = src, limit = limit, since = 0 })
        print(json.encode(logs, { indent = true }))
        return
    end
    if sub == 'clear' then
        clearLogs(args[2] or 'all')
        print('[s4-doctor] logs cleared: ' .. (args[2] or 'all'))
        return
    end
    if sub == 'doctors' or sub == 'list' then
        print(json.encode(exports[RESOURCE]:ListDoctors(), { indent = true }))
        return
    end
    if sub == 'exec' then
        local raw = table.concat(args, ' ', 2)
        local cmd = json.decode(raw)
        if not cmd then
            print('[s4-doctor] JSON parse error')
            return
        end
        print(json.encode(executeCommand(cmd), { indent = true }))
        return
    end
    if sub == 'bridge' then
        print('[s4-doctor] Bridge URL: ' .. Config.BridgeUrl)
        registerWithBridge()
        return
    end
    print('[s4-doctor] Usage:')
    print('  s4doctor ui                                   — NUI info (in-game: /s4doctorui)')
    print('  s4doctor logs [server|client|all] [limit]')
    print('  s4doctor clear [server|client|all]')
    print('  s4doctor doctors')
    print('  s4doctor exec <json>')
    print('  s4doctor bridge                               — re-register Node bridge')
end, true)
AddEventHandler('onResourceStart', function(res)
    if res ~= RESOURCE then return end
    print('^2[s4-doctor]^0 v2.1 started — log hub + Node bridge ready')
    print('^2[s4-doctor]^0 Node API auto-starts on port 4789 (FiveM yarn + launcher)')
end)
