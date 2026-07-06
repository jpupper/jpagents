import pyautogui, time
pyautogui.FAILSAFE = False

# Matar Chrome
time.sleep(0.5)
pyautogui.hotkey('alt', 'f4')
time.sleep(1)
pyautogui.hotkey('alt', 'f4')
time.sleep(1)

# Abrir Chrome con URL de Figma via Win+R
pyautogui.hotkey('win', 'r')
time.sleep(0.5)
cmd = 'cmd /c start chrome --new-window "https://www.figma.com/design/UgSxrXuCd9YgioZl6eqsZU/caminosysabores?node-id=40-2652"'
pyautogui.write(cmd, interval=0.005)
time.sleep(0.3)
pyautogui.press('enter')
print("Chrome opened with Figma URL")
time.sleep(2)
pyautogui.press('escape')
time.sleep(1)

# If profile screen appears, press Enter to select default
pyautogui.press('enter')
time.sleep(3)

# Wait for Figma to load
time.sleep(15)

# Maximize
pyautogui.hotkey('win', 'up')
time.sleep(1)

# Click canvas for focus
pyautogui.click(900, 500)
time.sleep(1)

# Export: Ctrl+Shift+E
pyautogui.hotkey('ctrl', 'shift', 'e')
time.sleep(2)

# Click possible export button positions in right panel
# Try multiple positions
for x, y in [(1680, 780), (1700, 800), (1650, 750), (1750, 820), (1700, 850)]:
    pyautogui.click(x, y)
    time.sleep(0.5)

# Press Enter a few times
pyautogui.press('enter')
time.sleep(1)

# Take final screenshot
img = pyautogui.screenshot()
img.save(r'D:\Programacion\jpagents\public\final_export.png')

# Check if any file was downloaded
import os
files = os.listdir(r'C:\Users\JPupper\Downloads')
pngs = [f for f in files if f.endswith('.png') and 'figma' in f.lower()]
jpgs = [f for f in files if f.endswith('.jpg') or f.endswith('.jpeg')]
print(f"Downloads - PNGs: {pngs}")
print(f"Downloads - JPGs: {jpgs}")
print("Export attempt complete")
