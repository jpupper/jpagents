/**
 * JP Agents - Electron Main Process
 *
 * Gestiona:
 *  - Setup wizard en primera ejecucion
 *  - Arranque del servidor JP Agents (Node.js)
 *  - Ventana principal con la Web UI
 *  - Integracion con Hermes Gateway
 */

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync, fork } = require('child_process');
const readline = require('readline');

// ─── Rutas ────────────────────────────────────────────────
const IS_DEV = process.argv.includes('--dev') || !app.isPackaged;
const ROOT_DIR = IS_DEV
  ? path.resolve(__dirname, '..')  // desarrollo: raiz del proyecto jpagents
  : path.resolve(process.resourcesPath, 'jpagents');  // empaquetado

// Archivos de config en directorio de usuario (writable siempre)
const DATA_DIR = IS_DEV
  ? ROOT_DIR
  : path.join(app.getPath('userData'), 'jp-agents-config');

// Asegurar que DATA_DIR existe desde el inicio
function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {
    console.error('[ELECTRON] No se pudo crear DATA_DIR:', e.message);
  }
}
ensureDataDir();

const ENV_FILE = path.join(DATA_DIR, '.env');
const CONFIG_FILE = path.join(DATA_DIR, '.jp-agents-config.json');
const SETUP_DONE_FILE = path.join(DATA_DIR, '.setup-done');
const HERMES_INSTALLED_FILE = path.join(DATA_DIR, '.hermes-installed');
const NODE_EXE = process.execPath;  // mismo Node que Electron
const SERVER_SCRIPT = path.join(ROOT_DIR, 'server', 'server.js');
const MCP_SERVER_SCRIPT = path.join(ROOT_DIR, 'server', 'mcp_server.js');
const FRONTEND_URL = 'http://localhost:4699';

let mainWindow = null;
let setupWindow = null;
let tray = null;
let serverProcess = null;
let mcpProcess = null;
let gatewayProcess = null;

// ─── Config ───────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Error loading config:', e.message);
  }
  return {};
}

function saveConfig(config) {
  try {
    ensureDataDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving config:', e.message);
  }
}

function isFirstRun() {
  return !fs.existsSync(SETUP_DONE_FILE);
}

function markSetupDone() {
  ensureDataDir();
  fs.writeFileSync(SETUP_DONE_FILE, new Date().toISOString(), 'utf-8');
}

