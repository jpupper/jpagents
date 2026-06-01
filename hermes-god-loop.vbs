' HERMES GOD — Loop de Auto-Reinicio
' Corre el bot Telegram 24/7. Si crashea, lo reinicia automáticamente.
'
' Para DETENER: ejecutar hermes-god-stop.vbs (en el mismo directorio)
' Para INICIAR: hacer doble click en el acceso directo "HERMES GOD" del escritorio

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\Programacion\jpagents"

' ─── Loop infinito con auto-reinicio ───
Do While True
    ' Ejecuta npm run god-bot
    ' Params: cmd, windowStyle=0 (oculto), waitOnReturn=True
    WshShell.Run "npm run god-bot", 0, True
    
    ' Si llegamos acá, el proceso terminó (crash/cierre)
    ' Esperar 3 segundos antes de reiniciar
    WScript.Sleep 3000
Loop
