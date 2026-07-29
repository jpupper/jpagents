/**
 * JP Agents - Preload Script
 * Expone APIs seguras al renderer mediante contextBridge
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jpAgents', {
  // Configuracion
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (config) => ipcRenderer.invoke('config:save', config),
    complete: (config) => ipcRenderer.invoke('config:complete', config),
  },

  // Estado del sistema
  status: () => ipcRenderer.invoke('app:status'),

  // Gateway Hermes
  gateway: {
    detect: () => ipcRenderer.invoke('gateway:detect'),
    install: () => ipcRenderer.invoke('gateway:install'),
    configure: (settings) => ipcRenderer.invoke('gateway:configure', settings),
    start: () => ipcRenderer.invoke('gateway:start'),
    // Escuchar eventos de progreso de instalacion
    onInstallProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('gateway:install-progress', handler);
      return () => ipcRenderer.removeListener('gateway:install-progress', handler);
    },
    onInstallComplete: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('gateway:install-complete', handler);
      return () => ipcRenderer.removeListener('gateway:install-complete', handler);
    },
  },

  // Dialogos del sistema
  dialog: {
    selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  },

  // Informacion del sistema
  system: {
    platform: () => ipcRenderer.invoke('system:platform'),
  },
});
