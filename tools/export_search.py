import pyautogui, time
pyautogui.FAILSAFE = False

# First, ensure focus on Figma canvas - click center
time.sleep(1)
pyautogui.click(900, 500)
time.sleep(1)

# Open export panel with Ctrl+Shift+E
pyautogui.hotkey('ctrl', 'shift', 'e')
time.sleep(2)

# Try clicking multiple possible locations for Export button
# In Figma web, the export panel opens at bottom-right of canvas
# or in the right sidebar at the bottom

# Strategy 1: Try clicking in the right sidebar where Export section usually is
# Right sidebar is approximately X=1640-1920
# Export section at bottom: Y=600-900

for attempt in range(3):
    # Click on the right panel area to focus it
    pyautogui.click(1750, 400)
    time.sleep(0.5)
    
    # Scroll down in the right panel
    pyautogui.scroll(-10, x=1750, y=400)
    time.sleep(0.5)
    pyautogui.scroll(-10, x=1750, y=500)
    time.sleep(0.5)
    pyautogui.scroll(-10, x=1750, y=600)
    time.sleep(0.5)
    
    # Click where '+' Export button might be 
    pyautogui.click(1700, 750)
    time.sleep(0.5)
    pyautogui.click(1700, 800)
    time.sleep(0.5)

# Take screenshot to see state
img = pyautogui.screenshot()
img.save(r'D:\Programacion\jpagents\public\export_state.png')

# Check downloads
import os
before = set(os.listdir(r'C:\Users\JPupper\Downloads'))
time.sleep(2)
after = set(os.listdir(r'C:\Users\JPupper\Downloads'))
new_files = after - before
print(f"New files in Downloads: {new_files}")
print("Export attempt done")
