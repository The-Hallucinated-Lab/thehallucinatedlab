/* ============================================================
   interface.js — chat engine for the Assistant page.

   Talks to an Ollama runtime on the visitor's own machine. Nothing
   here reaches a server we control: no keys, no relay, no logging.

   Lives in its own file rather than inline in interface.html so the
   page's Content-Security-Policy can forbid inline script outright.
   ============================================================ */
(function () {
  'use strict';

  const OLLAMA_BASE = 'http://localhost:11434';
  const PREFERRED_MODELS = ['gemma4:e4b', 'gemma4:e2b', 'gemma3:4b', 'gemma2:2b', 'llama3.2:3b', 'llama3.2:1b'];
  const CONNECT_TIMEOUT_MS = 5000;

  /* Every turn is replayed to the model on the next send, so an
     unbounded history grows the request payload and the heap for as
     long as the tab stays open. Keep the most recent turns. */
  const MAX_HISTORY_MESSAGES = 40;

  let MODEL = null;             // resolved at connection time from /api/tags
  let chatHistory = [];
  let attachedFile = null;
  let isStreaming = false;
  let streamController = null;  // aborts the in-flight response

  document.addEventListener('DOMContentLoaded', () => {
    checkOllamaConnection();
    initChatUI();
  });

  /* Leaving the page mid-stream should release the reader, not leave a
     fetch running against the local runtime. */
  window.addEventListener('pagehide', () => {
    if (streamController) streamController.abort();
  });

  function buildSystemPrompt() {
    return 'You are the AI assistant for The Hallucinated Lab — a platform that builds local-first, privacy-respecting developer tools. You are running locally on the user\'s machine via Ollama. Be helpful, concise, and technical when needed.';
  }

  /* ---- Connection Check ---- */
  async function checkOllamaConnection() {
    const statusEl = document.getElementById('setup-status');
    const statusText = document.getElementById('setup-status-text');
    const setupSteps = document.getElementById('setup-steps');
    const retryBtn = document.getElementById('setup-retry');
    const setupPanel = document.getElementById('chat-setup');
    const chatContainer = document.getElementById('chat-container');

    statusEl.className = 'setup-status checking';
    statusText.textContent = 'Checking connection...';
    setupSteps.style.display = 'none';
    retryBtn.style.display = 'none';

    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
      if (!res.ok) throw new Error('Not OK');
      const data = await res.json();

      const installed = (data.models || []).map(m => m.name).filter(Boolean);
      if (installed.length === 0) {
        statusEl.className = 'setup-status offline';
        statusText.textContent = 'No models installed';
        setupSteps.style.display = 'block';
        retryBtn.style.display = 'inline-flex';
      } else {
        // Prefer one of our recommended models if installed; otherwise use the first one available.
        MODEL = PREFERRED_MODELS.find(p => installed.includes(p)) || installed[0];
        statusEl.className = 'setup-status online';
        statusText.textContent = 'Connected — ' + MODEL;
        setTimeout(() => {
          setupPanel.classList.add('hidden');
          chatContainer.classList.remove('hidden');
        }, 800);
      }
    } catch (e) {
      console.warn('[Ollama] connection failed:', e);
      statusEl.className = 'setup-status offline';
      statusText.textContent = 'Ollama not detected (or CORS blocked)';
      setupSteps.style.display = 'block';
      retryBtn.style.display = 'inline-flex';
    }

    // Bind retry once
    if (!retryBtn.dataset.bound) {
      retryBtn.addEventListener('click', () => checkOllamaConnection());
      retryBtn.dataset.bound = '1';
    }
  }

  /* ---- Chat UI ---- */
  function initChatUI() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const attachBtn = document.getElementById('chat-attach');
    const fileInput = document.getElementById('chat-file-input');

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      sendBtn.disabled = !input.value.trim() && !attachedFile;
    });

    // Send on Enter (Shift+Enter for newline)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled && !isStreaming) sendMessage();
      }
    });

    sendBtn.addEventListener('click', () => {
      if (!isStreaming) sendMessage();
    });

    // File attachment
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        attachedFile = fileInput.files[0];
        input.placeholder = `📎 ${attachedFile.name} attached. Type a message...`;
        sendBtn.disabled = false;
      }
    });
  }

  /* ---- Send Message ---- */
  async function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text && !attachedFile) return;

    // Remove empty state
    const emptyEl = document.getElementById('chat-empty');
    if (emptyEl) emptyEl.remove();

    // Display user message
    let userContent = text;
    if (attachedFile) {
      userContent += `\n📎 ${attachedFile.name}`;
    }
    addBubble('user', userContent);

    // Build message for API
    const userMsg = { role: 'user', content: text + (attachedFile ? `\n[Attached file: ${attachedFile.name}, type: ${attachedFile.type}, size: ${attachedFile.size} bytes]` : '') };
    chatHistory.push(userMsg);
    trimHistory();

    // Clear input
    input.value = '';
    input.style.height = 'auto';
    document.getElementById('chat-send').disabled = true;

    // Show typing indicator
    const typingEl = showTyping();

    isStreaming = true;
    streamController = new AbortController();

    try {
      const systemMsg = { role: 'system', content: buildSystemPrompt() };
      const messages = [systemMsg, ...chatHistory];

      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, stream: true }),
        signal: streamController.signal,
      });

      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

      // Remove typing indicator
      typingEl.remove();

      // Stream response
      const aiBubble = addBubble('ai', '');
      const contentEl = aiBubble.querySelector('.bubble-content') || aiBubble;
      let fullResponse = '';

      /* Re-rendering the whole response through formatMarkdown on every
         token means re-parsing an ever-growing string hundreds of times
         per reply. Coalesce the paints to one per frame instead. */
      let paintQueued = false;
      const paint = () => {
        if (paintQueued) return;
        paintQueued = true;
        requestAnimationFrame(() => {
          contentEl.innerHTML = formatMarkdown(fullResponse);
          scrollToBottom();
          paintQueued = false;
        });
      };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            if (json.message && json.message.content) {
              fullResponse += json.message.content;
              paint();
            }
          } catch (e) { /* skip malformed line */ }
        }
      }

      // Final render, so the last frame is never dropped by the throttle.
      contentEl.innerHTML = formatMarkdown(fullResponse);
      scrollToBottom();

      chatHistory.push({ role: 'assistant', content: fullResponse });
      trimHistory();

    } catch (err) {
      typingEl.remove();
      if (err.name !== 'AbortError') {
        addBubble('ai', `⚠️ Error: ${err.message}`);
      }
    }

    streamController = null;
    isStreaming = false;
    attachedFile = null;
    document.getElementById('chat-file-input').value = '';
    document.getElementById('chat-input').placeholder = 'Type a message...';
  }

  function trimHistory() {
    if (chatHistory.length > MAX_HISTORY_MESSAGES) {
      chatHistory = chatHistory.slice(-MAX_HISTORY_MESSAGES);
    }
  }

  /* ---- UI Helpers ---- */
  function addBubble(role, content) {
    const messages = document.getElementById('chat-messages');
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-bubble-${role}`;

    const contentSpan = document.createElement('span');
    contentSpan.className = 'bubble-content';
    if (role === 'ai') {
      contentSpan.innerHTML = formatMarkdown(content);
    } else {
      contentSpan.textContent = content;      // user text is never parsed as markup
      contentSpan.style.whiteSpace = 'pre-wrap';
    }
    bubble.appendChild(contentSpan);

    messages.appendChild(bubble);
    scrollToBottom();
    return bubble;
  }

  function showTyping() {
    const messages = document.getElementById('chat-messages');
    const typing = document.createElement('div');
    typing.className = 'chat-typing';
    typing.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
    messages.appendChild(typing);
    scrollToBottom();
    return typing;
  }

  function scrollToBottom() {
    const messages = document.getElementById('chat-messages');
    messages.scrollTop = messages.scrollHeight;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Model output is untrusted text: everything is escaped first, and the
     markdown transforms below only ever reintroduce a fixed set of
     tags. No path here can emit an attribute, so there is nothing for
     an injected string to hang an event handler off.

     The previous version escaped newlines into <br> before running the
     transforms, which meant the fenced-code pattern (which has to match
     a real \n after the opening fence) never matched and code blocks
     rendered as literal backticks. Newlines are now converted last, and
     only outside <pre> blocks. */
  function formatMarkdown(text) {
    let html = escapeHtml(text);

    const codeBlocks = [];
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      codeBlocks.push(`<pre><code>${code}</code></pre>`);
      return ` CODEBLOCK${codeBlocks.length - 1} `;
    });

    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    html = html.replace(/\n/g, '<br>');

    /* Restore fenced blocks with their newlines intact, absorbing the
       <br> the surrounding newlines became — <pre> is already a block
       element, so those would render as an extra blank line. */
    html = html.replace(/(?:<br>)? CODEBLOCK(\d+) (?:<br>)?/g, (_, i) => codeBlocks[Number(i)]);

    return html;
  }

})();
