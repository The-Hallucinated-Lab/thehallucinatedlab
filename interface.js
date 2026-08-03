/* ============================================================
   interface.js — chat engine for the Assistant page.

   Talks to an Ollama runtime on the visitor's own machine. Nothing
   here reaches a server we control: no keys, no relay, no logging.

   Two engines sit behind one input box:

     1. The intent parser in nlp.js gets every message first. If it
        recognises a THL tool ("convert this to png"), toolkit.js runs it
        in this tab and the reply is a real file. No model is involved,
        so this path works with nothing installed.
     2. Anything the parser does not recognise goes to Ollama, exactly as
        it always has.

   That ordering is the point: the common case stops being gated behind
   a 4GB download, and the setup panel becomes optional rather than a
   wall.

   Lives in its own file rather than inline in interface.html so the
   page's Content-Security-Policy can forbid inline script outright.

   Failure model for the Ollama integration (there is exactly one):
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

  let toolManifest = null;      // spec/manifest.json, or null if it failed to load
  let pendingParse = null;      // a tool call still waiting on an argument or a file
  let ollamaReady = false;
  let resultUrls = [];          // object URLs handed to download links

  document.addEventListener('DOMContentLoaded', () => {
    loadTools();
    checkOllamaConnection();
    initChatUI();
  });

  /* Leaving the page mid-stream should release the reader, not leave a
     fetch running against the local runtime. */
  window.addEventListener('pagehide', () => {
    abortStream('user');
    for (const url of resultUrls) URL.revokeObjectURL(url);
    resultUrls = [];
  });

  /* Tools load independently of Ollama and must never block the chat: a
     failed manifest fetch costs the tool path, not the page. */
  function loadTools() {
    if (!window.THL || !window.THL.toolkit) return;
    window.THL.toolkit.loadManifest()
      .then((manifest) => { toolManifest = manifest; })
      .catch((err) => { console.warn('[THL] tool spec unavailable:', err); });
  }

  function buildSystemPrompt() {
    let prompt = 'You are the AI assistant for The Hallucinated Lab — a platform that builds local-first, privacy-respecting developer tools. You are running locally on the user\'s machine via Ollama. Be helpful, concise, and technical when needed.';

    /* Tool requests never reach the model — the parser intercepts them
       first — but the model still gets told what exists so it can answer
       "what can this do?" without inventing an answer. */
    if (toolManifest && toolManifest.tools) {
      const lines = toolManifest.tools.map((t) => `- ${t.name}: ${t.summary}`);
      prompt += ' The page itself can run these tools directly, without you: \n' + lines.join('\n') +
        '\nIf the user asks for one of those, tell them to phrase it as a direct request such as "convert this to png" and attach a file.';
    }
    return prompt;
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
    const skipBtn = document.getElementById('setup-skip');
    const setupPanel = document.getElementById('chat-setup');
    const chatContainer = document.getElementById('chat-container');

    statusEl.className = 'setup-status checking';
    statusText.textContent = 'Checking connection...';
    setupSteps.style.display = 'none';
    retryBtn.style.display = 'none';
    skipBtn.style.display = 'none';

    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
      if (!res.ok) throw new Error('Not OK');
      const data = await res.json();

      const installed = (data.models || []).map(m => m.name).filter(Boolean);
      if (installed.length === 0) {
        ollamaReady = false;
        statusEl.className = 'setup-status offline';
        statusText.textContent = 'No models installed';
        setupSteps.style.display = 'block';
        retryBtn.style.display = 'inline-flex';
        skipBtn.style.display = 'inline-flex';
      } else {
        // Prefer one of our recommended models if installed; otherwise use the first one available.
        MODEL = PREFERRED_MODELS.find(p => installed.includes(p)) || installed[0];
        ollamaReady = true;
        statusEl.className = 'setup-status online';
        statusText.textContent = 'Connected — ' + MODEL;
        setTimeout(() => {
          setupPanel.classList.add('hidden');
          chatContainer.classList.remove('hidden');
        }, 800);
      }
    } catch (e) {
      console.warn('[Ollama] connection failed:', e);
      ollamaReady = false;
      statusEl.className = 'setup-status offline';
      statusText.textContent = 'Ollama not detected (or CORS blocked)';
      setupSteps.style.display = 'block';
      retryBtn.style.display = 'inline-flex';
      skipBtn.style.display = 'inline-flex';
    }

    // Bind retry once
    if (!retryBtn.dataset.bound) {
      retryBtn.addEventListener('click', () => checkOllamaConnection());
      retryBtn.dataset.bound = '1';
    }

    /* Ollama is only needed for open-ended chat, so a visitor who just
       wants to convert a file should not be held at the setup panel
       reading install instructions they will never act on. */
    if (!skipBtn.dataset.bound) {
      skipBtn.addEventListener('click', () => {
        setupPanel.classList.add('hidden');
        chatContainer.classList.remove('hidden');
      });
      skipBtn.dataset.bound = '1';
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

    // Clear input
    input.value = '';
    input.style.height = 'auto';

    /* ---- Tool path ----
       Runs before the model and returns early when it recognises the
       request, so a conversion never touches the stream machinery
       below. Both turns still go into chatHistory: if the visitor
       switches to open-ended chat later, the model needs a transcript
       that makes sense. */
    const outcome = await runToolTurn(text);
    if (outcome) {
      chatHistory.push(userMsg, { role: 'assistant', content: outcome.reply });
      trimHistory();
      resetComposer(outcome.keepFile);
      return;
    }

    chatHistory.push(userMsg);
    trimHistory();

    /* Nothing recognised and no model to fall back on. Saying what the
       page can actually do beats a connection error the visitor cannot
       act on. */
    if (!ollamaReady) {
      const reply = capabilityText();
      addBubble('system', reply);
      chatHistory.push({ role: 'assistant', content: reply });
      trimHistory();
      resetComposer(false);
      return;
    }

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
      resetComposer(false);
    }
  }

  function resetComposer(keepFile) {
    if (!keepFile) {
      attachedFile = null;
      document.getElementById('chat-file-input').value = '';
    }
    setSendMode('send');
    document.getElementById('chat-input').placeholder = keepFile && attachedFile
      ? `📎 ${attachedFile.name} attached. Type a message...`
      : 'Type a message...';
  }

  /* ---- Tool path ----
     Returns { reply, keepFile } when the turn was handled here, or null
     to hand the message on to the model. */
  async function runToolTurn(text) {
    if (!toolManifest || !window.THL || !window.THL.nlp) return null;

    const parse = resolveParse(text);
    if (!parse.tool) return null;

    const tool = window.THL.toolkit.findTool(toolManifest, parse.tool);
    if (!tool) return null;

    /* Ask for one thing at a time. Listing every unset argument at once
       reads like a form, and the parser already knows which one it is
       actually blocked on. */
    if (parse.missing.length) {
      pendingParse = parse;
      const param = tool.params.find(p => p.name === parse.missing[0]);
      const question = (param && param.prompt) || `What should ${parse.missing[0]} be?`;
      addBubble('system', question);
      return { reply: question, keepFile: true };
    }

    if (!attachedFile) {
      pendingParse = parse;
      const ask = 'Attach an image with the paperclip and I will convert it.';
      addBubble('system', ask);
      return { reply: ask, keepFile: false };
    }

    pendingParse = null;
    const typingEl = showTyping();

    /* Not setSendMode('stop'): that button aborts a stream, and there is
       no stream here. Canvas encoding is synchronous once it starts and
       cannot be cancelled, so the honest state is a disabled button for
       the second it takes. */
    const sendBtn = document.getElementById('chat-send');
    if (sendBtn) sendBtn.disabled = true;

    try {
      const result = await window.THL.toolkit.run(parse.tool, attachedFile, parse.args, toolManifest);
      typingEl.remove();
      addResultBubble(result);
      return {
        reply: `Converted ${result.filename} (${result.width}x${result.height}, ${window.THL.toolkit.formatBytes(result.bytes)}).`,
        keepFile: false,
      };
    } catch (err) {
      typingEl.remove();
      console.warn('[THL] tool failed:', err);
      const message = err && err.message ? err.message : 'That conversion failed.';
      addBubble('system', message);
      /* Keep the file: the usual cause is an argument the visitor can
         correct and retry, and making them re-attach would be rude. */
      return { reply: message, keepFile: true };
    }
  }

  /* A pending question must not trap the visitor. A fresh tool match
     always wins; a merge only applies when the reply actually supplied
     something, or when the tool was only ever waiting on a file. Any
     other utterance clears the pending state and goes to the model. */
  function resolveParse(text) {
    const fresh = window.THL.nlp.parse(text, toolManifest);
    if (fresh.tool) { pendingParse = null; return fresh; }
    if (!pendingParse) return fresh;

    const merged = window.THL.nlp.mergeAnswer(pendingParse, text, toolManifest);
    const gained = JSON.stringify(merged.args) !== JSON.stringify(pendingParse.args);
    if (gained) return merged;
    if (attachedFile && merged.missing.length === 0) return merged;

    pendingParse = null;
    return fresh;
  }

  function capabilityText() {
    const tools = (toolManifest && toolManifest.tools) || [];
    if (!tools.length) {
      return 'Ollama is not connected, so I cannot chat right now — the setup steps are on this page.';
    }
    const lines = tools.map(t => `• ${t.title} — try "${(t.examples && t.examples[0] && t.examples[0].text) || t.name}"`);
    return 'I can run these right here, no model needed:\n' + lines.join('\n') +
      '\n\nFor open-ended conversation, connect Ollama using the setup steps on this page.';
  }

  /* The result of a tool is a file, not prose, so it gets its own bubble
     with a thumbnail and a download link rather than being flattened
     into markdown. */
  function addResultBubble(result) {
    const messages = document.getElementById('chat-messages');
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-bubble-ai';

    const url = URL.createObjectURL(result.blob);
    resultUrls.push(url);

    const wrap = document.createElement('div');
    wrap.className = 'chat-result';

    const thumb = document.createElement('img');
    thumb.className = 'chat-result-thumb';
    thumb.src = url;
    thumb.alt = '';
    thumb.width = 56;
    thumb.height = 56;

    const body = document.createElement('div');
    body.className = 'chat-result-body';

    const name = document.createElement('p');
    name.className = 'chat-result-name';
    name.textContent = result.filename;

    const meta = document.createElement('p');
    meta.className = 'chat-result-meta';
    meta.textContent = `${result.width} × ${result.height} · ${window.THL.toolkit.formatBytes(result.bytes)}`;

    const link = document.createElement('a');
    link.className = 'chat-result-download';
    link.href = url;
    link.setAttribute('download', result.filename);
    link.textContent = 'Download';

    body.append(name, meta, link);
    wrap.append(thumb, body);
    bubble.appendChild(wrap);
    messages.appendChild(bubble);
    scrollToBottom();
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
