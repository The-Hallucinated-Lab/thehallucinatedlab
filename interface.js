/* ============================================================
   interface.js — chat engine for the Assistant page.

   There is deliberately no model here, and no network call to one.
   Nothing reaches a server we control: no keys, no relay, no logging.

   How a message is handled:

     1. The intent parser in nlp.js scores the utterance against
        spec/manifest.json. If it recognises a THL tool ("convert this
        to png"), toolkit.js runs it in this tab and the reply is a real
        file. Instant, offline, nothing installed.
     2. If a required argument is missing, the assistant asks for that
        one argument and merges the answer into the pending request.
     3. Anything it does not recognise falls to capabilityText(), which
        states what the page can actually do. With no model to absorb
        the message, silence would read as breakage.

   An earlier revision streamed from a local Ollama, which meant
   installing it and setting OLLAMA_ORIGINS before the page did anything
   at all. Most visitors met a setup wall rather than an assistant. That
   path is gone - if you are looking for it in git history, it was
   removed in "Remove Ollama, add quick actions".

   Lives in its own file rather than inline in interface.html so the
   page's Content-Security-Policy can forbid inline script outright.
   ============================================================ */
(function () {
  'use strict';

  /* The transcript is no longer replayed to a model, but it still backs
     the on-screen conversation and the pending-argument flow, so it stays
     bounded rather than growing for the life of the tab. */
  const MAX_HISTORY_MESSAGES = 40;

  let chatHistory = [];
  let attachedFile = null;

  let toolManifest = null;      // spec/manifest.json, or null if it failed to load
  let pendingParse = null;      // a tool call still waiting on an argument or a file
  let resultUrls = [];          // object URLs handed to download links

  document.addEventListener('DOMContentLoaded', () => {
    loadTools();
    initChatUI();
  });

  window.addEventListener('pagehide', () => {
    for (const url of resultUrls) URL.revokeObjectURL(url);
    resultUrls = [];
  });

  /* A failed manifest fetch costs the tool path, not the page. */
  function loadTools() {
    if (!window.THL || !window.THL.toolkit) return;
    window.THL.toolkit.loadManifest()
      .then((manifest) => { toolManifest = manifest; })
      .catch((err) => { console.warn('[THL] tool spec unavailable:', err); });
  }

  /* ---- Chat UI ---- */
  const SEND_ICON = 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z';

  /* Kept as a function rather than inlined: resetComposer still calls it,
     and a tool turn is synchronous enough that there is no stop state to
     model any more. */
  function setSendMode() {
    const btn = document.getElementById('chat-send');
    if (!btn) return;
    const path = btn.querySelector('svg path');
    if (path) path.setAttribute('d', SEND_ICON);
    btn.setAttribute('aria-label', 'Send message');
    btn.classList.remove('is-stop');
    btn.disabled = true;
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
      sendBtn.disabled = !input.value.trim() && !attachedFile;
    });

    // Send on Enter (Shift+Enter for newline)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) sendMessage();
      }
    });

    sendBtn.addEventListener('click', () => sendMessage());

    /* Chips fill the composer rather than sending. The visitor sees the
       exact phrasing that worked, which teaches the parser's vocabulary;
       auto-sending would hide it. Delegated from the container so the
       chip set can change without rebinding. */
    const quick = document.getElementById('chat-quick');
    if (quick) {
      quick.addEventListener('click', (e) => {
        const chip = e.target.closest('.chat-chip');
        if (!chip) return;
        input.value = chip.dataset.fill;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    }

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
    /* Nothing recognised, and there is deliberately no model behind this.
       Saying what the page can actually do beats silence. */
    const reply = capabilityText();
    addBubble('system', reply);
    chatHistory.push({ role: 'assistant', content: reply });
    trimHistory();
    resetComposer(false);
  }


  function resetComposer(keepFile) {
    if (!keepFile) {
      attachedFile = null;
      document.getElementById('chat-file-input').value = '';
    }
    setSendMode();
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

    /* Canvas encoding is synchronous once it starts and cannot be
       cancelled, so the honest state is a disabled button for the second
       it takes rather than a stop control that would not work. */
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
    /* No manifest means the spec fetch failed, not that the request was
       unrecognised. Say which, so a broken deploy is not mistaken for the
       visitor phrasing something wrong. */
    if (!tools.length) {
      return 'I could not load the tool list, so I cannot route anything right now. Reloading the page usually fixes it.';
    }
    const lines = tools.map(t => `• ${t.title} — try "${(t.examples && t.examples[0] && t.examples[0].text) || t.name}"`);
    return 'I did not catch a tool request in that. Here is what I can run, right here in the page:\n' + lines.join('\n') +
      '\n\nAttach a file with the paperclip first, then say what you want done with it.';
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
