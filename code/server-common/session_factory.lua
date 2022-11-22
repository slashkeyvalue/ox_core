function ox.GetSession(sessionId)
    return setmetatable({ id = sessionId }, Session)
end

function ox.GetSessionFromUserId(userId)
    local sessionId = Ox.GetSessionFromUserId(userId)

    return setmetatable({ id = sessionId }, Session)
end