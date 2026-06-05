' TELEGRAM BRIDGE — Loop de Auto-Reinicio
' Corre el Telegram Bridge 24/7. Si crashea, lo reinicia automáticamente.
' El Bridge spawnea el HERMES GOD WORKER como child process.
'
' Para DETENER: ejecutar hermes-god-stop.vbs (en el mismo directorio)
' Para INICIAR: hacer doble click en el acceso directo del escritorio

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\Programacion\jpagents"

' ─── Loop infinito con auto-reinicio ───
Do While True
    ' Ejecuta npm run telegram-bridge (v3 arquitectura)
    ' Params: cmd, windowStyle=0 (oculto), waitOnReturn=True
    WshShell.Run "npm run telegram-bridge", 0, True
    
    ' Si llegamos acá, el proceso terminó (crash/cierre)
    ' Esperar 3 segundos antes de reiniciar
    WScript.Sleep 3000
Loop
