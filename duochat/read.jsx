// Read — active reading view with AI margin notes
// User idea: "for read it's active read — AI there so i can ask what does this mean.
// when i upload something, AI auto-recognises the hard stuff and creates analogies
// i can refer to while reading that page."

const Dr = window.DUOCHAT_DATA;

function ReadScreen({ projectData, projectName }) {
  const [view, setView] = React.useState("active");  // active | library
  const [openSpan, setOpenSpan] = React.useState(null);  // which [[term]] is open
  const [chatInput, setChatInput] = React.useState("");

  const sourceReads = projectData ? (projectData.reads || []) : Dr.reads;
  const sourceDoc = projectData && projectData.active_doc ? projectData.active_doc : Dr.active_doc;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ScreenHeader
        eyebrow={projectName ? `read · ${projectName}` : "read · active"}
        title="library"
        tagline="open a document and ollama auto-marks the hard parts — tap any to get an analogy, ask anything."
        count={`${sourceReads.length} on the desk`}
      />

      {/* sub-tabs */}
      <div style={{
        padding: "10px 14px 0",
        display: "flex", gap: 14,
        background: "var(--paper)",
        borderBottom: "1px solid var(--rule-soft)",
      }}>
        {[{ id: "active", label: "active reading" }, { id: "library", label: "library" }].map(t => (
          <button key={t.id} onClick={() => setView(t.id)}
            style={{
              padding: "6px 0 9px",
              fontFamily: "var(--sans)", fontSize: 12,
              color: view === t.id ? "var(--ink-strong)" : "var(--ink-muted)",
              background: "none", border: "none",
              borderBottom: "2px solid " + (view === t.id ? "var(--ink-strong)" : "transparent"),
              cursor: "pointer", fontWeight: 500,
              marginBottom: -1,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {view === "active" ? (
          <ActiveReader openSpan={openSpan} setOpenSpan={setOpenSpan} chatInput={chatInput} setChatInput={setChatInput} sourceDoc={sourceDoc} />
        ) : (
          <ReadLibrary sourceReads={sourceReads} />
        )}
      </div>
    </div>
  );
}

// ── Active reader: document + margin AI notes ──
function ActiveReader({ openSpan, setOpenSpan, chatInput, setChatInput, sourceDoc }) {
  const doc = sourceDoc;

  return (
    <>
      {/* document head */}
      <div style={{ padding: "14px 18px 10px", borderBottom: "1px solid var(--rule-soft)", background: "var(--paper)" }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>{doc.section}</div>
        <div style={{
          fontFamily: "var(--serif)", fontSize: 17, fontWeight: 500,
          color: "var(--ink-strong)", lineHeight: 1.3, letterSpacing: "-0.01em",
          textWrap: "pretty",
        }}>{doc.title}</div>
        <div style={{
          fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 12,
          color: "var(--ink-muted)", marginTop: 2,
        }}>{doc.authors}</div>

        {/* progress strip */}
        <div style={{
          marginTop: 10, height: 3, background: "var(--paper-deep)",
          borderRadius: 2, overflow: "hidden",
        }}>
          <div style={{ width: `${doc.progress * 100}%`, height: "100%", background: "var(--ink-strong)" }} />
        </div>
        <div style={{
          marginTop: 4,
          fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)",
          letterSpacing: "0.04em",
          display: "flex", justifyContent: "space-between",
        }}>
          <span>page {doc.page} / {doc.totalPages}</span>
          <span>{Object.keys(doc.analogies).length} hard parts on this page · ollama detected</span>
        </div>
      </div>

      {/* document body — scrollable */}
      <div style={{ flex: 1, overflow: "auto", position: "relative" }} className="no-scrollbar">
        <div style={{
          padding: "20px 18px 20px",
          maxWidth: 640, margin: "0 auto",
        }}>
          {doc.paragraphs.map((p, i) => (
            <Paragraph key={i} text={p.text} analogies={doc.analogies} setOpenSpan={setOpenSpan} />
          ))}

          {/* margin notes inline section heading */}
          <div style={{
            marginTop: 32, marginBottom: 14,
            paddingBottom: 6, borderBottom: "1px solid var(--rule-soft)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span className="eyebrow">conversation about this page</span>
            <span style={{ flex: 1 }}></span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)", letterSpacing: "0.04em" }}>
              {doc.margin_chat.length} messages
            </span>
          </div>

          {/* page chat */}
          <div style={{ display: "grid", gap: 10 }}>
            {doc.margin_chat.map((m, i) => <PageChatBubble key={i} m={m} />)}
          </div>
        </div>

        {/* analogy popover */}
        {openSpan && doc.analogies[openSpan] && (
          <AnalogyPopover term={openSpan} a={doc.analogies[openSpan]} onClose={() => setOpenSpan(null)} />
        )}
      </div>

      {/* ask-anything input */}
      <div style={{
        padding: "10px 14px 12px",
        borderTop: "1px solid var(--rule)",
        background: "var(--paper-soft)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span className="eyebrow" style={{ fontSize: 9 }}>ask ollama about this page</span>
          <span style={{ flex: 1 }}></span>
          {Object.keys(doc.analogies).slice(0, 2).map(t => (
            <button key={t} onClick={() => setChatInput(`what is ${t}?`)} style={{
              padding: "2px 7px", borderRadius: 999,
              border: "1px dashed var(--rule)",
              background: "transparent",
              fontFamily: "var(--mono)", fontSize: 9.5,
              color: "var(--blue)", letterSpacing: "0.04em",
              cursor: "pointer",
            }}>?  {t}</button>
          ))}
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          borderRadius: 8,
          padding: "8px 12px",
        }}>
          <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
            placeholder="what does this passage mean?"
            style={{
              flex: 1, border: "none", outline: "none", background: "transparent",
              fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink)",
            }} />
          <button style={{
            padding: "5px 12px",
            background: "var(--ink-strong)",
            color: "var(--paper-soft)",
            border: "none", borderRadius: 6,
            fontFamily: "var(--sans)", fontSize: 12, fontWeight: 500,
            cursor: "pointer",
          }}>ask</button>
        </div>
      </div>
    </>
  );
}

// ── Paragraph that parses [[term]] markers into clickable highlighted spans ──
function Paragraph({ text, analogies, setOpenSpan }) {
  // parse [[term]] occurrences
  const parts = [];
  const re = /\[\[(.+?)\]\]/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: "t", v: text.slice(last, m.index) });
    parts.push({ kind: "term", v: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "t", v: text.slice(last) });

  return (
    <p style={{
      fontFamily: "var(--serif)",
      fontSize: 16, lineHeight: 1.7,
      color: "var(--ink)",
      textWrap: "pretty",
      marginTop: 0, marginBottom: 18,
      letterSpacing: "0.003em",
    }}>
      {parts.map((p, i) => {
        if (p.kind === "t") return <React.Fragment key={i}>{p.v}</React.Fragment>;
        const has = analogies[p.v];
        return (
          <span key={i} onClick={() => has && setOpenSpan(p.v)}
            style={{
              background: "linear-gradient(105deg, transparent 1%, var(--blue-hl) 4%, var(--blue-hl) 96%, transparent 99%)",
              color: "var(--ink-strong)",
              padding: "1px 3px",
              margin: "0 -1px",
              borderRadius: 2,
              cursor: "pointer",
              borderBottom: "1px dashed var(--blue)",
              position: "relative",
            }}>
            {p.v}
            <sup style={{
              fontFamily: "var(--mono)", fontSize: 8.5,
              color: "var(--blue)", marginLeft: 2,
              letterSpacing: 0,
            }}>?</sup>
          </span>
        );
      })}
    </p>
  );
}

function AnalogyPopover({ term, a, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0,
      background: "rgba(30,24,16,0.20)",
      display: "flex", alignItems: "flex-end",
      animation: "fadeIn 200ms ease-out",
      zIndex: 30,
    }}>
      <div onClick={(e) => e.stopPropagation()}
        className="fade-in"
        style={{
          width: "100%",
          background: "var(--paper-soft)",
          borderTop: "1px solid var(--rule)",
          borderTopLeftRadius: 12, borderTopRightRadius: 12,
          padding: "16px 18px 18px",
          boxShadow: "0 -8px 28px rgba(40,30,15,0.18)",
        }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <span className="eyebrow">analogy · ollama auto-generated</span>
          <span style={{ flex: 1 }}></span>
          <button onClick={onClose} style={{
            border: "none", background: "transparent",
            fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)",
            cursor: "pointer",
          }}>close ✕</button>
        </div>

        <div style={{
          fontFamily: "var(--serif)", fontSize: 17, fontWeight: 500,
          color: "var(--ink-strong)", marginBottom: 8, letterSpacing: "-0.005em",
        }}>{term}</div>

        <div style={{
          fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 14,
          color: "var(--ink-muted)", marginBottom: 12,
          paddingBottom: 12, borderBottom: "1px dashed var(--rule)",
        }}>{a.short}</div>

        <div style={{
          fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.6,
          color: "var(--ink)", textWrap: "pretty",
        }}>
          <span className="eyebrow" style={{ marginRight: 6 }}>imagine</span>
          {a.long}
        </div>

        <div style={{
          display: "flex", gap: 8, marginTop: 16,
        }}>
          <button style={{
            flex: 1, padding: "8px 12px",
            background: "transparent",
            color: "var(--ink-strong)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            fontFamily: "var(--sans)", fontSize: 12, cursor: "pointer",
          }}>good analogy ✓</button>
          <button style={{
            flex: 1, padding: "8px 12px",
            background: "transparent",
            color: "var(--ink-muted)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            fontFamily: "var(--sans)", fontSize: 12, cursor: "pointer",
          }}>try another</button>
        </div>
      </div>
    </div>
  );
}

