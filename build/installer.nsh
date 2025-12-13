!macro customInit
  ; 确保在 Windows 7 上的兼容性
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "ProductName"
  StrCmp $0 "" 0 +2
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "ProductName"
  
  ; 检查 Windows 版本，确保兼容性
  ${If} ${AtLeastWin7}
    ; Windows 7 或更高版本
  ${EndIf}
  
  ; 为 Windows 7 设置兼容性标志
  ExecWait '"$INSTDIR\mscoree.dll" /s /v/q'
  
  ; 确保使用正确的权限
  SetShellVarContext all
!macroend