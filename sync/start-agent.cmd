@echo off
rem Starts the agent that carries out syncs requested from the website, and keeps a record in agent.log.
cd /d "%~dp0"
echo ---- %date% %time% >> agent.log
node agent.mjs >> agent.log 2>&1
