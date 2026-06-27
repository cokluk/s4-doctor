Doctor = Doctor or {}

local RESOURCE = GetCurrentResourceName()
local IS_SERVER = IsDuplicityVersion()
local exposed = {}
local registered = false

local function debugLog(msg, ...)
    if GetConvar('s4_doctor_debug', 'false') == 'true' then
        print(('[s4-doctor:%s] ' .. msg):format(RESOURCE, ...))
    end
end

local function unpackArgs(args)
    if type(args) ~= 'table' then return end
    return table.unpack(args)
end

local function makeResult(ok, data, err)
    return {
        success = ok,
        resource = RESOURCE,
        side = IS_SERVER and 'server' or 'client',
        data = data,
        error = err,
        via = 'doctor',
    }
end

local Framework = { type = 'standalone', object = nil }

local function detectFramework()
    if Framework.object or Framework.type == 'ox' then return Framework end
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
    if GetResourceState('vrp') == 'started' then
        Framework.type = 'vrp'
    end
    if GetResourceState('ox_lib') == 'started' then
        Framework.type = 'ox'
    end
    return Framework
end

local function validatePayload(payload)
    if type(payload) ~= 'table' then return false, 'invalid_payload' end
    if not payload.requestId then return false, 'missing_request_id' end
    if payload.targetResource and payload.targetResource ~= RESOURCE then
        return false, 'resource_mismatch'
    end
    return true
end

function Doctor.expose(name, fn)
    if type(name) ~= 'string' or type(fn) ~= 'function' then return false end
    exposed[name] = fn
    return true
end

function Doctor.getFramework()
    return detectFramework()
end

local function executeLocalFunction(name, args)
    local fn = exposed[name] or _G[name]
    if type(fn) ~= 'function' then
        return makeResult(false, nil, ('local function not found: %s (use Doctor.expose)'):format(name))
    end
    local ok, result = pcall(fn, unpackArgs(args))
    if not ok then return makeResult(false, nil, tostring(result)) end
    return makeResult(true, result)
end

local function executeExport(name, args, exportResource)
    local res = exportResource or RESOURCE
    local exp = exports[res]
    if not exp then return makeResult(false, nil, ('export resource not found: %s'):format(res)) end
    local fn = exp[name]
    if type(fn) ~= 'function' then
        return makeResult(false, nil, ('export not found: %s:%s'):format(res, name))
    end
    local ok, result = pcall(fn, unpackArgs(args))
    if not ok then return makeResult(false, nil, tostring(result)) end
    return makeResult(true, result)
end

local function executeEvent(name, args, eventSide)
    local side = eventSide or (IS_SERVER and 'server' or 'client')
    if side == 'server' and IS_SERVER then
        TriggerEvent(name, unpackArgs(args))
        return makeResult(true, { triggered = true, event = name, side = 'server' })
    end
    if side == 'server' and not IS_SERVER then
        TriggerServerEvent(name, unpackArgs(args))
        return makeResult(true, { triggered = true, event = name, side = 'server' })
    end
    if side == 'client' and not IS_SERVER then
        TriggerEvent(name, unpackArgs(args))
        return makeResult(true, { triggered = true, event = name, side = 'client' })
    end
    return makeResult(false, nil, 'client event from server doctor requires playerId via hub')
end