function writeEnvFile(settings) {
  ensureDataDir();
  let envContent = '';
  // Cargar .env existente si hay
  if (fs.existsSync(ENV_FILE)) {
    envContent = fs.readFileSync(ENV_FILE, 'utf-8');
  }

  const updates = {
    'OPENAI_API_KEY': settings.apiKey || '',
    'OPENAI_BASE_URL': settings.apiEndpoint || '',
    'JPAGENTS_PORT': String(settings.port || 4699),
    'DEFAULT_MODEL': settings.model || 'gpt-4o',
    'API_PROVIDER': settings.provider || 'openai',
  };

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*`, 'm');
    const line = `${key}=${value}`;
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, line);
    } else {
      envContent += (envContent.endsWith('\n') ? '' : '\n') + line;
    }
  }

  // Si el usuario eligio Ollama, configurar default
  if (settings.provider === 'ollama') {
    const ollamaLines = {
      'OLLAMA_BASE_URL': 'http://localhost:11434',
      'DEFAULT_MODEL': settings.model || 'llama3.2',
      'OPENAI_API_KEY': 'ollama',
      'OPENAI_BASE_URL': 'http://localhost:11434/v1',
    };
    for (const [k, v] of Object.entries(ollamaLines)) {
      const regex = new RegExp(`^${k}=.*`, 'm');
      const line = `${k}=${v}`;
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, line);
      } else {
        envContent += '\n' + line;
      }
    }
  }

  // Si el usuario eligio Deepseek, configurar endpoint
  if (settings.provider === 'deepseek') {
    const dsEndpoint = settings.apiEndpoint || 'https://api.deepseek.com/v1';
    const dsLines = {
      'OPENAI_BASE_URL': dsEndpoint,
      'DEFAULT_MODEL': settings.model || 'deepseek-chat',
    };
    for (const [k, v] of Object.entries(dsLines)) {
      const regex = new RegExp(`^${k}=.*`, 'm');
      const line = `${k}=${v}`;
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, line);
      } else {
        envContent += '\n' + line;
      }
    }
  }

  fs.writeFileSync(ENV_FILE, envContent.trimStart() + '\n', 'utf-8');
  console.log('[ELECTRON] .env escrito correctamente');
}

// ─── Setup Window ────────────────────────────────────────
function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 720,
    height: 620,
    resizable: false,
    frame: true,
    autoHideMenuBar: true,
    title: 'JP Agents - Configuracion Inicial',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setupWindow.loadFile(path.join(__dirname, 'setup', 'index.html'));
  setupWindow.setMenuBarVisibility(false);

  if (IS_DEV) {
    setupWindow.webContents.openDevTools({ mode: 'detach' });
  }

  setupWindow.on('closed', () => {
    setupWindow = null;
  });
}

// ─── Main Window ─────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'JP Agents',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    backgroundColor: '#0f0f1a',
  });

  mainWindow.loadURL(FRONTEND_URL);

  let windowShown = false;

  function showWindow() {
    if (!windowShown && mainWindow && !mainWindow.isDestroyed()) {
      windowShown = true;
      mainWindow.show();
      if (IS_DEV) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
  }

  mainWindow.once('ready-to-show', showWindow);

  // Fallback: mostrar ventana aunque el server no responda
  setTimeout(() => {
    if (!windowShown && mainWindow && !mainWindow.isDestroyed()) {
      console.log('[ELECTRON] Mostrando ventana por timeout (server puede tardar)');
      showWindow();
      mainWindow.webContents.reloadIgnoringCache();
    }
  }, 15000);

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log(`[ELECTRON] Fallo carga de URL (${errorCode}): ${errorDescription}`);
    // Si ya pasaron 5 segundos, mostrar la ventana igual
    setTimeout(() => {
      if (!windowShown && mainWindow && !mainWindow.isDestroyed()) {
        showWindow();
        setTimeout(() => mainWindow.webContents.reload(), 2000);
      }
    }, 5000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (e) => {
    if (tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ─── JP Agents Server ────────────────────────────────────
function startJpAgents() {
  return new Promise((resolve, reject) => {
    const config = loadConfig();
    const port = config.port || 4699;

    console.log(`[ELECTRON] Iniciando JP Agents server en puerto ${port}...`);
    console.log(`[ELECTRON] Directorio: ${ROOT_DIR}`);
    console.log(`[ELECTRON] Datos de config: ${DATA_DIR}`);

    // Copiar .env desde DATA_DIR a ROOT_DIR para que el servidor lo encuentre
    if (fs.existsSync(ENV_FILE)) {
      try {
        const targetEnv = path.join(ROOT_DIR, '.env');
        fs.copyFileSync(ENV_FILE, targetEnv);
        console.log(`[ELECTRON] .env copiado a ${targetEnv}`);
      } catch (e) {
        console.warn('[ELECTRON] No se pudo copiar .env:', e.message);
      }
    }

    // Verificar que el archivo del server existe
    if (!fs.existsSync(SERVER_SCRIPT)) {
      const error = new Error(`Archivo server.js no encontrado en: ${SERVER_SCRIPT}`);
      console.error('[ELECTRON]', error.message);
      reject(error);
      return;
    }

    // Iniciar el servidor principal usando fork() para evitar abrir otra ventana Electron
    serverProcess = fork(SERVER_SCRIPT, [], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        JPAGENTS_PORT: String(port),
        ELECTRON_RUN: 'true',
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      silent: true,
    });

    serverProcess.stdout.on('data', (data) => {
      const text = data.toString();
      console.log(`[SERVER] ${text.trim()}`);
      // Detectar cuando el servidor esta listo
      if (text.includes('listening') || text.includes('Server running') || text.includes(`:${port}`)) {
        setTimeout(() => resolve(port), 1000);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const text = data.toString();
      if (text.includes('ExperimentalWarning') || text.includes('DeprecationWarning')) return;
      console.error(`[SERVER-ERR] ${text.trim()}`);
    });

    serverProcess.on('error', (err) => {
      console.error(`[ELECTRON] Error al iniciar servidor:`, err.message);
      reject(err);
    });

    serverProcess.on('exit', (code, signal) => {
      console.log(`[ELECTRON] Servidor terminado (code: ${code}, signal: ${signal})`);
      serverProcess = null;
    });

    // Timeout de 30s para que el servidor arranque
    setTimeout(() => {
      // Si no detectamos "listening", igual intentamos
      console.log('[ELECTRON] Timeout de deteccion, intentando conectar de todas formas...');
      resolve(port);
    }, 30000);
  });
}

// ─── Hermes Gateway ──────────────────────────────────────
function installHermesGateway() {
  return new Promise((resolve, reject) => {
    const hermesDir = path.join(DATA_DIR, 'hermes-gateway');
    const venvDir = path.join(hermesDir, 'venv');

    function sendProgress(msg, pct, done) {
      try {
        if (setupWindow && !setupWindow.isDestroyed()) {
          setupWindow.webContents.send('gateway:install-progress', { message: msg, percent: pct });
        }
      } catch (e) { /* ignore */ }
    }

    function sendComplete(success, msg, details) {
      try {
        if (setupWindow && !setupWindow.isDestroyed()) {
          setupWindow.webContents.send('gateway:install-complete', { success, message: msg, ...details });
        }
      } catch (e) { /* ignore */ }
    }

    sendProgress('Preparando instalacion de Hermes Gateway...', 0);

    // 1. Detectar Python
    const pythonCandidates = ['python3', 'python', 'py'];
    let pythonExe = null;

    for (const cmd of pythonCandidates) {
      try {
        execSync(`${cmd} --version`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
        pythonExe = cmd;
        break;
      } catch (e) { /* try next */ }
    }

    if (!pythonExe) {
      sendProgress('Python no encontrado', 100, true);
      sendComplete(false, 'Python no esta instalado. Instala Python 3.10+ desde python.org y vuelve a intentar.', {
        needPython: true,
      });
      reject(new Error('Python not found'));
      return;
    }

    sendProgress(`Python detectado: ${pythonExe}`, 5);

    // 2. Crear directorio
    try {
      fs.mkdirSync(hermesDir, { recursive: true });
    } catch (e) {
      sendComplete(false, `No se pudo crear directorio: ${e.message}`);
      reject(e);
      return;
    }

    sendProgress('Creando entorno virtual...', 10);

    // 3. Crear venv
    try {
      execSync(`${pythonExe} -m venv "${venvDir}"`, {
        encoding: 'utf-8',
        timeout: 60000,
        stdio: 'pipe',
      });
    } catch (e) {
      sendComplete(false, `Error al crear entorno virtual: ${e.message}`);
      reject(e);
      return;
    }

    sendProgress('Entorno virtual creado. Instalando hermes-agent...', 20);

    // 4. Determinar pip del venv
    const pipExe = process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'pip.exe')
      : path.join(venvDir, 'bin', 'pip');

    const hermesExe = process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'hermes.exe')
      : path.join(venvDir, 'bin', 'hermes');

    // 5. Instalar hermes-agent
    const installProcess = spawn(pipExe, ['install', 'hermes-agent'], {
      cwd: hermesDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let installOutput = '';

    installProcess.stdout.on('data', (data) => {
      const text = data.toString();
      installOutput += text;
      // Parse progress from pip output
      const lines = text.trim().split('\n');
      for (const line of lines) {
        if (line.includes('Collecting') || line.includes('Installing') || line.includes('Downloading')) {
          sendProgress(line.trim(), 25);
        }
      }
    });

    installProcess.stderr.on('data', (data) => {
      installOutput += data.toString();
    });

    installProcess.on('error', (err) => {
      sendComplete(false, `Error de instalacion: ${err.message}`);
      reject(err);
    });

    installProcess.on('exit', (code) => {
      if (code !== 0) {
        // Try to extract meaningful error
        const errorMsg = installOutput
          .split('\n')
          .filter(l => l.toLowerCase().includes('error') || l.toLowerCase().includes('failed'))
          .slice(0, 3)
          .join(' | ');

        sendComplete(false,
          `Error al instalar hermes-agent (codigo: ${code}). ${errorMsg || 'Revisa la consola para mas detalles.'}`,
          { output: installOutput.slice(-500) }
        );
        reject(new Error(`pip install exited with code ${code}`));
        return;
      }

      sendProgress('hermes-agent instalado correctamente', 80);

      // 6. Verificar que hermes.exe existe
      if (fs.existsSync(hermesExe)) {
        sendProgress('Gateway instalado y verificado', 100);

        // Guardar ruta para referencia
        const config = loadConfig();
        config.hermesGatewayPath = hermesExe;
        config.hermesGatewayDir = hermesDir;
        saveConfig(config);

        sendComplete(true, 'Hermes Gateway instalado correctamente!', {
          path: hermesExe,
        });

        resolve({
          success: true,
          path: hermesExe,
          message: 'Hermes Gateway instalado correctamente',
        });
      } else {
        sendProgress('Verificando instalacion...', 90);
        // Esperar un momento y verificar de nuevo
        setTimeout(() => {
          if (fs.existsSync(hermesExe)) {
            sendComplete(true, 'Hermes Gateway instalado correctamente!', { path: hermesExe });
            resolve({ success: true, path: hermesExe });
          } else {
            sendComplete(true, 'Parece que se instalo pero no se encuentra el ejecutable. Probablemente necesitas reiniciar.', {
              path: hermesDir,
              partial: true,
            });
            resolve({ success: true, path: hermesDir, partial: true });
          }
        }, 2000);
      }
    });
  });
}

function findHermesGateway() {
  // Buscar hermes.exe en ubicaciones conocidas
  const paths = [
    path.join(DATA_DIR, 'hermes-gateway', 'venv', 'Scripts', 'hermes.exe'),
    path.join(DATA_DIR, 'hermes-gateway', 'venv', 'bin', 'hermes'),
    path.join(ROOT_DIR, 'hermes-gateway', 'venv', 'Scripts', 'hermes.exe'),
    path.join(ROOT_DIR, 'hermes-gateway', 'venv', 'bin', 'hermes'),
    path.join(ROOT_DIR, 'hermes', 'venv', 'Scripts', 'hermes.exe'),
    path.join(ROOT_DIR, '.hermes', 'hermes-agent', '.venv', 'Scripts', 'hermes.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', '.venv', 'Scripts', 'hermes.exe'),
    path.join(process.env.USERPROFILE || '', '.hermes', 'hermes-agent', '.venv', 'Scripts', 'hermes.exe'),
    path.join(process.env.USERPROFILE || '', '.hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isGatewayRunning() {
  try {
    if (process.platform === 'win32') {
      const result = execSync('netstat -ano | findstr ":8642 " | findstr LISTENING', {
        encoding: 'utf-8',
        timeout: 3000,
      });
      return result.trim().length > 0;
    }
  } catch (e) {
    return false;
  }
  return false;
}

// ─── Tray Icon ───────────────────────────────────────────
function createTray() {
  // Crear un icono de tray simple
  tray = new Tray(path.join(__dirname, 'assets', 'icon.ico'));
  tray.setToolTip('JP Agents');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir JP Agents',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Estado del Servidor',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Reiniciar Servidor',
      click: async () => {
        await stopServer();
        await startJpAgents();
        if (mainWindow) mainWindow.loadURL(FRONTEND_URL);
      },
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        tray = null;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── Hermes Config & Start ────────────────────────────────
async function configureHermes(apiProvider, apiKey, apiEndpoint, model) {
  const hermesExe = findHermesGateway();
  if (!hermesExe) return { success: false, message: 'Hermes no esta instalado' };

  try {
    const hermesDir = path.dirname(path.dirname(hermesExe)); // venv/Scripts/hermes.exe -> venv

    // Mapear proveedores a los nombres de Hermes
    const providerMap = {
      'openai': 'openai',
      'ollama': 'ollama',
      'custom': 'custom',
      'deepseek': 'deepseek',

    };
    const hProvider = providerMap[apiProvider] || 'openai';

    // 1. Configurar provider
    execSync(`"${hermesExe}" config set provider ${hProvider}`, {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    });

    // 2. Configurar modelo por defecto
    if (model) {
      execSync(`"${hermesExe}" config set model ${model}`, {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: 'pipe',
      });
    }

    // 3. Configurar API key en el .env de Hermes
    if (apiKey) {
      const hermesEnvPath = path.join(os.homedir(), '.hermes', '.env');
      try { fs.mkdirSync(path.dirname(hermesEnvPath), { recursive: true }); } catch (e) {}

      let envContent = '';
      if (fs.existsSync(hermesEnvPath)) {
        envContent = fs.readFileSync(hermesEnvPath, 'utf-8');
      }

      // Agregar/quitar la API key
      const keyVar = hProvider === 'openai' ? 'OPENAI_API_KEY'
        : hProvider === 'ollama' ? 'OLLAMA_API_KEY'
        : 'OPENAI_API_KEY';

      const regex = new RegExp(`^${keyVar}=.*`, 'm');
      const line = `${keyVar}=${apiKey}`;
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, line);
      } else {
        envContent += (envContent.endsWith('\n') ? '' : '\n') + line;
      }

      // Si tiene endpoint personalizado
      if (apiEndpoint && apiEndpoint !== 'https://api.openai.com/v1') {
        const baseUrlRegex = /^OPENAI_BASE_URL=.*/m;
        const baseUrlLine = `OPENAI_BASE_URL=${apiEndpoint}`;
        if (baseUrlRegex.test(envContent)) {
          envContent = envContent.replace(baseUrlRegex, baseUrlLine);
        } else {
          envContent += '\n' + baseUrlLine;
        }
      }

      fs.writeFileSync(hermesEnvPath, envContent.trimStart() + '\n', 'utf-8');
    }

    return { success: true, message: 'Hermes configurado correctamente' };
  } catch (err) {
    console.error('[ELECTRON] Error configurando Hermes:', err.message);
    return { success: false, message: err.message };
  }
}

function startHermesGateway() {
  const hermesExe = findHermesGateway();
  if (!hermesExe) {
    console.log('[ELECTRON] Hermes no instalado, no se puede iniciar gateway');
    return null;
  }

  if (isGatewayRunning()) {
    console.log('[ELECTRON] Gateway ya esta corriendo');
    return true;
  }

  console.log('[ELECTRON] Iniciando Hermes Gateway...');

  try {
    gatewayProcess = spawn(hermesExe, ['gateway', 'run', '--accept-hooks'], {
      cwd: ROOT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
      env: {
        ...process.env,
        HERMES_ACCEPT_HOOKS: '1',
      },
    });

    gatewayProcess.stdout.on('data', (data) => {
      const text = data.toString();
      console.log(`[GATEWAY] ${text.trim()}`);
    });

    gatewayProcess.stderr.on('data', (data) => {
      const text = data.toString();
      if (text.includes('Started') || text.includes('listening')) {
        console.log(`[GATEWAY] Gateway started successfully`);
      }
      console.log(`[GATEWAY-ERR] ${text.trim()}`);
    });

    gatewayProcess.on('error', (err) => {
      console.error('[GATEWAY] Error:', err.message);
      gatewayProcess = null;
    });

    gatewayProcess.on('exit', (code, signal) => {
      console.log(`[GATEWAY] Terminado (code: ${code}, signal: ${signal})`);
      gatewayProcess = null;
    });

    return true;
  } catch (err) {
    console.error('[ELECTRON] Error iniciando gateway:', err.message);
    return false;
  }
}

// ─── Stop Server ─────────────────────────────────────────
function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
  if (mcpProcess) {
    mcpProcess.kill('SIGTERM');
    mcpProcess = null;
  }
  if (gatewayProcess) {
    gatewayProcess.kill('SIGTERM');
    gatewayProcess = null;
  }
}

// ─── IPC Handlers ────────────────────────────────────────
function setupIpcHandlers() {
  ipcMain.handle('config:get', () => {
    return loadConfig();
  });

  ipcMain.handle('config:save', (event, config) => {
    saveConfig(config);
    writeEnvFile(config);
    return { ok: true };
  });

  ipcMain.handle('app:status', () => {
    return {
      serverRunning: serverProcess !== null,
      gatewayRunning: isGatewayRunning(),
      gatewayPath: findHermesGateway(),
      rootDir: ROOT_DIR,
      isDev: IS_DEV,
    };
  });

  ipcMain.handle('gateway:detect', () => {
    return {
      found: findHermesGateway() !== null,
      path: findHermesGateway(),
      running: isGatewayRunning(),
    };
  });

  ipcMain.handle('gateway:install', async () => {
    try {
      const result = await installHermesGateway();
      return result;
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('gateway:configure', async (event, settings) => {
    try {
      const result = await configureHermes(
        settings.provider,
        settings.apiKey,
        settings.apiEndpoint,
        settings.model
      );
      return result;
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('gateway:start', async () => {
    try {
      const started = startHermesGateway();
      return { success: started !== null, running: isGatewayRunning() };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('config:complete', async (event, config) => {
    saveConfig(config);
    writeEnvFile(config);
    markSetupDone();

    // Crear tray PRIMERO para evitar que window-all-closed mate el proceso
    createTray();

    // Cerrar setup window (ahora tray existe, no se gatilla app.quit)
    if (setupWindow) {
      setupWindow.close();
    }

    // Arrancar la aplicacion principal
    try {
      await startJpAgents();
      createMainWindow();
      // Arrancar Hermes Gateway en background si esta instalado
      if (findHermesGateway()) {
        console.log('[ELECTRON] Hermes Gateway detectado, iniciando...');
        startHermesGateway();
      }
    } catch (err) {
      console.error('[ELECTRON] Error al arrancar despues del setup:', err.message);
      dialog.showErrorBox('Error', `JP Agents se configuro pero no pudo iniciar:\n${err.message}\n\nReinicia la aplicacion manualmente.`);
    }

    return { ok: true };
  });

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Seleccionar carpeta de instalacion',
    });
    return result;
  });

  ipcMain.handle('system:platform', () => {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    };
  });
}

// ─── App Lifecycle ───────────────────────────────────────
app.whenReady().then(async () => {
  setupIpcHandlers();

  // Verificar si es primera ejecucion
  if (isFirstRun()) {
    console.log('[ELECTRON] Primera ejecucion: mostrando setup wizard');
    createSetupWindow();
  } else {
    console.log('[ELECTRON] Ejecucion normal: arrancando JP Agents...');
    createTray();
    try {
      await startJpAgents();
      createMainWindow();
      // Arrancar Hermes Gateway en background si esta instalado
      if (findHermesGateway()) {
        console.log('[ELECTRON] Hermes Gateway detectado, iniciando...');
        startHermesGateway();
      }
    } catch (err) {
      dialog.showErrorBox('Error', `No se pudo iniciar JP Agents:\n${err.message}`);
      app.quit();
    }
  }
});

app.on('window-all-closed', () => {
  // En Windows, no salir si hay tray
  if (tray) {
    // keep running in background
  } else {
    stopServer();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});
