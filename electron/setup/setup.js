/**
 * JP Agents - Setup Wizard Logic
 */

let currentStep = 1;
const totalSteps = 4;
let gatewayInfo = { found: false, path: null, running: false };
let gatewayInstalledDuringSetup = false;
let installUnsubscribe = null;
let completeUnsubscribe = null;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    gatewayInfo = await window.jpAgents.gateway.detect();
  } catch (e) {
    console.log('Gateway detection not available');
  }
  renderGatewayStatus();
  checkFields();
});

function nextStep() {
  if (currentStep < totalSteps) {
    if (currentStep === 1 && !validateStep1()) return;
    if (currentStep === 2) handleGatewayCheck();
    goToStep(currentStep + 1);
  }
}

function prevStep() {
  if (currentStep > 1) {
    goToStep(currentStep - 1);
  }
}

function goToStep(step) {
  currentStep = step;
  document.querySelectorAll('.step').forEach((el, i) => {
    const num = i + 1;
    el.classList.toggle('active', num === step);
    el.classList.toggle('completed', num < step);
  });
  document.querySelectorAll('.step-content').forEach((el) => {
    el.classList.toggle('active', parseInt(el.id.replace('step', '')) === step);
  });
  if (step === 4) updateSummary();
}

function selectProvider(provider) {
  document.querySelectorAll('.provider-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.provider === provider);
  });

  document.getElementById('apikey-fields').style.display = (provider === 'ollama') ? 'none' : 'block';
  document.getElementById('openai-endpoint').style.display = provider === 'openai' ? 'block' : 'none';
  document.getElementById('ollama-fields').style.display = provider === 'ollama' ? 'block' : 'none';
  document.getElementById('deepseek-fields').style.display = provider === 'deepseek' ? 'block' : 'none';


  const hint = document.getElementById('apikey-hint');
  if (provider === 'deepseek') {
    hint.textContent = 'Tu API key de Deepseek. Se guarda localmente en .env';
  } else if (provider === 'openai') {
    hint.textContent = 'Tu API key de OpenAI. Se guarda localmente en .env';
  } else if (provider === 'custom') {
    hint.textContent = 'Tu API key. Se guarda localmente en .env';
  }

  const modelInput = document.getElementById('modelName');
  if (provider === 'openai') modelInput.placeholder = 'gpt-4o';
  else if (provider === 'ollama') modelInput.placeholder = 'llama3.2';
  else if (provider === 'deepseek') modelInput.placeholder = 'deepseek-chat';
  else modelInput.placeholder = 'gpt-4o-mini';

  updateModelPlaceholder(provider);
  checkFields();
}

function updateModelPlaceholder(provider) {
  const modelInput = document.getElementById('modelName');
  if (provider === 'openai' && !modelInput.value) {
    modelInput.placeholder = 'gpt-4o';
  } else if (provider === 'ollama' && !modelInput.value) {
    modelInput.placeholder = 'llama3.2';
  } else if (provider === 'deepseek' && !modelInput.value) {
    modelInput.placeholder = 'deepseek-chat';
  }
}

function validateStep1() {
  const selected = document.querySelector('.provider-card.selected');
  if (!selected) {
    alert('Selecciona un proveedor de API');
    return false;
  }
  const provider = selected.dataset.provider;
  if (provider === 'openai' || provider === 'custom' || provider === 'deepseek') {
    const key = document.getElementById('apiKey').value.trim();
    if (!key) {
      alert('Ingresa tu API Key');
      return false;
    }
  }
  return true;
}

function checkFields() {}

function renderGatewayStatus() {
  const statusEl = document.getElementById('gateway-status');
  const installedDiv = document.getElementById('gateway-installed');
  const notInstalledDiv = document.getElementById('gateway-not-installed');

  if (gatewayInfo.found) {
    statusEl.className = 'status-card success';
    statusEl.querySelector('.status-icon').className = 'status-icon success';
    statusEl.querySelector('strong').textContent = 'Gateway Hermes encontrado';
    statusEl.querySelector('span').textContent = gatewayInfo.path;
    installedDiv.style.display = 'block';
    document.getElementById('gatewayPath').value = gatewayInfo.path || 'No encontrado';
    document.getElementById('gatewayRunning').textContent = gatewayInfo.running ? 'Corriendo' : 'Detenido';
    notInstalledDiv.style.display = 'none';
  } else {
    statusEl.className = 'status-card warning';
    statusEl.querySelector('.status-icon').className = 'status-icon warning';
    statusEl.querySelector('strong').textContent = 'Gateway Hermes no instalado';
    statusEl.querySelector('span').textContent = 'Se puede instalar automaticamente';
    installedDiv.style.display = 'none';
    notInstalledDiv.style.display = 'block';
  }
}

async function handleGatewayCheck() {
  try {
    const info = await window.jpAgents.gateway.detect();
    gatewayInfo = info;
    renderGatewayStatus();
  } catch (e) {
    console.log('Error checking gateway:', e);
  }
}

