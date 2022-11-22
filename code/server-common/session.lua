Session = Class.new()

--

function Session.__tostring(self)
    return ('Session( id=%d userId=%d )'):format(self:getId(), self:getUserId())
end

--

function Session:getId()
    --[[ Will call an export on an external resource ]]
    return self.id
end

--[[ Include by both the core and external resources ]]
function Session:getUserId()
    --[[ Will call an export on an external resource ]]
    return ox.GetSessionUserId(self:getId())
end