function PageChatBubble({ m }) {
  const isAi = m.who === "ollama";
  const isYou = m.who === "you";
  return (
    <div style={{
      display: "flex", gap: 10,
      flexDirection: isYou ? "row-reverse" : "row",
    }}>
      <div className="avatar" style={{
        width: 22, height: 22, fontSize: 10,
        background: isAi ? "var(--ink-strong)" : "var(--blue)",
        color: "var(--paper-soft)",
        flexShrink: 0,
      }}>{isAi ? "ol" : m.who[0].toUpperCase()}</div>
      <div style={{
        maxWidth: "82%",
        background: isYou ? "var(--paper-deep)" : (isAi ? "var(--paper-soft)" : "var(--paper)"),
        border: "1px solid " + (isAi ? "var(--rule)" : "var(--rule-soft)"),
        borderLeft: isAi ? "2px solid var(--ink-strong)" : "1px solid var(--rule-soft)",
        padding: "8px 12px 9px",
        borderRadius: 8,
      }}>
        <div style={{
          fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.5,
          color: "var(--ink)",
          textWrap: "pretty",
        }}>{m.text}</div>
        <div style={{
          fontFamily: "var(--mono)", fontSize: 9.5,
          color: "var(--ink-soft)", letterSpacing: "0.04em",
          marginTop: 3,
        }}>{m.who} · {m.time}</div>
      </div>
    </div>
  );
}

