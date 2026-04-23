import fs from 'fs/promises';

async function cleanSessions() {
    const sessionsPath = 'd:/Programacion/jpagents/sessions.json';
    try {
        const data = await fs.readFile(sessionsPath, 'utf-8');
        const javaRegex = /java -jar [^"\n]+/g;
        if (javaRegex.test(data)) {
            console.log("Found Java content in sessions.json, cleaning...");
            const cleaned = data.replace(javaRegex, "python -m http.server %puerto%");
            await fs.writeFile(sessionsPath, cleaned, 'utf-8');
            console.log("sessions.json cleaned.");
        } else {
            console.log("No Java content found in sessions.json textually (might be escaped).");
        }
    } catch (e) {
        console.error(e);
    }
}

cleanSessions();
