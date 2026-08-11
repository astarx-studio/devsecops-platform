' Hidden host launcher for Task Scheduler (no console flash).
Option Explicit
Dim sh, root, cmd
Set sh = CreateObject("WScript.Shell")
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
cmd = """" & root & "\watchdog.cmd"""
sh.Run cmd, 0, True
