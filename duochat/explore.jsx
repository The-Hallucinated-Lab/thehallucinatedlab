// Explore — topic list, drill into a per-topic AI chat
// User idea: "for explore i want the AI to bring in relevant links and for each topic
// it opens a chat interface with AI. reading everything we summarise what we understand
// and then we expand it with AI."

const De = window.DUOCHAT_DATA;

function ExploreScreen({ projectData, projectName }) {
  const [openTopic, setOpenTopic] = React.useState(null);   // topic id or null

  const sourceExplore = projectData ? (projectData.explore || []) : De.explore;

  if (openTopic) {
    return <TopicChat topic={openTopic} onBack={() => setOpenTopic(null)} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }} className="dot-grid-bg">
      <ScreenHeader
        eyebrow={projectName ? `explore · ${projectName}` : "frontiers · ollama-curated"}
        title="explore"
        tagline="each topic is a room where ollama brings in links, we read together, and we expand what we understand."
        count={`${sourceExplore.length} territories`}
      />

      <div style={{ flex: 1, overflow: "auto", padding: "16px 14px 24px" }} className="no-scrollbar">
        <div style={{ display: "grid", gap: 12 }}>
          {De.explore.map(t => (
            <ExploreCard key={t.id} t={t} onOpen={() => setOpenTopic(t)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ExploreCard({ t, onOpen }) {
  const subjBg = {
    maths: "var(--violet-hl)", ai: "var(--teal-hl)", philo: "var(--rose-hl)",
  }[t.subject];

  return (
    <div className="card hoverable" style={{
      padding: 16,
      background: "var(--paper-soft)",
      position: "relative",
      overflow: "hidden",
      cursor: "pointer",
    }} onClick={onOpen}>
      <div style={{
        position: "absolute", top: 0, right: 0,
        width: 56, height: 56,
        background: `linear-gradient(225deg, ${subjBg} 50%, transparent 50%)`,
      }} />

      <div className={`tag subject ${t.subject}`} style={{ display: "inline-block" }}>
        {t.subject === "philo" ? "philosophy" : t.subject}
      </div>

      <div style={{
        fontFamily: "var(--serif)", fontSize: 22, fontWeight: 500,
        color: "var(--ink-strong)", letterSpacing: "-0.015em",
        margin: "8px 0 6px",
      }}>{t.topic}</div>

      <div style={{
        fontFamily: "var(--serif)", fontStyle: "italic",
        fontSize: 13.5, color: "var(--ink-muted)",
        lineHeight: 1.5, marginBottom: 14, textWrap: "pretty",
      }}>
        <span className="eyebrow" style={{ marginRight: 6 }}>frontier</span>
        {t.frontier}
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        fontFamily: "var(--mono)", fontSize: 10,
        color: "var(--ink-muted)", letterSpacing: "0.04em",
      }}>
        <span><span className="fig" style={{ fontSize: 15, color: "var(--ink-strong)", marginRight: 3 }}>{t.count}</span> messages</span>
        <span><span className="fig" style={{ fontSize: 15, color: "var(--ink-strong)", marginRight: 3 }}>{t.deep_dives}</span> deep dives</span>
        <span style={{ marginLeft: "auto", color: "var(--ink-strong)" }}>open chat →</span>
      </div>
    </div>
  );
}

// ── Per-topic chat view ──
function TopicChat({ topic, onBack }) {
  const tc = De.topic_chat;   // demo: same chat for any topic
  const [chat, setChat] = React.useState(tc.chat);
  const [input, setInput] = React.useState("");
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chat.length]);

  const send = () => {
    if (!input.trim()) return;
    const t = input.trim();
    setChat(c => [...c, { who: "you", text: t, time: "just now" }]);
    setInput("");
    // simulated ollama response
    setTimeout(() => {
      setChat(c => [...c, {
        who: "ollama",
        text: "that's a productive angle — it reframes the question from 'what is interpretable' to 'what is interpretation doing for us'. one direction worth pulling on: the engineering vs scientific reading splits cleanly along the kind of artefact you produce. an engineer produces a diagnostic; a scientist produces a model. interpretability serves both but the standards differ.",
        time: "just now",
      }]);
    }, 600);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* topic head with back */}
      <div style={{
        padding: "12px 16px 12px",
        borderBottom: "1px solid var(--rule)",
        background: "var(--paper)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <button onClick={onBack} style={{
            border: "none", background: "transparent",
            fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)",
            cursor: "pointer", letterSpacing: "0.04em",
            padding: "2px 6px 2px 0",
          }}>← explore</button>
          <span style={{ flex: 1 }}></span>
          <span className={`tag subject ${topic.subject}`}>
            {topic.subject === "philo" ? "philosophy" : topic.subject}
          </span>
        </div>
        <div style={{
          fontFamily: "var(--serif)", fontSize: 22, fontWeight: 600,
          color: "var(--ink-strong)", letterSpacing: "-0.015em",
        }}>{topic.topic}</div>
        <div style={{
          fontFamily: "var(--serif)", fontStyle: "italic",
          fontSize: 13, color: "var(--ink-muted)", marginTop: 3,
          textWrap: "pretty",
        }}>{topic.frontier}</div>
      </div>

      {/* what we understand so far */}
      <div style={{
        padding: "12px 16px",
        background: "var(--paper-soft)",
        borderBottom: "1px solid var(--rule-soft)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
        }}>
          <span className="eyebrow">what we understand so far</span>
          <span style={{ flex: 1 }}></span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--ink-soft)", letterSpacing: "0.04em" }}>
            expanded {tc.summary.lastExpanded}
          </span>
        </div>
        <div style={{
          fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.55,
          color: "var(--ink)", textWrap: "pretty",
        }}>{tc.summary.body}</div>
        <button style={{
          marginTop: 10,
          padding: "5px 10px",
          background: "transparent",
          color: "var(--ink-strong)",
          border: "1px dashed var(--rule)",
          borderRadius: 999,
          fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.06em",
          textTransform: "uppercase", cursor: "pointer",
        }}>↻ expand with ollama</button>
      </div>

      {/* curated links */}
      <div style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--rule-soft)",
        background: "var(--paper)",
      }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>ollama brought these in</div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto" }} className="no-scrollbar">
          {tc.curated_links.map((l, i) => <CuratedLink key={i} l={l} />)}
        </div>
      </div>

      {/* chat */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "14px 14px" }} className="no-scrollbar">
        <div style={{ display: "grid", gap: 10 }}>
          {chat.map((m, i) => <TopicChatBubble key={i} m={m} />)}
        </div>
      </div>

      {/* input */}
      <div style={{
        padding: "10px 14px 12px",
        borderTop: "1px solid var(--rule)",
        background: "var(--paper-soft)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          borderRadius: 8,
          padding: "8px 12px",
        }}>
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={`ask about ${topic.topic}…`}
            style={{
              flex: 1, border: "none", outline: "none", background: "transparent",
              fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink)",
            }} />
          <button onClick={send} style={{
            padding: "5px 12px",
            background: "var(--ink-strong)",
            color: "var(--paper-soft)",
            border: "none", borderRadius: 6,
            fontFamily: "var(--sans)", fontSize: 12, fontWeight: 500,
            cursor: "pointer",
          }}>ask</button>
        </div>
      </div>
    </div>
  );
}

