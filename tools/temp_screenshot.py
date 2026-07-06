import base64, io, json
import pyautogui
pyautogui.FAILSAFE = False
import time

time.sleep(1)
img = pyautogui.screenshot(region=(700, 300, 500, 400))
buf = io.BytesIO()
img.save(buf, format='PNG')
b64 = base64.b64encode(buf.getvalue()).decode('ascii')
# Save to file so we can read it
with open(r'D:\Programacion\jpagents\tools\screenshot_b64.txt', 'w') as f:
    f.write(b64)
print(f'Saved {len(b64)} chars to screenshot_b64.txt')