// ── Library ──
function ReadLibrary({ sourceReads }) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 14px 24px" }} className="no-scrollbar">
      {sourceReads.map(r => <LibraryReadRow key={r.id} r={r} />)}
    </div>
  );
}

function LibraryReadRow({ r }) {
  const statusColor = {
    done: "var(--green)",
    "in-progress": "var(--blue)",
    draft: "var(--orange)",
    queued: "var(--ink-soft)",
  }[r.breakdownStatus] || "var(--ink-soft)";

  return (
    <div className="hoverable" style={{
      padding: "12px 4px",
      borderBottom: "1px solid var(--rule-soft)",
      display: "flex", gap: 12, alignItems: "center",
    }}>
      <div style={{
        width: 38, height: 50, flexShrink: 0,
        background: r.kind === "book" ? "var(--paper-deep)" : "var(--paper-soft)",
        border: "1px solid var(--rule)",
        borderRadius: r.kind === "book" ? "2px 4px 4px 2px" : "1px",
        position: "relative",
      }}>
        <div style={{
          position: "absolute", inset: 4,
          background: `repeating-linear-gradient(0deg, transparent 0px, transparent 4px, var(--rule-soft) 4px, var(--rule-soft) 5px)`,
        }} />
        <span style={{
          position: "absolute", top: 4, left: 4,
          fontFamily: "var(--mono)", fontSize: 8, color: "var(--ink-soft)",
        }}>{r.kind === "book" ? "BK" : "PP"}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--serif)", fontSize: 14.5, fontWeight: 500,
          color: "var(--ink-strong)", lineHeight: 1.3,
        }}>{r.title}</div>
        <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 12, color: "var(--ink-muted)", marginTop: 2 }}>{r.authors}</div>
        <div style={{ height: 2, background: "var(--paper-deep)", marginTop: 6, borderRadius: 1 }}>
          <div style={{ width: `${r.progress * 100}%`, height: "100%", background: r.progress === 1 ? "var(--green)" : "var(--ink-strong)" }} />
        </div>
      </div>
      <div style={{
        flexShrink: 0, textAlign: "right",
        fontFamily: "var(--mono)", fontSize: 9.5,
        color: "var(--ink-muted)", letterSpacing: "0.04em",
      }}>
        <div style={{ color: statusColor }}>{r.breakdownStatus}</div>
        <div style={{ marginTop: 2 }}>{r.lastTouched}</div>
      </div>
    </div>
  );
}

Object.assign(window, { ReadScreen });
