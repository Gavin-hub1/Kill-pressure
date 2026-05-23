@echo off
cd /d "%~dp0"
echo 正在启动烦恼弹弓账户服务...
echo.
node server.js
echo.
echo 服务已停止。按任意键关闭窗口。
pause >nul
