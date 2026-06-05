#!/usr/bin/env python3
"""Fix the .join('\\n') line in hermes-god-bot.js."""
with open('hermes-god-bot.js', 'rb') as f:
    c = f.read()

# Replace ].join('\\n');  (two backslashes + n)
# with   ].join('\n');   (one backslash + n)
old = b"\\\\n"
new = b"\\n"

# Find the specific join line context
target = b"].join('"
idx = c.find(target)
if idx >= 0:
    # Read the join argument
    arg_start = idx + len(target)
    arg_end = c.find(b"'", arg_start)
    arg = c[arg_start:arg_end]
    print(f"Join arg bytes: {repr(arg)}")
    
    if arg == b"\\\\n":
        print("Found double-escaped join arg, fixing...")
        c = c[:arg_start] + b"\\n" + c[arg_end:]
        
        with open('hermes-god-bot.js', 'wb') as f:
            f.write(c)
        print("Fixed!")
    else:
        print(f"Unexpected join arg: {repr(arg)}")
else:
    print("Could not find join pattern")