local function executeFrameworkCallback(name, args, frameworkType, cbSide)
    local fw = detectFramework()
    local useType = frameworkType or fw.type
    local side = cbSide or 'server'
    local argList = args or {}
    if useType == 'esx' and fw.object then
        if side == 'server' and IS_SERVER then
            TriggerEvent('esx:triggerServerCallback', name, argList._source or 0, argList)
            return makeResult(true, { triggered = true, callback = name, framework = 'esx' })
        end
        if side == 'client' and not IS_SERVER then
            local finished, cbResult = false, nil
            fw.object.TriggerServerCallback(name, function(...)
                cbResult = { ... }
                finished = true
            end, unpackArgs(argList))
            local deadline = GetGameTimer() + (tonumber(GetConvar('s4_doctor_timeout', '15000')) or 15000)
            while not finished and GetGameTimer() < deadline do Wait(0) end
            if not finished then return makeResult(false, nil, 'callback timeout') end
            return makeResult(true, cbResult)
        end
    end
    if (useType == 'qbcore' or useType == 'qbx') and fw.object then
        if side == 'server' and IS_SERVER then
            TriggerEvent('QBCore:Server:TriggerCallback', name, argList._source or 0, argList)
            return makeResult(true, { triggered = true, callback = name, framework = useType })
        end
        if side == 'client' and not IS_SERVER and fw.object.Functions then
            local finished, cbResult = false, nil
            fw.object.Functions.TriggerCallback(name, function(...)
                cbResult = { ... }
                finished = true
            end, unpackArgs(argList))
            local deadline = GetGameTimer() + (tonumber(GetConvar('s4_doctor_timeout', '15000')) or 15000)
            while not finished and GetGameTimer() < deadline do Wait(0) end
            if not finished then return makeResult(false, nil, 'callback timeout') end
            return makeResult(true, cbResult)
        end
    end
    if useType == 'ox' then
        local function oxAwait(source, ...)
            if lib and lib.callback and lib.callback.await then
                return lib.callback.await(name, source, ...)
            end
            error('ox_lib lib.callback not available')
        end
        if side == 'client' and not IS_SERVER then
            local ok, result = pcall(oxAwait, false, unpackArgs(argList))
            if ok then return makeResult(true, result) end
            return makeResult(false, nil, tostring(result))
        end
        if side == 'server' and IS_SERVER then
            local ok, result = pcall(oxAwait, argList._source or 0, unpackArgs(argList))
            if ok then return makeResult(true, result) end
            return makeResult(false, nil, tostring(result))
        end
    end
    return makeResult(false, nil, ('framework callback not supported: %s/%s'):format(useType, side))
end

local EXECUTORS = {
    localFunction = function(p) return executeLocalFunction(p.targetName, p.arguments) end,
    export = function(p) return executeExport(p.targetName, p.arguments, p.exportResource) end,
    event = function(p) return executeEvent(p.targetName, p.arguments, p.eventSide) end,
    frameworkCallback = function(p)
        return executeFrameworkCallback(p.targetName, p.arguments, p.frameworkType, p.callbackSide)
    end,
}

local function executePayload(payload)
    local valid, reason = validatePayload(payload)
    if not valid then return makeResult(false, nil, reason) end
    local executor = EXECUTORS[payload.executionType]
    if not executor then
        return makeResult(false, nil, ('unknown executionType: %s'):format(tostring(payload.executionType)))
    end
    return executor(payload)
end

local function registerWithHub()
    if registered then return end
    if GetResourceState('s4-doctor') ~= 'started' then return end
    if IS_SERVER then
        TriggerEvent('s4-doctor:doctor:registerServer', RESOURCE, detectFramework().type)
    else
        TriggerServerEvent('s4-doctor:doctor:registerClient', RESOURCE, detectFramework().type)
    end
    registered = true
    debugLog('registered (%s)', IS_SERVER and 'server' or 'client')
end

local executeEventName = IS_SERVER and 's4-doctor:doctor:executeServer' or 's4-doctor:doctor:executeClient'

local function onDoctorExecute(payload)
    if type(payload) ~= 'table' or payload.targetResource ~= RESOURCE then return end
    local result = executePayload(payload)
    if IS_SERVER then
        TriggerEvent('s4-doctor:hub:result', payload.requestId, result)
    else
        TriggerServerEvent('s4-doctor:hub:clientResult', payload.requestId, result)
    end
end

if IS_SERVER then
    AddEventHandler(executeEventName, onDoctorExecute)
else
    RegisterNetEvent(executeEventName, onDoctorExecute)
end

AddEventHandler('onResourceStart', function(res)
    if res == 's4-doctor' or res == RESOURCE then
        registered = false
        CreateThread(function()
            Wait(500)
            registerWithHub()
        end)
    end
end)

if not IS_SERVER then
    AddEventHandler('onClientResourceStart', function(res)
        if res == 's4-doctor' or res == RESOURCE then
            registered = false
            CreateThread(function()
                Wait(500)
                registerWithHub()
            end)
        end
    end)
    AddEventHandler('playerSpawned', function()
        CreateThread(function()
            Wait(1500)
            registerWithHub()
        end)
    end)
end

CreateThread(function()
    Wait(1000)
    registerWithHub()
    if not IS_SERVER then
        Wait(4000)
        registerWithHub()
    end
end)

return Doctor
