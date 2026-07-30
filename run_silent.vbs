' Полностью тихий запуск Pulse Messenger — без черного окна консоли.
' Используй ПОСЛЕ того, как один раз запустил install_and_run.bat
' и убедился, что всё работает (там видно, если чего-то не хватает).
'
' Можно закинуть ярлык на этот файл в папку автозагрузки Windows
' (Win+R -> shell:startup), чтобы сервер поднимался сам при включении ПК.

Set objShell = CreateObject("WScript.Shell")
Set objFSO   = CreateObject("Scripting.FileSystemObject")
strFolder = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Запускаем сервер через pythonw (без консольного окна), 0 = скрыто, False = не ждать завершения
objShell.CurrentDirectory = strFolder
objShell.Run "pythonw " & Chr(34) & strFolder & "\app.py" & Chr(34), 0, False

' Ждём, пока сервер поднимется, и открываем страницу
WScript.Sleep 4000
objShell.Run "http://localhost:8000", 1, False
