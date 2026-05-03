/* ============================================================
   utilities.js — Lab Assistant (NLP Tool Runner)
   Handles tool panel, chat assistant, file uploads,
   intent parsing, and local file conversion.
   ============================================================ */

(() => {
  'use strict';

  /* ============ TOOL REGISTRY ============ */
  const TOOLS = {
    'file-converter': {
      name: 'File Converter',
      capabilities: [
        'Convert images between PNG, JPG, WebP, BMP, GIF',
        'Convert data between CSV, JSON, XML, YAML',
        'Convert text between Markdown and HTML',
      ],
      keywords: ['convert', 'change', 'transform', 'export', 'save as', 'make it', 'turn into', 'to png', 'to jpg', 'to jpeg', 'to webp', 'to csv', 'to json', 'to xml', 'to yaml', 'to yml', 'to html', 'to markdown', 'to md', 'to bmp', 'to gif'],
      supportedFormats: {
        image: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'],
        data: ['csv', 'json', 'xml', 'yaml', 'yml'],
        text: ['md', 'markdown', 'html', 'txt'],
      },
    },
  };

  /* ============ DOM REFERENCES ============ */
  const panel = document.getElementById('tool-panel');
  const backdrop = document.getElementById('tool-panel-backdrop');
  const panelClose = document.getElementById('tool-panel-close');
  const panelName = document.getElementById('tool-panel-name');
  const messagesContainer = document.getElementById('assistant-messages');
  const inputField = document.getElementById('assistant-input');
  const sendBtn = document.getElementById('assistant-send-btn');
  const attachBtn = document.getElementById('assistant-attach-btn');
  const fileInput = document.getElementById('assistant-file-input');
  const dropzoneFiles = document.getElementById('dropzone-files');
  const dropzone = document.getElementById('assistant-dropzone');

  let currentTool = null;
  let uploadedFiles = [];
  let conversationHistory = [];

  /* ============ PANEL OPEN / CLOSE ============ */
  function openPanel(toolId) {
    const tool = TOOLS[toolId];
    if (!tool) return;

    currentTool = toolId;
    uploadedFiles = [];
    conversationHistory = [];
    panelName.textContent = tool.name;
    messagesContainer.innerHTML = '';
    dropzoneFiles.innerHTML = '';

    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Welcome message
    addMessage('assistant', `👋 Hi! I'm the Lab Assistant for **${tool.name}**.

I can help you with:
${tool.capabilities.map(c => `• ${c}`).join('\n')}

**Upload a file** and tell me what you need — for example:
_"Convert this to WebP"_ or _"Turn my CSV into JSON"_`);

    inputField.focus();
  }

  function closePanel() {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    currentTool = null;
    uploadedFiles = [];
    conversationHistory = [];
  }

  /* ============ MESSAGES ============ */
  function addMessage(role, text, extra) {
    const msg = document.createElement('div');
    msg.className = `assistant-msg assistant-msg-${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = formatMarkdown(text);
    msg.appendChild(bubble);

    if (extra) {
      msg.appendChild(extra);
    }

    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    conversationHistory.push({ role, text });
  }

  function addFileChips(files) {
    const chips = document.createElement('div');
    chips.className = 'msg-file-chips';
    files.forEach(f => {
      const chip = document.createElement('span');
      chip.className = 'msg-file-chip';
      chip.textContent = `📎 ${f.name}`;
      chips.appendChild(chip);
    });
    return chips;
  }

  function formatMarkdown(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/_(.*?)_/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  function showTypingIndicator() {
    const typing = document.createElement('div');
    typing.className = 'assistant-msg assistant-msg-assistant typing-indicator';
    typing.id = 'typing-indicator';
    typing.innerHTML = `<div class="msg-bubble"><span class="dot-pulse"><span></span><span></span><span></span></span></div>`;
    messagesContainer.appendChild(typing);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function removeTypingIndicator() {
    const el = document.getElementById('typing-indicator');
    if (el) el.remove();
  }

  /* ============ NLP INTENT PARSER ============ */
  function parseIntent(text) {
    const lower = text.toLowerCase().trim();
    const tool = TOOLS[currentTool];
    if (!tool) return { action: 'unknown' };

    // Detect target format
    let targetFormat = null;
    const allFormats = [...tool.supportedFormats.image, ...tool.supportedFormats.data, ...tool.supportedFormats.text];

    // Check for "to <format>" pattern
    const toMatch = lower.match(/(?:to|into|as)\s+(png|jpe?g|webp|bmp|gif|csv|json|xml|ya?ml|html|md|markdown|txt)/i);
    if (toMatch) {
      targetFormat = normalizeFormat(toMatch[1]);
    }

    // Check for "make it <format>" pattern
    if (!targetFormat) {
      const makeMatch = lower.match(/(?:make\s+(?:it|them?)\s+(?:a\s+)?)(png|jpe?g|webp|bmp|gif|csv|json|xml|ya?ml|html|md|markdown|txt)/i);
      if (makeMatch) targetFormat = normalizeFormat(makeMatch[1]);
    }

    // Check for standalone format mention when there's a conversion keyword
    if (!targetFormat) {
      const hasConversionKeyword = tool.keywords.some(kw => lower.includes(kw));
      if (hasConversionKeyword) {
        for (const fmt of allFormats) {
          if (lower.includes(fmt)) {
            targetFormat = normalizeFormat(fmt);
            break;
          }
        }
      }
    }

    if (targetFormat) {
      return { action: 'convert', targetFormat };
    }

    // Check if they're asking what the tool can do
    if (lower.match(/(?:what|help|how|can you|capabilities|options|formats|support)/)) {
      return { action: 'help' };
    }

    // Check if it's a greeting
    if (lower.match(/^(?:hi|hello|hey|yo|sup|greetings)/)) {
      return { action: 'greeting' };
    }

    return { action: 'unknown' };
  }

  function normalizeFormat(fmt) {
    fmt = fmt.toLowerCase();
    if (fmt === 'jpeg') return 'jpg';
    if (fmt === 'yml') return 'yaml';
    if (fmt === 'markdown') return 'md';
    return fmt;
  }

  function getFormatCategory(fmt) {
    const tool = TOOLS[currentTool];
    for (const [cat, fmts] of Object.entries(tool.supportedFormats)) {
      if (fmts.includes(fmt) || fmts.includes(normalizeFormat(fmt))) return cat;
    }
    return null;
  }

  function getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
  }

  /* ============ CONVERSION ENGINE ============ */
  async function convertFile(file, targetFormat) {
    const sourceExt = getFileExtension(file.name);
    const sourceCat = getFormatCategory(sourceExt);
    const targetCat = getFormatCategory(targetFormat);

    if (!sourceCat || !targetCat) {
      throw new Error(`Unsupported format: ${sourceExt} → ${targetFormat}`);
    }

    if (sourceCat !== targetCat) {
      throw new Error(`Cross-category conversion not supported: ${sourceCat} → ${targetCat}. I can convert within the same category (e.g., image to image, data to data).`);
    }

    if (sourceCat === 'image') return convertImage(file, targetFormat);
    if (sourceCat === 'data') return convertData(file, sourceExt, targetFormat);
    if (sourceCat === 'text') return convertText(file, sourceExt, targetFormat);

    throw new Error('Conversion not implemented for this format pair.');
  }

  /* --- Image Conversion (Canvas API) --- */
  function convertImage(file, targetFormat) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();

      reader.onload = (e) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');

          // For JPG/BMP: fill white background (no transparency)
          if (['jpg', 'jpeg', 'bmp'].includes(targetFormat)) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          ctx.drawImage(img, 0, 0);

          const mimeMap = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            webp: 'image/webp',
            bmp: 'image/bmp',
            gif: 'image/gif',
          };

          const mime = mimeMap[targetFormat] || 'image/png';
          canvas.toBlob((blob) => {
            if (!blob) return reject(new Error('Canvas conversion failed.'));
            const baseName = file.name.replace(/\.[^/.]+$/, '');
            resolve({ blob, filename: `${baseName}.${targetFormat}`, mime });
          }, mime, 0.92);
        };
        img.onerror = () => reject(new Error('Failed to load image.'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    });
  }

  /* --- Data Conversion (CSV ↔ JSON ↔ XML ↔ YAML) --- */
  async function convertData(file, sourceFormat, targetFormat) {
    const text = await readFileAsText(file);
    let data;

    // Parse source
    if (sourceFormat === 'csv') data = parseCSV(text);
    else if (sourceFormat === 'json') data = JSON.parse(text);
    else if (sourceFormat === 'xml') data = parseXML(text);
    else if (['yaml', 'yml'].includes(sourceFormat)) data = parseYAML(text);
    else throw new Error(`Cannot parse ${sourceFormat}`);

    // Serialize to target
    let output;
    if (targetFormat === 'csv') output = toCSV(data);
    else if (targetFormat === 'json') output = JSON.stringify(data, null, 2);
    else if (targetFormat === 'xml') output = toXML(data);
    else if (['yaml', 'yml'].includes(targetFormat)) output = toYAML(data);
    else throw new Error(`Cannot serialize to ${targetFormat}`);

    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const blob = new Blob([output], { type: 'text/plain' });
    return { blob, filename: `${baseName}.${targetFormat}`, mime: 'text/plain' };
  }

  /* --- Text Conversion (Markdown ↔ HTML) --- */
  async function convertText(file, sourceFormat, targetFormat) {
    const text = await readFileAsText(file);
    let output;

    if (['md', 'markdown'].includes(sourceFormat) && targetFormat === 'html') {
      output = mdToHTML(text);
    } else if (sourceFormat === 'html' && ['md', 'markdown'].includes(targetFormat)) {
      output = htmlToMD(text);
    } else if (sourceFormat === 'txt' && targetFormat === 'html') {
      output = `<pre>${escapeHTML(text)}</pre>`;
    } else if (sourceFormat === 'txt' && ['md', 'markdown'].includes(targetFormat)) {
      output = text;
    } else if (sourceFormat === 'html' && targetFormat === 'txt') {
      output = text.replace(/<[^>]*>/g, '');
    } else if (['md', 'markdown'].includes(sourceFormat) && targetFormat === 'txt') {
      output = text.replace(/[#*_`\[\]()]/g, '');
    } else {
      output = text;
    }

    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const blob = new Blob([output], { type: 'text/plain' });
    return { blob, filename: `${baseName}.${targetFormat}`, mime: 'text/plain' };
  }

  /* ============ PARSERS & SERIALIZERS ============ */
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsText(file);
    });
  }

  function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      headers.forEach((h, i) => { obj[h] = values[i] || ''; });
      return obj;
    });
  }

  function toCSV(data) {
    if (!Array.isArray(data) || data.length === 0) return '';
    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','));
    return [headers.map(h => `"${h}"`).join(','), ...rows].join('\n');
  }

  function parseXML(text) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');
    return xmlToObj(doc.documentElement);
  }

  function xmlToObj(node) {
    if (node.children.length === 0) return node.textContent;
    const obj = {};
    for (const child of node.children) {
      const key = child.tagName;
      const val = xmlToObj(child);
      if (obj[key]) {
        if (!Array.isArray(obj[key])) obj[key] = [obj[key]];
        obj[key].push(val);
      } else {
        obj[key] = val;
      }
    }
    return obj;
  }

  function toXML(data, rootTag = 'root') {
    function serialize(obj, tag) {
      if (typeof obj !== 'object' || obj === null) return `<${tag}>${escapeXML(String(obj))}</${tag}>`;
      if (Array.isArray(obj)) return obj.map(item => serialize(item, 'item')).join('\n');
      let inner = '';
      for (const [k, v] of Object.entries(obj)) {
        inner += serialize(v, k) + '\n';
      }
      return `<${tag}>\n${inner}</${tag}>`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(data, rootTag)}`;
  }

  function parseYAML(text) {
    // Lightweight YAML parser (handles simple key-value, lists, nested objects)
    const result = {};
    const lines = text.split('\n');
    const stack = [{ obj: result, indent: -1 }];

    for (let line of lines) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const indent = line.search(/\S/);
      const content = line.trim();

      // Pop stack to correct level
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const parent = stack[stack.length - 1].obj;

      if (content.startsWith('- ')) {
        // Array item
        const val = content.substring(2).trim();
        if (Array.isArray(parent)) {
          parent.push(parseYAMLValue(val));
        }
      } else if (content.includes(':')) {
        const colonIdx = content.indexOf(':');
        const key = content.substring(0, colonIdx).trim();
        const val = content.substring(colonIdx + 1).trim();

        if (val === '' || val === '|' || val === '>') {
          parent[key] = {};
          stack.push({ obj: parent[key], indent });
        } else {
          parent[key] = parseYAMLValue(val);
        }
      }
    }
    return result;
  }

  function parseYAMLValue(val) {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val === 'null' || val === '~') return null;
    if (/^-?\d+$/.test(val)) return parseInt(val, 10);
    if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
    return val.replace(/^['"]|['"]$/g, '');
  }

  function toYAML(data, indent = 0) {
    const pad = '  '.repeat(indent);
    let result = '';

    if (Array.isArray(data)) {
      data.forEach(item => {
        if (typeof item === 'object' && item !== null) {
          result += `${pad}- \n${toYAML(item, indent + 1)}`;
        } else {
          result += `${pad}- ${yamlValue(item)}\n`;
        }
      });
    } else if (typeof data === 'object' && data !== null) {
      for (const [key, val] of Object.entries(data)) {
        if (typeof val === 'object' && val !== null) {
          result += `${pad}${key}:\n${toYAML(val, indent + 1)}`;
        } else {
          result += `${pad}${key}: ${yamlValue(val)}\n`;
        }
      }
    }
    return result;
  }

  function yamlValue(val) {
    if (val === null) return 'null';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'string' && /[:#{}[\],&*?|>!%@`]/.test(val)) return `"${val}"`;
    return String(val);
  }

  function mdToHTML(md) {
    return md
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/^\- (.*$)/gm, '<li>$1</li>')
      .replace(/\n/g, '<br>');
  }

  function htmlToMD(html) {
    return html
      .replace(/<h1>(.*?)<\/h1>/gi, '# $1\n')
      .replace(/<h2>(.*?)<\/h2>/gi, '## $1\n')
      .replace(/<h3>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<em>(.*?)<\/em>/gi, '*$1*')
      .replace(/<code>(.*?)<\/code>/gi, '`$1`')
      .replace(/<li>(.*?)<\/li>/gi, '- $1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '');
  }

  function escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeXML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  /* ============ MESSAGE HANDLER ============ */
  async function handleUserMessage(text) {
    const files = [...uploadedFiles];
    uploadedFiles = [];
    dropzoneFiles.innerHTML = '';

    // Show user message
    const extra = files.length > 0 ? addFileChips(files) : null;
    addMessage('user', text, extra);

    // Parse intent
    const intent = parseIntent(text);

    showTypingIndicator();
    await delay(600); // Simulate processing time
    removeTypingIndicator();

    switch (intent.action) {
      case 'convert':
        await handleConversion(files, intent.targetFormat);
        break;
      case 'help':
        handleHelp();
        break;
      case 'greeting':
        addMessage('assistant', `Hey there! 👋 Upload a file and tell me what format you need — I'll handle the conversion right here in your browser.`);
        break;
      case 'unknown':
      default:
        handleUnknown(text, files);
        break;
    }
  }

  async function handleConversion(files, targetFormat) {
    if (files.length === 0) {
      addMessage('assistant', `I know you want to convert to **${targetFormat.toUpperCase()}**, but I need a file first! 📎 Click the attach button or drag a file into the chat.`);
      return;
    }

    addMessage('assistant', `Got it! Converting ${files.length > 1 ? `${files.length} files` : `**${files[0].name}**`} to **${targetFormat.toUpperCase()}**… ⚙️`);

    for (const file of files) {
      try {
        const sourceExt = getFileExtension(file.name);
        if (normalizeFormat(sourceExt) === normalizeFormat(targetFormat)) {
          addMessage('assistant', `⚠️ **${file.name}** is already in ${targetFormat.toUpperCase()} format. Skipping.`);
          continue;
        }

        showTypingIndicator();
        const result = await convertFile(file, targetFormat);
        removeTypingIndicator();

        // Create download link
        const url = URL.createObjectURL(result.blob);
        const downloadEl = document.createElement('div');
        downloadEl.className = 'msg-download';
        downloadEl.innerHTML = `
          <a href="${url}" download="${result.filename}" class="download-link">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <span>Download ${result.filename}</span>
            <span class="download-size">${formatFileSize(result.blob.size)}</span>
          </a>
        `;

        addMessage('assistant', `✅ **${file.name}** → **${result.filename}** — Done!`, downloadEl);

      } catch (err) {
        removeTypingIndicator();
        addMessage('assistant', `❌ Failed to convert **${file.name}**: ${err.message}`);
      }
    }

    addMessage('assistant', `All done! Need anything else? 🚀`);
  }

  function handleHelp() {
    const tool = TOOLS[currentTool];
    addMessage('assistant', `Here's what I can do:

${tool.capabilities.map(c => `✦ ${c}`).join('\n')}

**Just upload a file** and tell me the target format. For example:
• _"Convert this to WebP"_
• _"Make it a JSON file"_
• _"Turn this CSV into YAML"_

I handle everything locally — your files never leave your browser. 🔒`);
  }

  function handleUnknown(text, files) {
    if (files.length > 0) {
      addMessage('assistant', `I see you uploaded ${files.length > 1 ? 'some files' : `**${files[0].name}**`}, but I'm not sure what you want me to do. Could you tell me the target format? For example:
• _"Convert to PNG"_
• _"Make it JSON"_`);
    } else {
      addMessage('assistant', `I'm not quite sure what you mean. Try something like:
• _"Convert my image to WebP"_
• _"Turn this CSV into JSON"_
• _"Help"_ to see what I can do

Don't forget to **attach a file** first! 📎`);
    }
  }

  /* ============ HELPERS ============ */
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* ============ EVENT WIRING ============ */
  document.addEventListener('DOMContentLoaded', () => {
    // Launch buttons
    document.querySelectorAll('.utility-launch-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPanel(btn.dataset.tool);
      });
    });

    // Clicking utility name row also launches
    document.querySelectorAll('.utility-list-item:not(.utility-list-soon) .utility-list-info').forEach(info => {
      info.style.cursor = 'pointer';
      info.addEventListener('click', (e) => {
        const item = info.closest('.utility-list-item');
        if (item) openPanel(item.dataset.tool);
      });
    });

    // Close panel
    if (panelClose) panelClose.addEventListener('click', closePanel);
    if (backdrop) backdrop.addEventListener('click', closePanel);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
    });

    // Send message
    if (sendBtn) sendBtn.addEventListener('click', () => sendMessage());
    if (inputField) inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // File attach
    if (attachBtn) attachBtn.addEventListener('click', () => fileInput.click());
    if (fileInput) fileInput.addEventListener('change', handleFileSelect);

    // Drag and drop
    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-over');
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files);
        files.forEach(f => addUploadedFile(f));
      });
    }
  });

  function sendMessage() {
    const text = inputField.value.trim();
    if (!text && uploadedFiles.length === 0) return;
    inputField.value = '';
    handleUserMessage(text || 'Convert this file');
  }

  function handleFileSelect() {
    Array.from(fileInput.files).forEach(f => addUploadedFile(f));
    fileInput.value = '';
  }

  function addUploadedFile(file) {
    uploadedFiles.push(file);
    const chip = document.createElement('div');
    chip.className = 'upload-chip';
    chip.innerHTML = `<span class="upload-chip-name">📎 ${file.name}</span><button class="upload-chip-remove" aria-label="Remove ${file.name}">×</button>`;
    chip.querySelector('.upload-chip-remove').addEventListener('click', () => {
      uploadedFiles = uploadedFiles.filter(f => f !== file);
      chip.remove();
    });
    dropzoneFiles.appendChild(chip);
  }

})();
