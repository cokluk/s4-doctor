if not Doctor or type(Doctor.expose) ~= 'function' then
    error('[doctor-test] Doctor API missing — ensure s4-doctor starts before doctor-test')
end

local RESOURCE = GetCurrentResourceName()
local lastVehicle = nil
local lastPlate = nil

local DEFAULT_MODEL = `sultan`
local DEFAULT_PLATE = 'DOCTOR'

local function log(step, message, ...)
    local extra = ''
    if select('#', ...) > 0 then
        extra = ' | ' .. table.concat({ ... }, ' | ')
    end
    print(('[doctor-test][client][%s] %s%s'):format(step, message, extra))
end

local function loadModel(model)
    if type(model) == 'string' then
        model = joaat(model)
    end
    log('model', 'checking model', tostring(model))
    if not IsModelInCdimage(model) or not IsModelAVehicle(model) then
        log('model', 'invalid vehicle model', tostring(model))
        return false, ('invalid vehicle model: %s'):format(tostring(model))
    end
    RequestModel(model)
    local deadline = GetGameTimer() + 10000
    while not HasModelLoaded(model) and GetGameTimer() < deadline do
        Wait(0)
    end
    if not HasModelLoaded(model) then
        log('model', 'load timeout', tostring(model))
        return false, 'model load timeout'
    end
    log('model', 'loaded', tostring(model))
    return true, model
end

local function deleteLastVehicle()
    if lastVehicle and DoesEntityExist(lastVehicle) then
        log('cleanup', 'deleting previous test vehicle', tostring(lastVehicle))
        SetEntityAsMissionEntity(lastVehicle, true, true)
        DeleteVehicle(lastVehicle)
    end
    lastVehicle = nil
end

local function enterVehicle(ped, veh, plate)
    log('enter', 'warping player into vehicle', ('entity=%s'):format(tostring(veh)), ('plate=%s'):format(plate or '?'))

    SetVehicleOnGroundProperly(veh)
    TaskWarpPedIntoVehicle(ped, veh, -1)

    local deadline = GetGameTimer() + 5000
    while GetGameTimer() < deadline do
        if GetVehiclePedIsIn(ped, false) == veh then
            local seat = GetPedInVehicleSeat(veh, -1)
            log('enter', 'player seated in driver seat', ('entity=%s'):format(tostring(veh)), ('seatPed=%s'):format(tostring(seat)))
            TriggerServerEvent('doctor-test:server:entered', {
                plate = plate or GetVehicleNumberPlateText(veh),
                netId = NetworkGetNetworkIdFromEntity(veh),
                entity = veh,
                seated = true,
            })
            return true
        end
        Wait(50)
    end

    log('enter', 'warp failed — player not in vehicle', ('entity=%s'):format(tostring(veh)))
    TriggerServerEvent('doctor-test:server:entered', {
        plate = plate or GetVehicleNumberPlateText(veh),
        netId = NetworkGetNetworkIdFromEntity(veh),
        entity = veh,
        seated = false,
    })
    return false
end

local function warpIntoNetVehicle(netId, plate)
    netId = tonumber(netId)
    if not netId then
        log('warp', 'invalid netId')
        return { success = false, error = 'invalid netId' }
    end

    log('warp', 'waiting for network entity', ('netId=%s'):format(netId), ('plate=%s'):format(plate or '?'))

    local deadline = GetGameTimer() + 10000
    while not NetworkDoesEntityExistWithNetworkId(netId) and GetGameTimer() < deadline do
        Wait(50)
    end

    if not NetworkDoesEntityExistWithNetworkId(netId) then
        log('warp', 'network entity timeout', ('netId=%s'):format(netId))
        TriggerServerEvent('doctor-test:server:entered', { netId = netId, plate = plate, seated = false, error = 'network timeout' })
        return { success = false, error = 'network entity timeout' }
    end

    local veh = NetToVeh(netId)
    if not veh or veh == 0 or not DoesEntityExist(veh) then
        log('warp', 'vehicle entity missing after net sync', ('netId=%s'):format(netId))
        TriggerServerEvent('doctor-test:server:entered', { netId = netId, plate = plate, seated = false, error = 'entity missing' })
        return { success = false, error = 'vehicle entity missing' }
    end

    if plate and plate ~= '' then
        SetVehicleNumberPlateText(veh, plate)
        log('warp', 'plate applied on client', plate)
    end

    local ped = PlayerPedId()
    local seated = enterVehicle(ped, veh, plate)
    lastVehicle = veh
    lastPlate = plate

    return {
        success = seated,
        plate = plate,
        netId = netId,
        entity = veh,
        seated = seated,
        via = 'client-warp',
    }
