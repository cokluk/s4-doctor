local RESOURCE = GetCurrentResourceName()
local logQueue = {}
local nuiOpen = false
local nuiFocus = false

local function classifyLevel(msg)
    if type(msg) ~= 'string' then return 'info' end
    local lower = msg:lower()
    if lower:find('error') or lower:find('failed') then return 'error' end
    if lower:find('warn') then return 'warning' end
    return 'info'
end

local function stripColorCodes(msg)
    if type(msg) ~= 'string' then return tostring(msg) end
    return msg:gsub('%^%d', ''):gsub('~%a~', '')
end

local function unpackArgs(args)
    if type(args) ~= 'table' then return end
    return table.unpack(args)
end

local function makeResult(ok, data, err)
    return {
        success = ok,
        data = data,
        error = err,
        via = 'client-hub',
    }
end

local function queueLog(message, level, meta)
    logQueue[#logQueue + 1] = {
        message = stripColorCodes(message),
        level = level or classifyLevel(message),
        timestamp = GetGameTimer(),
        resource = meta and meta.resource or RESOURCE,
        channel = meta and meta.channel or nil,
    }
end

if RegisterConsoleListener then
    RegisterConsoleListener(function(channel, message)
        if type(message) ~= 'string' or message == '' then return end
        local resName = channel and channel:match('script:(.+)') or nil
        queueLog(message, classifyLevel(message), { resource = resName, channel = channel })
    end)
else
    local _print = print
    print = function(...)
        local parts = {}
        for i = 1, select('#', ...) do
            parts[i] = tostring(select(i, ...))
        end
        local msg = table.concat(parts, '\t')
        queueLog(msg, classifyLevel(msg))
        _print(...)
    end
    if Citizen and Citizen.Trace then
        local _trace = Citizen.Trace
        Citizen.Trace = function(msg)
            if type(msg) == 'string' and msg ~= '' then
                queueLog(msg, classifyLevel(msg))
            end
            _trace(msg)
        end
    end
end

CreateThread(function()
    while true do
        Wait(Config.ClientLogBatchMs)
        if #logQueue > 0 then
            TriggerServerEvent('s4-doctor:hub:clientLog', logQueue)
            logQueue = {}
        end
    end
end)

local function setNuiFocusState(enableKeyboard)
    nuiFocus = enableKeyboard == true
    if nuiOpen then
        SetNuiFocus(true, nuiFocus)
    end
end

local function setNuiVisible(visible)
    nuiOpen = visible
    SendNUIMessage({
        type = 'visible',
        visible = visible,
        focus = nuiFocus,
    })
    if visible then
        setNuiFocusState(Config.NuiDefaultFocus)
    else
        nuiFocus = false
        SetNuiFocus(false, false)
    end
end

local function toggleNui()
    if not Config.NuiEnabled then return end
    if nuiOpen then
        setNuiVisible(false)
        return
    end
    TriggerServerEvent('s4-doctor:hub:requestNuiSnapshot')
end

RegisterNetEvent('s4-doctor:hub:toggleUi', toggleNui)

RegisterNetEvent('s4-doctor:hub:nuiSnapshot', function(data)
    if not Config.NuiEnabled then return end
    SendNUIMessage({ type = 'snapshot', logs = (data and data.logs) or {} })
    setNuiVisible(true)
end)

CreateThread(function()
    while true do
        if nuiOpen then
            Wait(0)
            DisableControlAction(0, 322, true)
            DisableControlAction(0, 200, true)
            if IsDisabledControlJustReleased(0, 322) or IsDisabledControlJustReleased(0, 200) then
                setNuiVisible(false)
            end
        else
            Wait(250)
        end
    end
end)

RegisterNetEvent('s4-doctor:hub:nuiLog', function(entry)
    if not Config.NuiEnabled or not nuiOpen or type(entry) ~= 'table' then return end
    SendNUIMessage({ type = 'log', entry = entry })
end)

RegisterCommand('s4doctorui', function()
    toggleNui()
end, false)

RegisterCommand('s4doctor', function(_, args)
    if args[1] == 'ui' then toggleNui() end
end, false)

RegisterNUICallback('close', function(_, cb)
    setNuiVisible(false)
    cb('ok')
end)

RegisterNUICallback('toggleFocus', function(data, cb)
    setNuiFocusState(data and data.focus == true)
    cb('ok')
end)

RegisterNUICallback('clear', function(_, cb)
    SendNUIMessage({ type = 'clear' })
    cb('ok')
end)

local Framework = { type = 'standalone', object = nil }

