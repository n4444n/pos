; สคริปต์เสริมของตัวติดตั้ง (electron-builder -> nsis.include)
;
; ปัญหาที่แก้: ตอนติดตั้งทับรุ่นเก่า NSIS จะสั่งถอนรุ่นเก่าออกก่อน
; ถ้าโปรแกรมยังเปิดค้างอยู่ (หรือค้างใน Task Manager หลังอัปเดต) ไฟล์จะถูกล็อก
; ลบไม่ได้ ตัวติดตั้งจึงขึ้นว่า
;   Failed to uninstall old application files. Please try running the installer again.: 2
; ทางแก้: ปิดโปรแกรมให้เรียบร้อยก่อน ทั้งตอนติดตั้งและตอนถอนการติดตั้ง

!ifndef POS_EXE
  !ifdef PRODUCT_FILENAME
    !define POS_EXE "${PRODUCT_FILENAME}.exe"
  !else
    !define POS_EXE "Clothing POS.exe"
  !endif
!endif

!macro posCloseApp
  DetailPrint "Closing running application..."
  ; ขอปิดแบบปกติก่อน (ให้โปรแกรมเซฟงานค้างได้)
  nsExec::Exec 'taskkill /im "${POS_EXE}" /t'
  Pop $0
  Sleep 1500
  ; ยังไม่ปิด -> บังคับปิด ไม่งั้นลบไฟล์รุ่นเก่าไม่ได้
  nsExec::Exec 'taskkill /f /im "${POS_EXE}" /t'
  Pop $0
  Sleep 1200
!macroend

; ก่อนเริ่มติดตั้ง - รันก่อนขั้นตอนถอนรุ่นเก่า
!macro customInit
  !insertmacro posCloseApp
!macroend

; ก่อนเริ่มถอนการติดตั้ง - รวมถึงตอนที่ตัวติดตั้งใหม่เรียกตัวถอนรุ่นเก่า
!macro customUnInit
  !insertmacro posCloseApp
!macroend
