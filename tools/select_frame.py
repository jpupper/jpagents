import pyautogui, time
pyautogui.FAILSAFE = False

# Click in the LAYERS panel on the left to select a frame
# Left panel is approximately X=0-280, Y=80-1000

# Try clicking on various frame names in the left panel
for y_pos in range(180, 600, 30):
    pyautogui.click(100, y_pos)
    time.sleep(0.2)
    
# After clicking, check if right panel now shows Export section
# Click in the right panel area and scroll down
for y_scroll in range(300, 800, 50):
    # Scroll down in right panel
    pyautogui.moveTo(1750, y_scroll)
    pyautogui.scroll(-5)
    time.sleep(0.1)

# Now try clicking the Export + button at various positions
for x in range(1660, 1780, 20):
    for y in range(600, 900, 30):
        pyautogui.click(x, y)
        time.sleep(0.1)

# Take screenshot
img = pyautogui.screenshot()
img.save(r'D:\Programacion\jpagents\public\after_selection.png')

# Check downloads
import os
new_files = [f for f in os.listdir(r'C:\Users\JPupper\Downloads') 
             if f.endswith('.png') and os.path.getsize(os.path.join(r'C:\Users\JPupper\Downloads', f)) > 1000]
print(f"Recent PNGs: {new_files}")
