"""
Desktop Automation Engine for JP Agents
Provides low-level desktop control: mouse, keyboard, screen capture, window management.
Used by the MCP server to give Hermes Agent full desktop control capabilities.
"""

import json
import sys
import base64
import io
import subprocess
import os

# ============================================================
#  HELPERS
# ============================================================

def _load_pyautogui():
    """Lazy import — only pay import cost when a tool actually runs."""
    # FAILSAFE = False allows moving to corners without triggering abort
    import pyautogui
    pyautogui.FAILSAFE = False  # Don't abort on corner move
    return pyautogui


def _error(msg):
    return {"success": False, "error": str(msg)}


# ============================================================
#  COMMAND HANDLERS
# ============================================================

def handle_click(args):
    """Click at screen coordinates. Supports left/right/middle, single/double."""
    pg = _load_pyautogui()
    x = args["x"]
    y = args["y"]
    button = args.get("button", "left")
    clicks = args.get("clicks", 1)
    pg.click(x, y, clicks=clicks, button=button)
    return {"success": True, "action": "click", "x": x, "y": y, "button": button, "clicks": clicks}


def handle_move(args):
    """Move mouse to coordinates."""
    pg = _load_pyautogui()
    x = args["x"]
    y = args["y"]
    duration = args.get("duration", 0.0)
    pg.moveTo(x, y, duration=duration)
    return {"success": True, "action": "move", "x": x, "y": y}


def handle_type(args):
    """Type text as if typed on keyboard. Supports interval between keystrokes."""
    pg = _load_pyautogui()
    text = args["text"]
    interval = args.get("interval", 0.02)
    pg.typewrite(text, interval=interval)
    return {"success": True, "action": "type", "length": len(text)}


def handle_press(args):
    """Press a single key or key combination (hotkey)."""
    pg = _load_pyautogui()
    keys = args["keys"]
    if isinstance(keys, list):
        # key combo like ["ctrl", "c"]
        pg.hotkey(*keys)
        return {"success": True, "action": "hotkey", "keys": "+".join(keys)}
    else:
        pg.press(keys)
        return {"success": True, "action": "press", "key": keys}


def handle_screenshot(args):
    """Take screenshot: full screen or of a region [x, y, w, h]."""
    pg = _load_pyautogui()
    region = args.get("region")  # [x, y, w, h] tuple or None
    if region:
        img = pg.screenshot(region=tuple(region))
    else:
        img = pg.screenshot()

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return {"success": True, "action": "screenshot", "width": img.width, "height": img.height, "image_base64": b64}


def handle_position(args):
    """Get current mouse cursor position."""
    pg = _load_pyautogui()
    x, y = pg.position()
    return {"success": True, "x": x, "y": y}


def handle_size(args):
    """Get screen resolution."""
    pg = _load_pyautogui()
    w, h = pg.size()
    return {"success": True, "width": w, "height": h}


def handle_open_app(args):
    """Open an application by name via Win+R dialog."""
    pg = _load_pyautogui()
    app = args["app"]
    pg.hotkey("win", "r")
    pg.sleep(0.4)
    pg.typewrite(app, interval=0.02)
    pg.sleep(0.2)
    pg.press("enter")
    return {"success": True, "action": "open_app", "app": app}


def handle_scroll(args):
    """Scroll mouse wheel. Positive = up, negative = down."""
    pg = _load_pyautogui()
    amount = args.get("amount", -3)
    x = args.get("x")
    y = args.get("y")
    if x is not None and y is not None:
        pg.scroll(amount, x=x, y=y)
    else:
        pg.scroll(amount)
    return {"success": True, "action": "scroll", "amount": amount}


def handle_drag(args):
    """Drag from one point to another."""
    pg = _load_pyautogui()
    x1, y1 = args["from_x"], args["from_y"]
    x2, y2 = args["to_x"], args["to_y"]
    duration = args.get("duration", 0.5)
    button = args.get("button", "left")
    pg.moveTo(x1, y1)
    pg.drag(x2 - x1, y2 - y1, duration=duration, button=button)
    return {"success": True, "action": "drag", "from": [x1, y1], "to": [x2, y2]}


def handle_locate(args):
    """Find an image on screen. Returns position if found."""
    pg = _load_pyautogui()
    image_path = args["image"]
    confidence = args.get("confidence", 0.9)
    if not os.path.isfile(image_path):
        return _error(f"Image file not found: {image_path}")
    try:
        loc = pg.locateOnScreen(image_path, confidence=confidence)
    except Exception as e:
        return _error(f"locateOnScreen failed: {e}")
    if loc:
        center = pg.center(loc)
        return {
            "success": True,
            "found": True,
            "x": loc.left, "y": loc.top,
            "width": loc.width, "height": loc.height,
            "center_x": center.x, "center_y": center.y
        }
    return {"success": True, "found": False}


def handle_keydown(args):
    """Hold a key down."""
    pg = _load_pyautogui()
    key = args["key"]
    pg.keyDown(key)
    return {"success": True, "action": "keyDown", "key": key}


def handle_keyup(args):
    """Release a key."""
    pg = _load_pyautogui()
    key = args["key"]
    pg.keyUp(key)
    return {"success": True, "action": "keyUp", "key": key}


def handle_mouse_down(args):
    """Press and hold mouse button."""
    pg = _load_pyautogui()
    x = args.get("x")
    y = args.get("y")
    button = args.get("button", "left")
    if x is not None and y is not None:
        pg.mouseDown(x=x, y=y, button=button)
    else:
        pg.mouseDown(button=button)
    return {"success": True, "action": "mouseDown", "button": button}


def handle_mouse_up(args):
    """Release mouse button."""
    pg = _load_pyautogui()
    button = args.get("button", "left")
    pg.mouseUp(button=button)
    return {"success": True, "action": "mouseUp", "button": button}


# ============================================================
#  ROUTER
# ============================================================

HANDLERS = {
    "click":        handle_click,
    "move":         handle_move,
    "type":         handle_type,
    "press":        handle_press,
    "screenshot":   handle_screenshot,
    "position":     handle_position,
    "size":         handle_size,
    "open_app":     handle_open_app,
    "scroll":       handle_scroll,
    "drag":         handle_drag,
    "locate":       handle_locate,
    "keydown":      handle_keydown,
    "keyup":        handle_keyup,
    "mouse_down":   handle_mouse_down,
    "mouse_up":     handle_mouse_up,
}


def handle_command(cmd):
    """Route a command dict -> result dict."""
    action = cmd.get("action", "")
    args = cmd.get("args", {})

    if not action:
        return _error("Missing 'action' field")

    handler = HANDLERS.get(action)
    if not handler:
        return _error(f"Unknown action: {action}. Available: {list(HANDLERS.keys())}")

    try:
        return handler(args)
    except Exception as e:
        return _error(f"Action '{action}' failed: {e}")


# ============================================================
#  MAIN (called as subprocess from Node.js)
# ============================================================

if __name__ == "__main__":
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            print(json.dumps(_error("Empty input")))
            sys.exit(1)
        cmd = json.loads(raw)
        result = handle_command(cmd)
        print(json.dumps(result))
    except json.JSONDecodeError as e:
        print(json.dumps(_error(f"Invalid JSON input: {e}")))
        sys.exit(1)
    except Exception as e:
        print(json.dumps(_error(f"Unexpected error: {e}")))
        sys.exit(1)
