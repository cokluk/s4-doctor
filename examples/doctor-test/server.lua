if not Doctor or type(Doctor.expose) ~= 'function' then
    error('[doctor-test] Doctor API missing — ensure s4-doctor starts before doctor-test')
end

local spawnCount = 0
local enterCount = 0

local function log(step, message, ...)
    local extra = ''
    if select('#', ...) > 0 then
        extra = ' | ' .. table.concat({ ... }, ' | ')
    end
    print(('[doctor-test][server][%s] %s%s'):format(step, message, extra))
end

local function isPlayerOnline(playerId)
    playerId = tonumber(playerId)
    if not playerId then return false end
    return GetPlayerPing(playerId) >= 0 and GetPlayerPed(playerId) ~= 0
end

local function agentSpawnVehicle(playerId, modelName, plateText)
    playerId = tonumber(playerId)
    log('spawn', 'agent spawn requested', ('player=%s'):format(tostring(playerId)), ('model=%s'):format(tostring(modelName or 'sultan')), ('plate=%s'):format(tostring(plateText or 'DOCTOR')))

    if not isPlayerOnline(playerId) then
        log('spawn', 'player not online', tostring(playerId))
        return { success = false, error = ('player %s not online'):format(tostring(playerId)) }
    end

    local model = modelName or 'sultan'
    local hash = type(model) == 'string' and joaat(model) or model
    local plate = (plateText or 'DOCTOR'):upper():sub(1, 8)
    local ped = GetPlayerPed(playerId)
    local coords = GetEntityCoords(ped)
    local heading = GetEntityHeading(ped)

    log('spawn', 'player position', ('x=%.1f'):format(coords.x), ('y=%.1f'):format(coords.y), ('heading=%.1f'):format(heading))

    local netId, veh, via

    if GetResourceState('qb-core') == 'started' then
        log('spawn', 'using QBCore.Functions.CreateVehicle (warp=true)')
        local okCore, core = pcall(function() return exports['qb-core']:GetCoreObject() end)
        if okCore and core and core.Functions and core.Functions.CreateVehicle then
            local okVeh, result = pcall(function()
                return core.Functions.CreateVehicle(playerId, hash, nil, nil, true)
            end)
            if okVeh and result and result ~= 0 then
                veh = result
                SetVehicleNumberPlateText(veh, plate)
                netId = NetworkGetNetworkIdFromEntity(veh)
                via = 'qbcore-warp'
                log('spawn', 'qbcore vehicle created', ('netId=%s'):format(tostring(netId)), ('entity=%s'):format(tostring(veh)), ('plate=%s'):format(plate))
            else
                log('spawn', 'QBCore CreateVehicle failed', tostring(result))
            end
        end
    end

    if not netId and qbx and type(qbx.spawnVehicle) == 'function' then
        log('spawn', 'using qbx.spawnVehicle')
        local ok, qNetId, qVeh = pcall(function()
            return qbx.spawnVehicle({
                model = hash,
                spawnSource = playerId,
                warp = true,
                props = { plate = plate },
            })
        end)
        if ok and qNetId then
            netId, veh, via = qNetId, qVeh, 'qbx-server'
            log('spawn', 'qbx vehicle created', ('netId=%s'):format(tostring(netId)), ('entity=%s'):format(tostring(veh)), ('plate=%s'):format(plate))
        else
            log('spawn', 'qbx.spawnVehicle failed', tostring(qNetId))
        end
    end

    if not netId then
        log('spawn', 'using CreateVehicleServerSetter')
        local vehicleType = 'automobile'
        veh = CreateVehicleServerSetter(hash, vehicleType, coords.x, coords.y, coords.z, heading)
        if not veh or veh == 0 then
            log('spawn', 'CreateVehicleServerSetter failed')
            return { success = false, error = 'CreateVehicleServerSetter failed' }
        end
        SetVehicleNumberPlateText(veh, plate)
        netId = NetworkGetNetworkIdFromEntity(veh)
        via = 'server-setter'
        log('spawn', 'server-setter vehicle created', ('netId=%s'):format(tostring(netId)), ('entity=%s'):format(tostring(veh)), ('plate=%s'):format(plate))

        log('enter', 'attempting server-side warp', ('player=%s'):format(playerId), ('entity=%s'):format(tostring(veh)))
        SetPedIntoVehicle(ped, veh, -1)
    end

    local seated = false
    if veh and veh ~= 0 then
        local seatDeadline = GetGameTimer() + 5000
        while GetGameTimer() < seatDeadline do
            if GetVehiclePedIsIn(ped, false) == veh then
                seated = true
                break
            end
            Wait(50)
        end
    end

    if seated then
        enterCount = enterCount + 1
        log('enter', ('player seated #%d'):format(enterCount), ('player=%s'):format(playerId), ('plate=%s'):format(plate), ('netId=%s'):format(tostring(netId)), ('via=%s'):format(via))
    elseif netId then
        log('enter', 'warp failed on server — requesting doctor-test client warp', ('player=%s'):format(playerId), ('netId=%s'):format(tostring(netId)))
        TriggerClientEvent('doctor-test:client:warpIntoVehicle', playerId, netId, plate)
    end

    spawnCount = spawnCount + 1
    log('spawn', ('spawn #%d complete'):format(spawnCount), ('player=%s'):format(playerId), ('via=%s'):format(via), ('seated=%s'):format(tostring(seated)))

    return {
        success = true,
        playerId = playerId,
        model = modelName or 'sultan',
        plate = plate,
        netId = netId,
        entity = veh,
        via = via,
        seated = seated,
        warpSent = not seated,
    }
end

RegisterNetEvent('doctor-test:server:spawned', function(info)
    local src = source
    if type(info) ~= 'table' then return end
    spawnCount = spawnCount + 1
    log('spawn', ('client spawn #%d recorded'):format(spawnCount), ('player=%s'):format(src), ('plate=%s'):format(tostring(info.plate)), ('netId=%s'):format(tostring(info.netId)), ('seated=%s'):format(tostring(info.seated)))
end)

RegisterNetEvent('doctor-test:server:entered', function(info)
    local src = source
    if type(info) ~= 'table' then return end
    enterCount = enterCount + 1
    if info.seated then
        log('enter', ('player seated #%d'):format(enterCount), ('player=%s'):format(src), ('plate=%s'):format(tostring(info.plate)), ('netId=%s'):format(tostring(info.netId)))
    else
        log('enter', ('player NOT seated #%d'):format(enterCount), ('player=%s'):format(src), ('plate=%s'):format(tostring(info.plate)), ('error=%s'):format(tostring(info.error or 'warp failed')))
    end
end)

Doctor.expose('GetSpawnCount', function()
    return { success = true, count = spawnCount, enterCount = enterCount }
end)

Doctor.expose('AgentSpawnVehicle', agentSpawnVehicle)

exports('GetSpawnCount', function()
    return spawnCount
end)

exports('AgentSpawnVehicle', agentSpawnVehicle)

RegisterCommand('doctortest_server', function(source)
    if source ~= 0 then return end
    log('stats', 'totals', ('spawns=%d'):format(spawnCount), ('enters=%d'):format(enterCount))
end, true)
