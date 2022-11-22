
--[[ Functions inside `Ox` are always exported ]]

local gSessionsData = { }

--[[ lookup ]]
local gSessionIdFromUserId = { }

local function GetSessionData(sessionId)
    return gSessionsData[sessionId]
end

function ox.GetSessionIdFromUserId(userId)
    local sessionId = gSessionIdFromUserId[userId]

    return sessionId
end

--[[ ]]

function ox.GetSessionUserId(sessionId)
    return GetSessionData(sessionId)?.userId
end

CreateThread(function()

    do
        --[[ Insert mockup ]]
        
        gSessionsData[1] =
        {
            name = 'hello',
            userId = 2,
        }

        gSessionIdFromUserId[2] = 1
    end

    Wait(100)

    --[[
        You can do the same in any (server) resource as long as it imports:
        
        (WIP!)
        
        '@ox_core/server/class.lua',
        '@ox_core/code/server-common/ox.lua',
        '@ox_core/code/server-common/session.lua',
        '@ox_core/code/server-common/session_factory.lua',
    --]]

    local session = ox.GetSession(1)

    local userId = session:getUserId()

    print( ('ox_core :: session test -> %s'):format(session) )
end)