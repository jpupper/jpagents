import { spawn } from 'child_process';
import fs from 'fs';

const hermesPath = 'D:/Programacion/hermes/hermes-agent/.venv/Scripts/hermes.exe';
const workdir = 'd:/Programacion/jpagents';
const query = 'resumen de lo que hiciste';
const args = ['chat', '-q', query, '--verbose'];

const proc = spawn(hermesPath, args, {
    cwd: workdir,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    env: {
        ...process.env,
        HERMES_WORKDIR: workdir
    }
});

let stdout = '';
let stderr = '';

proc.stdout.on('data', (data) => {
    stdout += data.toString();
});

proc.stderr.on('data', (data) => {
    stderr += data.toString();
});

proc.on('close', (code) => {
    console.log("Exit code:", code);
    fs.writeFileSync('scratch/stdout.txt', stdout);
    fs.writeFileSync('scratch/stderr.txt', stderr);
    console.log("Written stdout.txt and stderr.txt");
});
