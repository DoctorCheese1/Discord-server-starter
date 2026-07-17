@echo off
title Updating Palworld

echo Checking for updates...

REM --- Update SteamCMD itself ---
cd /d C:\Users\primeplaymain\Desktop\steamcmd\
echo Updating SteamCMD...
steamcmd.exe +login anonymous +app_update 343050 validate +quit

REM --- Update Palworld server ---
echo Updating Palworld Server...
steamcmd.exe +force_install_dir "C:\Servers\palworld" ^
 +login anonymous ^
 +app_update 2394010 validate ^
 +quit

REM --- Completion marker (ABSOLUTE PATH) ---
echo DONE > "C:\Servers\palworld\update_complete.txt"
