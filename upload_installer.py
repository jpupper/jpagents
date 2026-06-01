import ftplib
import os

local_file = r"D:\Programacion\Volumetric_Suite\compiled\WIN\Volumetric Suite Setup 1.0.0.exe"
remote_dir = "botfiles"
remote_file = "Volumetric Suite Setup 1.0.0.exe"

ftp = ftplib.FTP_TLS('fullscreencode.com')
ftp.login('jpupper@jeyder.com.ar', 'Sarosa2025')
ftp.prot_p()

# Create botfiles dir if not exists
try:
    ftp.cwd(remote_dir)
except ftplib.error_perm:
    ftp.mkd(remote_dir)
    ftp.cwd(remote_dir)

file_size = os.path.getsize(local_file)
print(f"Uploading {file_size / 1024 / 1024:.1f} MB...")

with open(local_file, 'rb') as f:
    ftp.storbinary(f'STOR {remote_file}', f)

ftp.quit()
print("Upload complete!")
