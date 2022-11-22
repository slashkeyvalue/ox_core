--[[
    calls an export when indexed by an external resource

    e.g:
        Ox.GetPlayerUserId 
        -> becomes ->
        exports['ox_core']:GetPlayerUserId
--]]

local CORE = 'ox_core'

_G.ox = setmetatable({ },
{
    __index = function(self, key)
        
        --[[ Try to access a local function or property if it exists  ]]
        local localRef = rawget(self, key)

        if localRef then
            return localRef
        end

        --[[ We are likely trying to call an exported function, so, lets return a wrapper for it! ]]
        return function(...)
            local status, err = pcall(function(...)
                local exp = exports[CORE]

                return exp[key](exp, ...)
            end, ...)

            if not status then
                --[[ Handle each export error, if possible ]]
                error( ('No exported function by the name "%s" found in the ox namespace. error: %s'):format(key, err) )
            end

            local rets = err

            return rets
        end
    end,

    __newindex = function(self, key, value)

        rawset(self, key, value)

        if type(value) ~= 'function' then
            return
        end

        exports(key, value)
    end
})