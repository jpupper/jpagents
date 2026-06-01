' HERMES GOD — DETENER
' Detiene HERMES GOD: mata el loop y el proceso node.

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Usar PowerShell para encontrar y matar procesos específicos
' Buscar wscript corriendo hermes-god-loop
' Buscar node corriendo god-bot

Dim psScript
psScript = "$procs = @(); " & _
  "$procs += Get-WmiObject Win32_Process -Filter ""name='wscript.exe'"" | Where-Object { $_.CommandLine -like '*hermes-god-loop*' } | ForEach-Object { $_.Terminate(); 'kill wscript PID=' + $_.ProcessId }; " & _
  "$procs += Get-WmiObject Win32_Process -Filter ""name='node.exe'"" | Where-Object { $_.CommandLine -like '*god-bot*' } | ForEach-Object { $_.Terminate(); 'kill node PID=' + $_.ProcessId }; " & _
  "if ($procs.Count -eq 0) { 'No se encontraron procesos de HERMES GOD' } else { $procs -join '; ' }"

Dim tempFile
tempFile = "D:\Programacion\jpagents\_god_stop_result.txt"

WshShell.Run "powershell -ExecutionPolicy Bypass -Command """ & psScript & """ > """ & tempFile & """", 0, True
WScript.Sleep 1000

Dim result
result = ""

If fso.FileExists(tempFile) Then
    Dim stream
    Set stream = fso.OpenTextFile(tempFile, 1)
    result = stream.ReadAll()
    stream.Close()
    fso.DeleteFile(tempFile)
End If

MsgBox "HERMES GOD detenido." & vbCrLf & vbCrLf & result & vbCrLf & vbCrLf & "Para reiniciar: doble click en 'HERMES GOD' del escritorio.", vbInformation, "HERMES GOD - Detenido"
