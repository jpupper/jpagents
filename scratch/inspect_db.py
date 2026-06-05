import sqlite3
db_path = 'C:/Users/JPupper/.hermes/state.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("SELECT session_id, role, content FROM messages ORDER BY timestamp DESC LIMIT 10")
for row in cursor.fetchall():
    print(f"Session: {row[0]}, Role: {row[1]}, Content: {row[2]!r}")
