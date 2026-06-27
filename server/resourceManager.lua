ResourceManager = ResourceManager or {}

local PROTECTED = {
    ['s4-doctor'] = true,
}

local ALLOWED_ACTIONS = {
    ensure = true,
    restart = true,
    start = true,
    stop = true,
    refresh = true,
}

function ResourceManager.getProtected()
    return PROTECTED
end

function ResourceManager.isProtected(resourceName)
    if type(resourceName) ~= 'string' or resourceName == '' then
        return false
    end
    return PROTECTED[resourceName:lower()] == true
end

function ResourceManager.isAllowedAction(action)
    if type(action) ~= 'string' then return false end
    return ALLOWED_ACTIONS[action:lower()] == true
end

function ResourceManager.parseResourceCommand(cmdStr)
    if type(cmdStr) ~= 'string' then return nil end
    local trimmed = cmdStr:match('^%s*(.-)%s*$')
    local action, resource = trimmed:match('^(%a+)%s+([%w%-_%.]+)%s*$')
    if not action or not resource then return nil end
    action = action:lower()
    if not ALLOWED_ACTIONS[action] then return nil end
    return action, resource
end

function ResourceManager.validateConsoleCommand(cmdStr)
    local action, resource = ResourceManager.parseResourceCommand(cmdStr)
    if not action then
        return true
    end
    if ResourceManager.isProtected(resource) then
        return false, ('protected resource — s4-doctor cannot %s itself or the hub: %s'):format(action, resource)
    end
    return true
end

function ResourceManager.buildCommand(action, resourceName)
    action = action:lower()
    resourceName = resourceName:lower()
    if not ALLOWED_ACTIONS[action] then
        return nil, 'invalid resource action: ' .. tostring(action)
    end
    if ResourceManager.isProtected(resourceName) then
        return nil, ('protected resource — blocked action %s on %s'):format(action, resourceName)
    end
    return ('%s %s'):format(action, resourceName)
end

function ResourceManager.runAction(action, resourceName)
    local cmd, err = ResourceManager.buildCommand(action, resourceName)
    if not cmd then
        return false, err
    end
    ExecuteCommand(cmd)
    return true, cmd
end

PlayerResolver = PlayerResolver or {}

local function getPlayerNameSafe(pid)
    local ok, name = pcall(GetPlayerName, pid)
    return ok and name or ('player:%s'):format(pid)
end

function PlayerResolver.isOnline(pid)
    pid = tonumber(pid)
    if not pid then return false end
    for _, id in ipairs(GetPlayers()) do
        if tonumber(id) == pid then return true end
    end
    return false
end

function PlayerResolver.getOnlineList()
    local list = {}
    for _, id in ipairs(GetPlayers()) do
        local pid = tonumber(id)
        list[#list + 1] = {
            playerId = pid,
            name = getPlayerNameSafe(pid),
            ping = GetPlayerPing(pid),
        }
    end
    table.sort(list, function(a, b) return a.playerId < b.playerId end)
    return list
end

function PlayerResolver.resolve(payload, doctorsClient)
    local requested = payload and payload.playerId and tonumber(payload.playerId)
    if requested and PlayerResolver.isOnline(requested) then
        return requested, nil
    end
    local res = payload and payload.targetResource
    local doc = res and doctorsClient and doctorsClient[res]
    if doc and doc.players then
        for pid, _ in pairs(doc.players) do
            pid = tonumber(pid)
            if pid and PlayerResolver.isOnline(pid) then
                local note = requested and ('playerId %d offline — using %d'):format(requested, pid)
                    or ('auto-selected registered client player %d'):format(pid)
                return pid, note
            end
        end
    end
    local players = GetPlayers()
    if #players == 0 then
        return nil, nil, 'no players online — join the server to run client-side tests'
    end
    local pid = tonumber(players[1])
    local note = requested and ('playerId %d offline — using first online player %d'):format(requested, pid)
        or ('auto-selected first online player %d'):format(pid)
    return pid, note
end

function PlayerResolver.hasClientDoctor(resource, doctorsClient, preferredPid)
    local doc = doctorsClient[resource]
    if not doc then return false end
    if doc.players then
        if preferredPid and doc.players[preferredPid] then return true end
        for pid, _ in pairs(doc.players) do
            if PlayerResolver.isOnline(pid) then return true end
        end
        return false
    end
    return true
end
