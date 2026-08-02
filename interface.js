/* ============================================================
   interface.js — chat engine for the Assistant page.

   Talks to an Ollama runtime on the visitor's own machine. Nothing
   here reaches a server we control: no keys, no relay, no logging.

   Lives in its own file rather than inline in interface.html so the
   page's Content-Security-Policy can forbid inline script outright.

   Failure model for this integration (there is exactly one):
     - Ollama not running / CORS unset -> fetch rejects with TypeError.
       Show the setup panel, which carries the install and OLLAMA_ORIGINS
       instructions and a Retry button.
     - Ollama reachable but the model is gone or will not load -> non-2xx
       with a JSON {"error": "..."} body. Surface that sentence; it is
       the only actionable diagnostic that exists.
     - Ollama accepts the connection then stalls -> nothing rejects, ever.
       Watchdogs below turn that into an abort.
   ============================================================ */
(function () {
  'use strict';

  const OLLAMA_BASE = 'http://localhost:11434';
  const PREFERRED_MODELS = ['gemma4:e4b', 'gemma4:e2b', 'gemma3:4b', 'gemma2:2b', 'llama3.2:3b', 'llama3.2:1b'];
  const CONNECT_TIMEOUT_MS = 5000;

  /* A local model can legitimately take a while to load into VRAM before
     it emits its first token, but once it is streaming the gaps between
     tokens are small. Two separate budgets, same as separating connect
     from read timeouts. */
  const FIRST_BYTE_TIMEOUT_MS = 60000;
  const IDLE_TIMEOUT_MS = 20000;

  /* Every turn is replayed to the model on the next send, so an
     unbounded history grows the request payload and the heap for as
     long as the tab stays open. Keep the most recent turns. */
  const MAX_HISTORY_MESSAGES = 40;

  /* Small models fall into repetition loops. The stop button is the real
     answer, but this bounds the damage if nobody is watching: past this
     many characters the reply is almost certainly a loop, and every
     frame is re-parsing the whole accumulated string. */
  const MAX_RESPONSE_CHARS = 200000;

  let MODEL = null;             // resolved at connection time from /api/tags
  let chatHistory = [];
  let attachedFile = null;
  let isStreaming = false;
  let streamController = null;  // aborts the in-flight response
  let watchdogTimer = null;
  let abortReason = null;       // 'timeout' | 'user' | 'overflow' | null

  document.addEventListener('DOMContentLoaded', () => {
    checkOllamaConnection();
    initChatUI();
  });

  /* Leaving the page mid-stream should release the reader, not leave a
     fetch running against the local runtime. */
  window.addEventListener('pagehide', () => {
    abortStream('user');
  });

  function buildSystemPrompt() {
    return 'You are the AI assistant for The Hallucinated Lab — a platform that builds local-first, privacy-respecting developer tools. You are running locally on the user\'s machine via Ollama. Be helpful, concise, and technical when needed.';
  }

  /* ---- Stream lifecycle ----
     A stalled fetch never rejects on its own. Arm a timer before the
     request, re-arm it every time a chunk actually lands, and clear it
     on every exit path. When it fires it aborts through the same
     AbortController the stop button uses, so there is one cancellation
     path rather than two. */
  function armWatchdog(ms) {
    clearWatchdog();
    watchdogTimer = setTimeout(() => abortStream('timeout'), ms);
  }

  function clearWatchdog() {
    if (watchdogTimer !== null) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function abortStream(reason) {
    if (!streamController) return;
    abortReason = reason;
    clearWatchdog();
    streamController.abort();
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

  /* Once the setup panel has been dismissed nothing ever brought it
     back, so a visitor who lost Ollama mid-session was stuck typing into
     a chat with nothing on the other end. Any connection-level failure
     now returns them to the panel, where Retry actually lives. */
  function returnToSetup() {
    const setupPanel = document.getElementById('chat-setup');
    const chatContainer = document.getElementById('chat-container');
    if (!setupPanel || !chatContainer) return;
    chatContainer.classList.add('hidden');
    setupPanel.classList.remove('hidden');
    checkOllamaConnection();
  }

  /* ---- Chat UI ---- */
  const SEND_ICON = 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z';
  const STOP_ICON = 'M6 6h12v12H6z';

  function setSendMode(mode) {
    const btn = document.getElementById('chat-send');
    if (!btn) return;
    const path = btn.querySelector('svg path');
    const stopping = mode === 'stop';
    if (path) path.setAttribute('d', stopping ? STOP_ICON : SEND_ICON);
    btn.setAttribute('aria-label', stopping ? 'Stop generating' : 'Send message');
    btn.classList.toggle('is-stop', stopping);
    // The stop button has to stay clickable for the whole stream.
    btn.disabled = stopping ? false : true;
  }

  function initChatUI() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const attachBtn = document.getElementById('chat-attach');
    const fileInput = document.getElementById('chat-file-input');

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      /* Do not touch the button while it is a stop control - re-enabling
         it mid-stream used to make it look live while every handler
         short-circuited on isStreaming and silently did nothing. */
      if (!isStreaming) sendBtn.disabled = !input.value.trim() && !attachedFile;
    });

    // Send on Enter (Shift+Enter for newline)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled && !isStreaming) sendMessage();
      }
    });

    sendBtn.addEventListener('click', () => {
      if (isStreaming) abortStream('user');
      else sendMessage();
    });

    // File attachment
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        attachedFile = fileInput.files[0];
        input.placeholder = `📎 ${attachedFile.name} attached. Type a message...`;
        if (!isStreaming) sendBtn.disabled = false;
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

    // Show typing indicator
    const typingEl = showTyping();

    isStreaming = true;
    abortReason = null;
    streamController = new AbortController();
    setSendMode('stop');

    let fullResponse = '';
    let reader = null;

    try {
      const systemMsg = { role: 'system', content: buildSystemPrompt() };
      const messages = [systemMsg, ...chatHistory];

      armWatchdog(FIRST_BYTE_TIMEOUT_MS);

      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, stream: true }),
        signal: streamController.signal,
      });

      if (!res.ok) {
        /* Ollama puts the only useful diagnostic in a JSON body -
           404 carries 'model "x" not found, try pulling it first', 500
           carries the runner's actual failure. Throwing the bare status
           threw that sentence away. */
        const body = await res.json().catch(() => null);
        const detail = body && typeof body.error === 'string' ? body.error : null;
        const err = new Error(detail || `Ollama returned ${res.status}`);
        err.status = res.status;
        throw err;
      }

      // Remove typing indicator
      typingEl.remove();

      // Stream response
      const aiBubble = addBubble('ai', '');
      const contentEl = aiBubble.querySelector('.bubble-content') || aiBubble;

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

      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // A chunk landed, so the runtime is alive: restart the idle clock.
        armWatchdog(IDLE_TIMEOUT_MS);

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

        if (fullResponse.length > MAX_RESPONSE_CHARS) {
          abortStream('overflow');
          break;
        }
      }

      clearWatchdog();

      // Final render, so the last frame is never dropped by the throttle.
      contentEl.innerHTML = formatMarkdown(fullResponse);
      scrollToBottom();

    } catch (err) {
      typingEl.remove();
      handleStreamError(err, fullResponse);
    } finally {
      clearWatchdog();

      /* Release the reader on every path. Aborting the controller tears
         the stream down, but on a non-2xx exit no reader was ever taken
         and on a mid-stream throw the lock would otherwise be held. */
      if (reader) {
        try { reader.cancel(); } catch (e) { /* already closed */ }
      }

      /* Whatever arrived before the failure is on screen, so it has to be
         in the history too. Dropping it left the visitor looking at half
         an answer while the model was given a transcript with two
         consecutive user turns and no reply in between - every later
         turn inherited that corruption. */
      if (fullResponse) {
        const interrupted = abortReason !== null;
        chatHistory.push({
          role: 'assistant',
          content: fullResponse + (interrupted ? '\n[response interrupted]' : ''),
        });
        trimHistory();
      }

      streamController = null;
      isStreaming = false;
      abortReason = null;
      attachedFile = null;
      setSendMode('send');
      document.getElementById('chat-file-input').value = '';
      document.getElementById('chat-input').placeholder = 'Type a message...';
    }
  }

  /* Classify before rendering. Echoing err.message put strings like
     'Failed to fetch' into an AI-styled bubble, which reads as the
     assistant answering rather than as the connection being gone. */
  function handleStreamError(err, partial) {
    console.warn('[Ollama] stream failed:', err);

    if (err.name === 'AbortError') {
      if (abortReason === 'user') return;          // deliberate stop, say nothing
      if (abortReason === 'overflow') {
        addBubble('system', 'Response stopped — it grew past the length limit.');
        return;
      }
      addBubble('system', partial
        ? 'The model stopped responding partway through.'
        : 'The model did not respond in time. It may still be loading.');
      return;
    }

    // fetch() rejects with a TypeError when the runtime is unreachable.
    if (err instanceof TypeError) {
      addBubble('system', 'Lost the connection to Ollama — is it still running?');
      returnToSetup();
      return;
    }

    if (err.status === 404) {
      addBubble('system', `${err.message}`);
      returnToSetup();
      return;
    }

    addBubble('system', err.message || 'Something went wrong talking to Ollama.');
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
      // User text and our own status lines are never parsed as markup.
      contentSpan.textContent = content;
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

  /* @pure-start — everything between these markers is free of DOM,
     network and module state, and is loaded directly by test/*.test.js.
     Keep it that way: adding a document reference here breaks the tests
     that cover the escaping. */
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
  /* @pure-end */

})();