function CuratedLink({ l }) {
  const glyph = { paper: "𝒫", video: "▶", article: "▤", tweet: "𝕏" }[l.kind] || "·";
  return (
    <div className="hoverable" style={{
      flexShrink: 0, width: 200,
      padding: "10px 12px",
      background: "var(--paper-soft)",
      border: "1px solid var(--rule-soft)",
      borderRadius: 8,
      cursor: "pointer",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, marginBottom: 5,
        fontFamily: "var(--mono)", fontSize: 9, color: "var(--ink-soft)",
        letterSpacing: "0.06em", textTransform: "uppercase",
      }}>
        <span>{glyph}</span>
        <span>{l.kind}</span>
      </div>
      <div style={{
        fontFamily: "var(--serif)", fontSize: 13, fontWeight: 500,
        color: "var(--ink-strong)", lineHeight: 1.3,
        marginBottom: 4,
        letterSpacing: "-0.005em",
      }}>{l.title}</div>
      <div style={{
        fontFamily: "var(--mono)", fontSize: 9, color: "var(--ink-muted)",
        letterSpacing: "0.04em", marginBottom: 6,
      }}>{l.source}</div>
      <div style={{
        fontFamily: "var(--serif)", fontStyle: "italic",
        fontSize: 11.5, color: "var(--ink-muted)", lineHeight: 1.4,
      }}>"{l.why}"</div>
    </div>
  );
}

function TopicChatBubble({ m }) {
  const isAi = m.who === "ollama";
  const isYou = m.who === "you";
  return (
    <div style={{
      display: "flex", gap: 10,
      flexDirection: isYou ? "row-reverse" : "row",
    }}>
      <div className="avatar" style={{
        width: 24, height: 24, fontSize: 10,
        background: isAi ? "var(--ink-strong)" : (isYou ? "var(--blue)" : "var(--orange)"),
        color: "var(--paper-soft)",
        flexShrink: 0,
      }}>{isAi ? "ol" : m.who[0].toUpperCase()}</div>
      <div style={{
        maxWidth: "78%",
        background: isYou ? "var(--paper-deep)" : (isAi ? "var(--paper-soft)" : "var(--paper)"),
        border: "1px solid " + (isAi ? "var(--rule)" : "var(--rule-soft)"),
        borderLeft: isAi ? "2px solid var(--ink-strong)" : null,
        padding: "9px 13px 10px",
        borderRadius: 10,
      }}>
        <div style={{
          fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.55,
          color: "var(--ink)", textWrap: "pretty",
        }}>{m.text}</div>
        <div style={{
          fontFamily: "var(--mono)", fontSize: 9.5,
          color: "var(--ink-soft)", letterSpacing: "0.04em",
          marginTop: 4,
        }}>{m.who} · {m.time}</div>
      </div>
    </div>
  );
}

Object.assign(window, { ExploreScreen });
