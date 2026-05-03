window.HallucinatedLab = { tools: {}, _scripts: {}, _blobs: {} };

async function loadToolManifest(repoSlug) {
  const url = `https://raw.githubusercontent.com/${repoSlug}/main/tool.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch tool manifest from ${repoSlug}`);
  return res.json();
}

async function loadTool(repoSlug, toolId) {
  if (window.HallucinatedLab.tools[toolId]) return;

  const manifest = await loadToolManifest(repoSlug);
  const entry = manifest.entry || 'tool.js';
  const scriptUrl = `https://raw.githubusercontent.com/${repoSlug}/main/${entry}`;
  const res = await fetch(scriptUrl);
  if (!res.ok) throw new Error(`Failed to fetch tool script from ${repoSlug}/${entry}`);

  const code = await res.text();
  const blob = new Blob([code], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = blobUrl;
    script.dataset.tool = toolId;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to execute tool script: ${toolId}`));
    document.head.appendChild(script);
    window.HallucinatedLab._scripts[toolId] = script;
    window.HallucinatedLab._blobs[toolId] = blobUrl;
  });

  return manifest;
}

function unloadTool(toolId) {
  const script = window.HallucinatedLab._scripts[toolId];
  if (script) {
    script.remove();
    delete window.HallucinatedLab._scripts[toolId];
  }
  const blobUrl = window.HallucinatedLab._blobs[toolId];
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    delete window.HallucinatedLab._blobs[toolId];
  }
  delete window.HallucinatedLab.tools[toolId];
}

function registerMockTool() {
  window.HallucinatedLab.tools['file-converter'] = {
    async process(file, options) {
      const text = await file.text();
      let result, filename, mimeType;
      const format = (options && options.outputFormat) || 'json';

      if (format === 'json') {
        result = JSON.stringify({ converted: true, originalName: file.name, content: text.substring(0, 200) }, null, 2);
        filename = file.name.replace(/\.[^.]+$/, '.json');
        mimeType = 'application/json';
      } else {
        result = text.toUpperCase();
        filename = file.name.replace(/\.[^.]+$/, '.txt');
        mimeType = 'text/plain';
      }

      return {
        blob: new Blob([result], { type: mimeType }),
        filename,
        mimeType,
      };
    },
  };
}

/* ============ WORKSPACE ============ */

let currentToolId = null;
let currentFile = null;

function initWorkspace() {
  const workspace = document.getElementById('tool-workspace');
  if (!workspace) return;

  const backBtn = workspace.querySelector('.workspace-back');
  const dropzone = document.getElementById('workspace-dropzone');
  const fileInput = document.getElementById('workspace-file-input');
  const browseBtn = workspace.querySelector('.workspace-browse');
  const fileInfo = document.getElementById('workspace-file-info');
  const fileName = document.getElementById('workspace-file-name');
  const removeFileBtn = workspace.querySelector('.workspace-remove-file');
  const processBtn = document.getElementById('workspace-process');
  const progress = document.getElementById('workspace-progress');
  const output = document.getElementById('workspace-output');

  backBtn.addEventListener('click', closeWorkspace);

  browseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  removeFileBtn.addEventListener('click', () => {
    currentFile = null;
    fileInput.value = '';
    fileInfo.classList.add('hidden');
    dropzone.classList.remove('hidden');
    processBtn.disabled = true;
    output.classList.add('hidden');
    clearElement(output);
  });

  processBtn.addEventListener('click', () => processTool());

  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tool')) closeWorkspace(null, true);
  });

  const params = new URLSearchParams(window.location.search);
  const toolParam = params.get('tool');
  if (toolParam) {
    const card = document.querySelector(`.utility-card[data-tool="${toolParam}"]`);
    if (card) openWorkspace(card);
  }

  function handleFile(file) {
    currentFile = file;
    fileName.textContent = file.name + ' (' + formatSize(file.size) + ')';
    fileInfo.classList.remove('hidden');
    dropzone.classList.add('hidden');
    processBtn.disabled = false;
    output.classList.add('hidden');
    clearElement(output);
  }
}

function openWorkspace(card) {
  const toolId = card.dataset.tool;
  const toolName = card.querySelector('.utility-name').textContent;
  currentToolId = toolId;

  document.querySelector('.utilities-section').classList.add('hidden');
  const workspace = document.getElementById('tool-workspace');
  workspace.classList.remove('hidden');
  document.getElementById('workspace-title').textContent = toolName;

  const isCertified = card.querySelector('.utility-badge');
  const badge = workspace.querySelector('.workspace-badge');
  if (badge) badge.classList.toggle('hidden', !isCertified);

  const params = new URLSearchParams(window.location.search);
  if (params.get('tool') !== toolId) {
    history.pushState({ tool: toolId }, '', 'utilities.html?tool=' + toolId);
  }
}

function closeWorkspace(e, skipHistory) {
  if (currentToolId) unloadTool(currentToolId);
  currentToolId = null;
  currentFile = null;

  const workspace = document.getElementById('tool-workspace');
  if (workspace) {
    workspace.classList.add('hidden');
    const fileInput = document.getElementById('workspace-file-input');
    if (fileInput) fileInput.value = '';
    const fileInfo = document.getElementById('workspace-file-info');
    if (fileInfo) fileInfo.classList.add('hidden');
    const dropzone = document.getElementById('workspace-dropzone');
    if (dropzone) dropzone.classList.remove('hidden');
    const processBtn = document.getElementById('workspace-process');
    if (processBtn) processBtn.disabled = true;
    const progress = document.getElementById('workspace-progress');
    if (progress) progress.classList.add('hidden');
    const output = document.getElementById('workspace-output');
    if (output) { output.classList.add('hidden'); clearElement(output); }
  }

  document.querySelector('.utilities-section').classList.remove('hidden');
  if (!skipHistory) history.pushState({}, '', 'utilities.html');
}

async function processTool() {
  if (!currentFile || !currentToolId) return;

  const processBtn = document.getElementById('workspace-process');
  const progress = document.getElementById('workspace-progress');
  const progressText = progress.querySelector('.workspace-progress-text');
  const output = document.getElementById('workspace-output');

  processBtn.disabled = true;
  progress.classList.remove('hidden');
  output.classList.add('hidden');
  clearElement(output);

  try {
    const useMock = new URLSearchParams(window.location.search).has('mock');
    if (useMock) {
      progressText.textContent = 'Loading mock tool...';
      registerMockTool();
    } else {
      progressText.textContent = 'Loading tool from GitHub...';
      const card = document.querySelector('.utility-card[data-tool="' + currentToolId + '"]');
      const repo = card.dataset.repo;
      await loadTool(repo, currentToolId);
    }

    progressText.textContent = 'Processing...';
    const tool = window.HallucinatedLab.tools[currentToolId];
    if (!tool) throw new Error('Tool failed to register');

    const result = await tool.process(currentFile, {});

    progress.classList.add('hidden');
    output.classList.remove('hidden');

    const downloadUrl = URL.createObjectURL(result.blob);

    const resultDiv = document.createElement('div');
    resultDiv.className = 'workspace-result';

    const icon = document.createElement('span');
    icon.className = 'workspace-result-icon';
    icon.textContent = '✓';

    const msg = document.createElement('p');
    msg.textContent = 'Processing complete';

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = result.filename;
    link.className = 'workspace-download-btn';
    link.textContent = 'Download ' + result.filename;

    resultDiv.appendChild(icon);
    resultDiv.appendChild(msg);
    resultDiv.appendChild(link);
    output.appendChild(resultDiv);
  } catch (err) {
    progress.classList.add('hidden');
    output.classList.remove('hidden');

    const errorDiv = document.createElement('div');
    errorDiv.className = 'workspace-error';
    const errorMsg = document.createElement('p');
    errorMsg.textContent = 'Error: ' + err.message;
    errorDiv.appendChild(errorMsg);
    output.appendChild(errorDiv);
  }

  processBtn.disabled = false;
}

function clearElement(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

document.addEventListener('DOMContentLoaded', () => {
  initWorkspace();

  document.querySelectorAll('.utility-card:not(.utility-card-soon)').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.utility-github-link')) return;
      e.preventDefault();
      openWorkspace(card);
    });
    card.style.cursor = 'pointer';
  });
});
