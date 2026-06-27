Config = {}

Config.BridgeUrl = GetConvar('s4_doctor_bridge', 'http://127.0.0.1:4789')
Config.BridgePollMs = tonumber(GetConvar('s4_doctor_poll_ms', '500')) or 500
Config.LogBufferSize = tonumber(GetConvar('s4_doctor_log_buffer', '1000')) or 1000
Config.RequestTimeout = tonumber(GetConvar('s4_doctor_timeout', '15000')) or 15000
Config.AllowedTargets = {}
Config.Debug = GetConvar('s4_doctor_debug', 'false') == 'true'
Config.ClientLogBatchMs = tonumber(GetConvar('s4_doctor_log_batch', '250')) or 250
Config.NuiEnabled = GetConvar('s4_doctor_nui', 'true') == 'true'
Config.NuiDefaultFocus = GetConvar('s4_doctor_nui_focus', 'false') == 'true'
Config.NuiSnapshotLimit = tonumber(GetConvar('s4_doctor_nui_snapshot', '200')) or 200
