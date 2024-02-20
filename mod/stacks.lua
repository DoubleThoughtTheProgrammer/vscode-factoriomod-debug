local json = require('__debugadapter__/json.lua')
local threads = require("__debugadapter__/threads.lua")
local dispatch = require("__debugadapter__/dispatch.lua")
local normalizeLuaSource = require("__debugadapter__/normalizeLuaSource.lua")
local variables = require("__debugadapter__/variables.lua")
local stepping = require('__debugadapter__/stepping.lua')
local script = (type(script)=="table" and rawget(script,"__raw")) or script
local debug = debug
local debugprompt = debug.debug
local dgetinfo = debug.getinfo
local dgetlocal = debug.getlocal
local string = string
local sformat = string.format
local ssub = string.sub
local select = select
local __DebugAdapter = __DebugAdapter

---@class DebugAdapter.Stacks
local DAStacks = {}

local sourcelabel = {
  api = function(mod_name,extra) return (extra or "api call").." from "..mod_name end,
}

local function labelframe(i,sourcename,mod_name,extra)
  return {
    id = i,
    name = (sourcelabel[sourcename] or function(mod_name) return "unkown from "..mod_name end)(mod_name,extra),
    presentationHint = "label",
  }
end


---@param threadid integer
---@param startFrame integer | nil
---@param seq integer
function DAStacks.stackTrace(threadid, startFrame, seq)
  if not dispatch.callThread(threadid, "stackTrace", startFrame, seq) then
    -- return empty if can't call...
    json.response{body={},seq=seq}
  end
end
function dispatch.__remote.stackTrace(startFrame, seq)
  local threadid = threads.this_thread
  local offset = 7
  -- 0 getinfo, 1 stackTrace, 2 callThread, 3 stackTrace, 4 debug command, 5 debug.debug,
  -- in normal stepping:                       6 sethook callback, 7 at breakpoint
  -- in exception (instrument only)            6 on_error callback, 7 pCallWithStackTraceMessageHandler, 8 at exception
  -- in remote-redirected call:                2 at stack
  do
    local atprompt = dgetinfo(5,"f")
    if atprompt and atprompt.func == debugprompt then
      local on_ex_info = dgetinfo(6,"f")
      if on_ex_info and on_ex_info.func == stepping.on_exception then
        offset = offset + 1
      end
    else
      offset = 2 -- redirected call
    end
  end


  local i = (startFrame or 0) + offset
  ---@type DebugProtocol.StackFrame[]
  local stackFrames = {}
  while true do
    local info = dgetinfo(i,"nSlutfp")
    if not info then break end
    ---@type string
    local framename = info.name or "(name unavailable)"
    if info.what == "main" then
      framename = "(main chunk)"
    end
    local isC = info.what == "C"
    if isC then
      if framename == "__index" or framename == "__newindex" then
        local describe = variables.describe
        local t = describe(select(2,dgetlocal(i,1)),true)
        local k = describe(select(2,dgetlocal(i,2)),true)
        if framename == "__newindex" then
          local v = describe(select(2,dgetlocal(i,3)),true)
          framename = sformat("__newindex(%s,%s,%s)",t,k,v)
        else
          framename = sformat("__index(%s,%s)",t,k)
        end
      end
    elseif script and framename == "(name unavailable)" then
      local entrypoint = stepping.getEntryLabel(info.func)
      if entrypoint then
        framename = entrypoint
      end
    end
    if info.istailcall then
      framename = sformat("[tail calls...] %s",framename)
    end
    local source = normalizeLuaSource(info.source)
    local sourceIsCode = source == "=(dostring)"
    local noLuaSource = (not sourceIsCode) and ssub(source,1,1) == "="
    local noSource = isC or noLuaSource
    ---@type DebugProtocol.StackFrame
    local stackFrame = {
      id = threadid*1024 + i*4,
      name = framename,
      line = noSource and 0 or info.currentline,
      column = noSource and 0 or 1,
      moduleId = script and script.mod_name or nil,
    }
    if not isC then
      local dasource = {
        name = source,
        path = source,
      }
      if stepping.isStepIgnore(info.func) then
        dasource.presentationHint = "deemphasize"
      end

      stackFrame.currentpc = info.currentpc
      stackFrame.linedefined = info.linedefined

      if sourceIsCode then
        local sourceref = variables.sourceRef(info.source)
        if sourceref then
          dasource = sourceref
        end
      end
      stackFrame.source = dasource
    end
    stackFrames[#stackFrames+1] = stackFrame
    i = i + 1
  end

  json.response{body=stackFrames,seq=seq}
end


---@param frameId integer
---@param seq integer
function DAStacks.scopes(frameId, seq)
  if not dispatch.callFrame(frameId, "scopes", seq) then
    -- return empty if can't call...
    json.response{body={
      { name = "[Thread Unreachable]", variablesReference = 0, expensive=false }
    },seq=seq}
  end
end

---@param i integer
---@param tag integer
---@param seq integer
function dispatch.__remote.scopes(i, tag, seq)
  if tag == 0 and debug.getinfo(i,"f") then
    ---@type DebugProtocol.Scope[]
    local scopes = {}
    -- Locals
    scopes[#scopes+1] = { name = "Locals", variablesReference = variables.scopeRef(i,"Locals"), expensive=false }
    -- Upvalues
    scopes[#scopes+1] = { name = "Upvalues", variablesReference = variables.scopeRef(i,"Upvalues"), expensive=false }
    -- Factorio `global`
    if global then
      scopes[#scopes+1] = { name = "Factorio global", variablesReference = variables.tableRef(global), expensive=false }
    end
    -- Lua Globals
    scopes[#scopes+1] = { name = "Lua Globals", variablesReference = variables.tableRef(_ENV), expensive=false }

    json.response{seq=seq, body=scopes}
  else
    json.response{seq=seq, body={
      { name = "[No Frame]", variablesReference = 0, expensive=false }
    }}
  end
end

return DAStacks