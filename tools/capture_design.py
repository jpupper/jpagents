import pyautogui, time
pyautogui.FAILSAFE = False
time.sleep(1)

# Asegurar que Figma tiene el foco - click en el canvas
pyautogui.click(900, 500)
time.sleep(1)

# Zoom to fit (Shift+1 or Ctrl+0)
pyautogui.hotkey('ctrl', '0')  # Reset zoom
time.sleep(1)

# Hacer zoom out para ver el diseño completo
for _ in range(5):
    pyautogui.scroll(-5, x=960, y=540)
    time.sleep(0.2)

time.sleep(1)

# Tomar screenshot de alta calidad del area completa del canvas
img = pyautogui.screenshot()
img.save(r'D:\Programacion\caminosysabores\assets\figma\figma_full_design.png')

# Tambien tomar screenshots de secciones especificas
# Area izquierda del canvas
img_l = pyautogui.screenshot(region=(300, 100, 400, 800))
img_l.save(r'D:\Programacion\caminosysabores\assets\figma\figma_left.png')

# Area centro
img_c = pyautogui.screenshot(region=(700, 100, 500, 800))
img_c.save(r'D:\Programacion\caminosysabores\assets\figma\figma_center.png')

# Area derecha
img_r = pyautogui.screenshot(region=(1200, 100, 400, 800))
img_r.save(r'D:\Programacion\caminosysabores\assets\figma\figma_right.png')

import os
saved = [f for f in os.listdir(r'D:\Programacion\caminosysabores\assets\figma') if f.endswith('.png')]
print(f"Saved {len(saved)} screenshots: {saved}")
