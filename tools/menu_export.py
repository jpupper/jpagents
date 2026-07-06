import pyautogui, time
pyautogui.FAILSAFE = False

# Click on the Figma file name / menu button in the top-left corner of the Figma toolbar
# This opens the main menu with Export option
# Position: approximately X=100, Y=85 (below browser address bar)
time.sleep(1)

# Click the Figma menu (top-left of Figma interface)
pyautogui.click(100, 85)
time.sleep(2)

# Now the menu should be open. Look for "Export" or "File" submenu
# The menu items are listed vertically
# Try clicking on various positions in the dropdown menu
# Menu appears below the toolbar icon, approximately at X=100-300, Y=120-500

# Try "File" option first (usually first item)
pyautogui.click(200, 140)
time.sleep(1)

# Look for Export in submenu
# Export is usually under File > Export or has its own entry
for y in range(200, 500, 25):
    pyautogui.click(200, y)
    time.sleep(0.3)

# After Export is clicked, check for downloaded files
import os
time.sleep(3)
pngs = [f for f in os.listdir(r'C:\Users\JPupper\Downloads') 
        if f.endswith('.png') and os.path.getsize(os.path.join(r'C:\Users\JPupper\Downloads', f)) > 5000
        and os.path.getmtime(os.path.join(r'C:\Users\JPupper\Downloads', f)) > time.time() - 60]
print(f"New PNGs in Downloads: {pngs}")

# Take final screenshot
img = pyautogui.screenshot()
img.save(r'D:\Programacion\jpagents\public\menu_clicked.png')
print("Menu click done")