end

local function spawnTestVehicle(modelName, plateText)
    log('spawn', 'start', ('model=%s'):format(tostring(modelName or 'sultan')), ('plate=%s'):format(tostring(plateText or DEFAULT_PLATE)))
    deleteLastVehicle()

    local model = modelName or DEFAULT_MODEL
    local ok, loadedOrErr = loadModel(model)
    if not ok then
        log('spawn', 'failed', tostring(loadedOrErr))
        return { success = false, error = loadedOrErr }
    end
    model = loadedOrErr

    local ped = PlayerPedId()
    local coords = GetEntityCoords(ped)
    local heading = GetEntityHeading(ped)
    local forward = GetEntityForwardVector(ped)
    local spawnX = coords.x + forward.x * 4.0
    local spawnY = coords.y + forward.y * 4.0
    local spawnZ = coords.z + forward.z * 4.0

    log('spawn', 'creating vehicle', ('x=%.1f'):format(spawnX), ('y=%.1f'):format(spawnY), ('heading=%.1f'):format(heading))

    local veh = CreateVehicle(model, spawnX, spawnY, spawnZ, heading, true, false)
    if not veh or veh == 0 then
        SetModelAsNoLongerNeeded(model)
        log('spawn', 'CreateVehicle failed')
        return { success = false, error = 'CreateVehicle failed' }
    end

    local plate = (plateText or DEFAULT_PLATE):upper():sub(1, 8)
    SetVehicleNumberPlateText(veh, plate)
    SetEntityAsMissionEntity(veh, true, true)
    log('spawn', 'vehicle created', ('entity=%s'):format(tostring(veh)), ('plate=%s'):format(plate))

    local seated = enterVehicle(ped, veh, plate)
    SetModelAsNoLongerNeeded(model)

    lastVehicle = veh
    lastPlate = plate

    local netId = NetworkGetNetworkIdFromEntity(veh)
    local result = {
        success = true,
        model = modelName or 'sultan',
        plate = plate,
        netId = netId,
        entity = veh,
        seated = seated,
        via = 'client-spawn',
    }

    log('spawn', 'complete', ('plate=%s'):format(plate), ('netId=%s'):format(netId), ('seated=%s'):format(tostring(seated)))
    TriggerServerEvent('doctor-test:server:spawned', result)

    return result
end

local function getLastSpawnInfo()
    if not lastVehicle or not DoesEntityExist(lastVehicle) then
        log('info', 'no active test vehicle')
        return { success = false, error = 'no active test vehicle' }
    end
    local ped = PlayerPedId()
    local inVehicle = GetVehiclePedIsIn(ped, false) == lastVehicle
    log('info', 'last spawn query', ('plate=%s'):format(lastPlate or '?'), ('inVehicle=%s'):format(tostring(inVehicle)))
    return {
        success = true,
        plate = GetVehicleNumberPlateText(lastVehicle),
        netId = NetworkGetNetworkIdFromEntity(lastVehicle),
        entity = lastVehicle,
        seated = inVehicle,
    }
end

Doctor.expose('SpawnTestVehicle', spawnTestVehicle)
Doctor.expose('GetLastSpawnInfo', getLastSpawnInfo)
Doctor.expose('WarpIntoTestVehicle', warpIntoNetVehicle)
Doctor.expose('DeleteTestVehicle', function()
    log('cleanup', 'delete requested')
    deleteLastVehicle()
    return { success = true }
end)

RegisterCommand('doctortest', function(_, args)
    local model = args[1] or 'sultan'
    local plate = args[2] or DEFAULT_PLATE
    spawnTestVehicle(model, plate)
end, false)

RegisterNetEvent('doctor-test:client:spawn', function(model, plate)
    log('event', 'doctor-test:client:spawn received', tostring(model), tostring(plate))
    spawnTestVehicle(model, plate)
end)

RegisterNetEvent('doctor-test:client:warpIntoVehicle', function(netId, plate)
    log('event', 'doctor-test:client:warpIntoVehicle received', tostring(netId), tostring(plate))
    warpIntoNetVehicle(netId, plate)
end)

AddEventHandler('onResourceStop', function(res)
    if res ~= RESOURCE then return end
    deleteLastVehicle()
end)

exports('SpawnTestVehicle', spawnTestVehicle)
exports('GetLastSpawnInfo', getLastSpawnInfo)
exports('WarpIntoTestVehicle', warpIntoNetVehicle)
