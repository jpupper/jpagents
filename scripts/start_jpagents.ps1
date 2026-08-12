# Start JP Agents Server
$p1 = Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "server/server.js" -WorkingDirectory $PSScriptRoot -PassThru
Write-Host ("JP Agents Server PID: " + $p1.Id)

# Start MCP Server
$p2 = Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "server/mcp_server.js" -WorkingDirectory $PSScriptRoot -PassThru
Write-Host ("JP Agents MCP PID: " + $p2.Id)

Write-Host "JP Agents started!"
