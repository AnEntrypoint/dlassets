@echo off
if not exist "%~dp0downloads" mkdir "%~dp0downloads"
if not exist "%~dp0output" mkdir "%~dp0output"
"%ProgramFiles%\Blender Foundation\Blender 5.0\blender.exe" --background --python "%~dp0convert.py"
pause
