import ftplib
import os

ftp = ftplib.FTP_TLS('fullscreencode.com')
ftp.login('jpupper@jeyder.com.ar', 'Sarosa2025')
ftp.prot_p()

# Check existing dirs
print("Root listing:")
for f in ftp.nlst(''):
    print(f"  {f}")

# Create subdirectory for this project
try:
    ftp.mkd('procedural-3d')
    print("Created directory: procedural-3d")
except ftplib.error_perm as e:
    print(f"Directory may already exist: {e}")

# Upload the file
local_path = 'D:/Programacion/jpagents/procedural-3d.html'
with open(local_path, 'rb') as f:
    ftp.storbinary('STOR procedural-3d/index.html', f)
print("Uploaded: procedural-3d/index.html")

# Verify
local_size = os.path.getsize(local_path)
print(f"Local file size: {local_size} bytes")

# List remote dir
print("\nRemote directory:")
for f in ftp.nlst('procedural-3d'):
    print(f"  {f}")

ftp.quit()
print("\nDone!")
