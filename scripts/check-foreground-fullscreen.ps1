# 检测前台窗口是否全屏或最大化
# 兼容 Windows 7 及以上版本
# 逻辑：只要前台窗口不是桌面，就认为处于最大化/全屏状态

Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class WindowInfo {
      [DllImport("user32.dll")]
      public static extern IntPtr GetForegroundWindow();

      [DllImport("user32.dll")]
      public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
    }
"@

try
{
    $hwnd = [WindowInfo]::GetForegroundWindow()

    if ($hwnd -eq [IntPtr]::Zero)
    {
        Write-Output "False"
        exit 0
    }

    # 获取前台窗口的进程 ID
    $processId = 0
    [WindowInfo]::GetWindowThreadProcessId($hwnd, [ref]$processId)

    # 获取进程信息
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue

    if ($process -eq $null)
    {
        Write-Output "False"
        exit 0
    }

    # 如果进程名是 explorer.exe，说明是桌面
    if ($process.ProcessName -eq "explorer")
    {
        Write-Output "False"
        exit 0
    }

    # 只要不是桌面，就认为处于最大化/全屏状态
    Write-Output "True"
    exit 0
}
catch
{
    Write-Output "False"
    exit 0
}