local function detectFramework()
    if Framework.object then return Framework end
    if GetResourceState('es_extended') == 'started' then
        local ok, obj = pcall(function() return exports['es_extended']:getSharedObject() end)
        if ok and obj then Framework.type, Framework.object = 'esx', obj return Framework end
    end
    if GetResourceState('qb-core') == 'started' then
        local ok, obj = pcall(function() return exports['qb-core']:GetCoreObject() end)
        if ok and obj then Framework.type, Framework.object = 'qbcore', obj return Framework end
    end
    if GetResourceState('qbx_core') == 'started' then
        local ok, obj = pcall(function() return exports.qbx_core:GetCoreObject() end)
        if not ok or not obj then
            ok, obj = pcall(function() return exports['qbx_core']:GetCoreObject() end)
        end
        if ok and obj then Framework.type, Framework.object = 'qbx', obj return Framework end
    end
    if GetResourceState('ox_lib') == 'started' then
        Framework.type = 'ox'
    end
    return Framework
end

local function executeExport(payload)
    local res = payload.exportResource or payload.targetResource
    if GetResourceState(res) ~= 'started' then
        return makeResult(false, nil, ('export resource not started: %s'):format(res))
    end
    local ok, fn = pcall(function()
        return exports[res][payload.targetName]
    end)
    if not ok or type(fn) ~= 'function' then
        return makeResult(false, nil, ('export not found: %s:%s (%s)'):format(res, payload.targetName, tostring(fn)))
    end
    local execOk, result = pcall(fn, unpackArgs(payload.arguments))
    if not execOk then return makeResult(false, nil, tostring(result)) end
    return makeResult(true, result)
end

local function executeEvent(payload)
    local side = payload.eventSide or 'client'
    if side == 'client' then
        TriggerEvent(payload.targetName, unpackArgs(payload.arguments))
        return makeResult(true, { triggered = true, event = payload.targetName, side = 'client' })
    end
    TriggerServerEvent(payload.targetName, unpackArgs(payload.arguments))
    return makeResult(true, { triggered = true, event = payload.targetName, side = 'server' })
end

local function executeFrameworkCallback(payload)
    local fw = payload.frameworkType or detectFramework().type
    local name = payload.targetName
    local args = payload.arguments or {}
    if fw == 'esx' then
        local ESX = detectFramework().object
        if not ESX then return makeResult(false, nil, 'ESX not available') end
        local finished, cbResult = false, nil
        ESX.TriggerServerCallback(name, function(...)
            cbResult = { ... }
            finished = true
        end, unpackArgs(args))
        local deadline = GetGameTimer() + Config.RequestTimeout
        while not finished and GetGameTimer() < deadline do Wait(0) end
        if not finished then return makeResult(false, nil, 'callback timeout') end
        return makeResult(true, cbResult)
    end
    if fw == 'qbcore' or fw == 'qbx' then
        local Core = detectFramework().object
        if not Core then return makeResult(false, nil, 'QBCore/QBX not available') end
        local finished, cbResult = false, nil
        Core.Functions.TriggerCallback(name, function(...)
            cbResult = { ... }
            finished = true
        end, unpackArgs(args))
        local deadline = GetGameTimer() + Config.RequestTimeout
        while not finished and GetGameTimer() < deadline do Wait(0) end
        if not finished then return makeResult(false, nil, 'callback timeout') end
        return makeResult(true, cbResult)
    end
    if fw == 'ox' then
        local ok, result = pcall(function()
            if lib and lib.callback and lib.callback.await then
                return lib.callback.await(name, false, unpackArgs(args))
            end
            error('ox_lib lib.callback not available')
        end)
        if ok then return makeResult(true, result) end
        return makeResult(false, nil, tostring(result))
    end
    return makeResult(false, nil, ('framework callback not supported: %s'):format(fw))
end

local function executeCommand(payload)
    ExecuteCommand(payload.targetName)
    return makeResult(true, { executed = payload.targetName })
end

local EXECUTORS = {
    export = executeExport,
    event = executeEvent,
    frameworkCallback = executeFrameworkCallback,
    command = executeCommand,
}

RegisterNetEvent('s4-doctor:hub:executeDirect', function(payload)
    if type(payload) ~= 'table' then return end
    local executor = EXECUTORS[payload.executionType]
    local result
    if executor then
        result = executor(payload)
    else
        result = makeResult(false, nil, ('client hub cannot execute: %s'):format(tostring(payload.executionType)))
    end
    TriggerServerEvent('s4-doctor:hub:clientResult', payload.requestId, result)
end)
