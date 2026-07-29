/**
 * afterPack.js - Post-packaging hook para electron-builder
 *
 * Instala dependencias de produccion en el directorio jpagents
 * empaquetado, para que el servidor Node.js funcione correctamente
 * sin incluir devDependencies ni node_modules en el bundle.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function (context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const platform = electronPlatformName || process.platform;

  // Determinar el directorio donde se copio jpagents
  const resourcesDir = path.join(appOutDir, 'resources');
  const jpagentsDir = path.join(resourcesDir, 'jpagents');

  if (!fs.existsSync(jpagentsDir)) {
    // Puede estar dentro de app.asar si asar=true, pero tenemos asar=false
    console.log('[afterPack] Buscando jpagents en:', jpagentsDir);
    // Intentar ubicacion alternativa
    const altDir = path.join(appOutDir, 'jpagents');
    if (fs.existsSync(altDir)) {
      console.log('[afterPack] Encontrado en ubicacion alternativa:', altDir);
      await installDeps(altDir, platform);
      return;
    }
    console.log('[afterPack] Directorio jpagents no encontrado, saltando instalacion de deps');
    return;
  }

  await installDeps(jpagentsDir, platform);
};

async function installDeps(targetDir, platform) {
  const packageJsonPath = path.join(targetDir, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    console.log('[afterPack] No hay package.json en', targetDir);
    return;
  }

  // Leer package.json para saber que instalar
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const deps = pkg.dependencies || {};
  const depCount = Object.keys(deps).length;

  if (depCount === 0) {
    console.log('[afterPack] No hay dependencias que instalar');
    return;
  }

  console.log(`[afterPack] Instalando ${depCount} dependencias de produccion en ${targetDir}...`);

  const npmCmd = platform === 'win32' ? 'npm.cmd' : 'npm';

  try {
    execSync(`${npmCmd} install --production --no-audit --no-fund --no-optional`, {
      cwd: targetDir,
      stdio: 'pipe',
      timeout: 180000, // 3 minutos
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
    });
    console.log('[afterPack] Dependencias instaladas correctamente');
  } catch (err) {
    // Si falla, intentar npm install normal
    console.log('[afterPack] npm install --production fallo, intentando npm install...');
    try {
      execSync(`${npmCmd} install --no-audit --no-fund`, {
        cwd: targetDir,
        stdio: 'pipe',
        timeout: 300000,
      });
      console.log('[afterPack] Dependencias instaladas (fallback)');
    } catch (err2) {
      console.error('[afterPack] Error instalando dependencias:', err2.message);
      console.log('[afterPack] El instalador se generara sin node_modules.');
      console.log('[afterPack] El usuario debera ejecutar npm install manualmente.');
    }
  }
}