async function installHermesGateway() {
  const btn = document.getElementById('btn-install-gateway');
  const progressArea = document.getElementById('install-progress-area');
  const progressBar = document.getElementById('install-progress-bar');
  const progressText = document.getElementById('install-progress-text');
  const errorDiv = document.getElementById('install-error');
  const successDiv = document.getElementById('install-success');
  const skipBtn = document.getElementById('btn-skip-install');

  btn.disabled = true;
  btn.textContent = 'Instalando...';
  progressArea.style.display = 'block';
  progressBar.style.width = '0%';
  progressText.textContent = 'Iniciando instalacion...';
  errorDiv.style.display = 'none';
  successDiv.style.display = 'none';
  skipBtn.style.display = 'none';

  const handleProgress = (info) => {
    progressBar.style.width = info.percent + '%';
    progressText.textContent = info.message;
    if (info.percent >= 100) {
      gatewayInstalledDuringSetup = true;
    }
  };
  const handleComplete = (result) => {
    btn.style.display = 'none';
    skipBtn.style.display = 'none';
    progressBar.style.width = '100%';
    if (result.success) {
      progressText.textContent = 'Gateway instalado correctamente';
      successDiv.style.display = 'block';
      gatewayInfo = { found: true, path: result.path, running: false };
      renderGatewayStatus();
    } else {
      progressText.textContent = 'Error en la instalacion';
      errorDiv.textContent = result.error || 'Error desconocido';
      errorDiv.style.display = 'block';
      btn.style.display = 'inline-block';
      btn.textContent = 'Reintentar instalacion';
      btn.disabled = false;
      skipBtn.style.display = 'inline-block';
    }
  };

  installUnsubscribe = window.jpAgents.gateway.onProgress(handleProgress);
  completeUnsubscribe = window.jpAgents.gateway.onComplete(handleComplete);

  try {
    await window.jpAgents.gateway.install();
  } catch (e) {
    progressText.textContent = 'Error en la instalacion';
    errorDiv.textContent = e.message || 'Error desconocido';
    errorDiv.style.display = 'block';
    btn.style.display = 'inline-block';
    btn.textContent = 'Reintentar instalacion';
    btn.disabled = false;
    skipBtn.style.display = 'inline-block';
  } finally {
    if (installUnsubscribe) installUnsubscribe();
    if (completeUnsubscribe) completeUnsubscribe();
    installUnsubscribe = null;
    completeUnsubscribe = null;
  }
}

function skipGatewayInstall() {
  gatewayInstalledDuringSetup = false;
  nextStep();
}

async function updateSummary() {
  const selectedCard = document.querySelector('.provider-card.selected');
  if (!selectedCard) return;
  const provider = selectedCard.dataset.provider;
  const apiKey = document.getElementById('apiKey').value.trim();
  const modelName = document.getElementById('modelName').value.trim() ||
    document.getElementById('modelName').placeholder;
  const endpoint = provider === 'openai'
    ? document.getElementById('endpointUrl').value.trim() || 'https://api.openai.com/v1'
    : provider === 'deepseek'
      ? 'https://api.deepseek.com/v1'
      : provider === 'ollama'
          ? 'http://localhost:11434'
          : '';

  document.getElementById('summary-provider').textContent = provider;
  document.getElementById('summary-endpoint').textContent = endpoint;
  document.getElementById('summary-model').textContent = modelName;
  document.getElementById('summary-gateway').textContent = gatewayInfo.found ? 'Hermes Gateway' : 'No instalado';
}

async function completeSetup() {
  const selectedCard = document.querySelector('.provider-card.selected');
  if (!selectedCard) return;
  const provider = selectedCard.dataset.provider;
  const apiKey = document.getElementById('apiKey').value.trim();
  const modelName = document.getElementById('modelName').value.trim() ||
    document.getElementById('modelName').placeholder;
  const endpoint = provider === 'openai'
    ? document.getElementById('endpointUrl').value.trim() || 'https://api.openai.com/v1'
    : provider === 'deepseek'
      ? 'https://api.deepseek.com/v1'
      : provider === 'ollama'
          ? 'http://localhost:11434'
          : '';

  const settings = { provider, apiKey, model: modelName, apiEndpoint: endpoint };

  try {
    await window.jpAgents.settings.save(settings);
    document.getElementById('complete-message').textContent =
      'Configuracion guardada correctamente.';
    document.getElementById('btn-complete').textContent = 'Finalizado';
    document.getElementById('btn-complete').disabled = true;
    setTimeout(async () => {
      try {
        await window.jpAgents.app.restart();
      } catch (e) {
        console.log('Could not restart:', e);
      }
    }, 1500);
  } catch (e) {
    document.getElementById('complete-message').textContent =
      'Error al guardar: ' + e.message;
  }
}
