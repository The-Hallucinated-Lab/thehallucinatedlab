// Chat screen + discussion panel
// Features:
// - Daily chat with date strip + AI end-of-day summaries (past days)
// - Dynamic composer: select a tag while typing → text gets that style;
//   click same tag again to deselect; switch tags freely within one message
// - Send actually works (appends to local state)
// - Merge messages: any message can be marked merged-with-previous (single entity)
// - Right-side discussion panel with discussion/understanding/podcast subspaces

const D = window.DUOCHAT_DATA;

// ─── Render an inline-tagged body ───
function MessageBody({ body, onTagClick }) {
  return (
    <span>
      {body.map((seg, i) => {
        if (seg.t === "text" || (!seg.t && !seg.kind)) {
          return <React.Fragment key={i}>{seg.v}</React.Fragment>;
        }
        // tag segment (either t:"tag" + kind, or just kind set)
        const kind = seg.kind;
        if (!kind) return <React.Fragment key={i}>{seg.v}</React.Fragment>;
        let cls;
        if (kind === "subject") {
          cls = `tag subject ${seg.subject}`;
        } else if (["idea", "question", "explore", "project"].includes(kind)) {
          cls = `tag ${kind}`;
        } else {
          cls = `tag custom`;
        }
        const customStyle = (kind !== "idea" && kind !== "question" && kind !== "explore" && kind !== "project" && kind !== "subject" && seg.color)
          ? { color: seg.color, borderBottom: `1px dashed ${seg.color}` }
          : null;
        return (
          <span key={i} className={cls} style={customStyle}
                onClick={(e) => { e.stopPropagation(); onTagClick && onTagClick(seg); }}>
            {seg.v}
          </span>
        );
      })}
    </span>
  );
}

// ─── Single message ───
function Message({ m, onOpen, onMergeToggle, mergedWithPrev, prevAuthor }) {
  // If merged with the previous message: hide avatar/header,
  // share left bracket connector with the prior message.
  return (
    <div
      onClick={() => onOpen(m)}
      style={{
        padding: mergedWithPrev ? "4px 18px 10px 60px" : "16px 18px 14px",
        borderBottom: mergedWithPrev ? "none" : "1px solid var(--rule-soft)",
        cursor: "pointer",
        position: "relative",
      }}
      className="fade-in msg-row"
    >
      {/* merge bracket connector */}
      {mergedWithPrev && (
        <div style={{
          position: "absolute",
          left: 32, top: -2, bottom: 8,
          width: 8,
          borderLeft: "1.5px solid var(--ink-soft)",
          borderBottom: "1.5px solid var(--ink-soft)",
          borderBottomLeftRadius: 6,
        }} />
      )}

      <div style={{ display: "flex", gap: 12 }}>
        {!mergedWithPrev && (
          <div className="avatar" style={{
            background: m.avatarColor,
            color: "#faf4e7",
          }}>{m.author[0].toUpperCase()}</div>
        )}
        {mergedWithPrev && <div style={{ width: 32, flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* author row */}
          {!mergedWithPrev && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
              <span style={{
                fontFamily: "var(--sans)", fontWeight: 600, fontSize: 14,
                color: "var(--ink-strong)", letterSpacing: "-0.005em",
              }}>{m.author}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-soft)" }}>{m.time}</span>
            </div>
          )}

          {/* body */}
          <div style={{
            fontFamily: "var(--serif)", fontSize: 15.5, lineHeight: 1.55,
            color: "var(--ink)", letterSpacing: "0.005em", textWrap: "pretty",
          }}>
            <MessageBody body={m.body} />
          </div>

          {/* AI response card */}
          {m.ai && (
            <div className="ai-card" style={{ marginTop: 14 }}>
              <div style={{
                fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.55,
                color: "var(--ink)", fontStyle: "italic", marginBottom: 8,
              }}>
                "{m.ai.text.slice(0, 220)}…"
              </div>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                fontFamily: "var(--mono)", fontSize: 10,
                color: "var(--ink-muted)", letterSpacing: "0.04em",
              }}>
                <span>{m.ai.words} words</span>
                <span>·</span>
                <span>{m.ai.time}</span>
                <span style={{ marginLeft: "auto", color: "var(--ink-strong)" }}>read full →</span>
              </div>
            </div>
          )}

          {/* reactions + actions */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            marginTop: 10, flexWrap: "wrap",
          }}>
            {(m.reactions || []).map((r, i) => (
              <span key={i} style={{
                padding: "2px 8px",
                background: "var(--paper-deep)",
                border: "1px solid var(--rule-soft)",
                borderRadius: 999,
                fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)",
                display: "inline-flex", alignItems: "center", gap: 5,
              }}>
                <span style={{ color: "var(--ink-strong)" }}>{r.glyph}</span>
                {r.count}
              </span>
            ))}
            <span style={{
              padding: "2px 8px",
              fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)",
            }}>＋</span>

            {/* merge button — visible only if prev message exists */}
            {prevAuthor && (
              <button onClick={(e) => { e.stopPropagation(); onMergeToggle(m.id); }}
                style={{
                  padding: "2px 8px",
                  background: mergedWithPrev ? "var(--ink-strong)" : "transparent",
                  color: mergedWithPrev ? "var(--paper-soft)" : "var(--ink-muted)",
                  border: "1px dashed " + (mergedWithPrev ? "var(--ink-strong)" : "var(--rule)"),
                  borderRadius: 999,
                  fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.06em",
                  textTransform: "uppercase", cursor: "pointer",
                }} title={`treat as one entity with ${prevAuthor}'s prior message`}>
                {mergedWithPrev ? "merged ↑" : "merge ↑"}
              </button>
            )}

            {m.discussionCount > 0 && (
              <span style={{
                marginLeft: "auto",
                fontFamily: "var(--mono)", fontSize: 11,
                color: "var(--ink-strong)",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 3a1 1 0 011-1h6a1 1 0 011 1v4a1 1 0 01-1 1H5l-3 2V3z" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
                {m.discussionCount} in discussion →
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Channel header ───
function ChannelHeader({ channel, tagline }) {
  return (
    <div style={{
      padding: "12px 18px 10px",
      borderBottom: "1px solid var(--rule)",
      background: "var(--paper)",
      position: "sticky", top: 0, zIndex: 5,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ color: "var(--ink-soft)", fontFamily: "var(--mono)", fontSize: 16 }}>#</span>
        <span style={{
          fontFamily: "var(--serif)", fontSize: 18, fontWeight: 600,
          color: "var(--ink-strong)", letterSpacing: "-0.01em",
        }}>{channel}</span>
      </div>
      {tagline && (
        <div style={{
          fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13,
          color: "var(--ink-muted)", marginTop: 4, letterSpacing: "0.005em",
        }}>{tagline}</div>
      )}
    </div>
  );
}

// ─── Calendar View ───
function CalendarView({ onClose, onSelect }) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const emptyDays = [1, 2, 3]; // Apr 2026 starts Wed
  const totalDays = 30;

  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.1)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: 20
    }}>
      <div className="fade-in" style={{
        background: "var(--paper)", border: "1px solid var(--rule-soft)",
        borderRadius: 12, padding: "20px", width: "100%", maxWidth: 320,
        boxShadow: "0 10px 30px rgba(0,0,0,0.05)"
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 16
        }}>
          <span style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 500, color: "var(--ink-strong)" }}>April 2026</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", cursor: "pointer",
            fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)",
            textTransform: "uppercase", letterSpacing: "0.06em"
          }}>close</button>
        </div>
        
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 8 }}>
          {days.map(d => (
            <div key={d} style={{
              textAlign: "center", fontFamily: "var(--mono)", fontSize: 9,
              color: "var(--ink-soft)", textTransform: "uppercase"
            }}>{d}</div>
          ))}
        </div>
        
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {emptyDays.map(i => <div key={`empty-${i}`} />)}
          {Array.from({ length: totalDays }).map((_, i) => {
            const date = i + 1;
            const fullDate = `2026-04-${date.toString().padStart(2, "0")}`;
            const hasData = date === 30 || date === 29 || date === 28;
            return (
              <button key={date} onClick={() => { 
                  if(hasData) {
                    onSelect(date === 30 ? "today" : fullDate);
                    onClose();
                  }
                }}
                style={{
                  aspectRatio: "1", borderRadius: "50%",
                  border: hasData ? "1px solid var(--rule)" : "1px solid transparent",
                  background: date === 30 ? "var(--ink-strong)" : (hasData ? "var(--paper-soft)" : "transparent"),
                  color: date === 30 ? "var(--paper)" : (hasData ? "var(--ink-strong)" : "var(--ink-muted)"),
                  fontFamily: "var(--mono)", fontSize: 11,
                  cursor: hasData ? "pointer" : "not-allowed",
                  opacity: hasData ? 1 : 0.4,
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}>
                {date}
              </button>
            );
          })}
        </div>
        <div style={{
          marginTop: 16, fontFamily: "var(--mono)", fontSize: 9,
          color: "var(--ink-soft)", textAlign: "center", letterSpacing: "0.04em"
        }}>
          only highlighted days have history
        </div>
      </div>
    </div>
  );
}

// ─── Day strip ───
function DayStrip({ currentDay, setCurrentDay, onOpenCalendar }) {
  // today and the most recent 2 past days
  const days = [
    { id: "today", label: "today", date: "Apr 30", hasSummary: false },
    { id: "2026-04-29", label: "yesterday", date: "Apr 29", hasSummary: true },
    { id: "2026-04-28", label: "2 days ago", date: "Apr 28", hasSummary: true },
  ];

  return (
    <div style={{
      display: "flex", gap: 6, padding: "8px 14px",
      borderBottom: "1px solid var(--rule-soft)",
      background: "var(--paper)",
      overflowX: "auto",
    }} className="no-scrollbar">
      {days.map((d) => {
        const isActive = currentDay === d.id;
        return (
          <button key={d.id} onClick={() => setCurrentDay(d.id)} style={{
            padding: "5px 10px",
            border: "1px solid " + (isActive ? "var(--ink-strong)" : "var(--rule)"),
            background: isActive ? "var(--paper-soft)" : "transparent",
            borderRadius: 6,
            cursor: "pointer",
            display: "inline-flex", flexDirection: "column", alignItems: "flex-start",
            gap: 1, lineHeight: 1.1, flexShrink: 0,
            minWidth: 76,
          }}>
            <span style={{
              fontFamily: "var(--mono)", fontSize: 9.5,
              color: isActive ? "var(--ink-strong)" : "var(--ink-muted)",
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>{d.label}</span>
            <span style={{
              fontFamily: "var(--serif)", fontSize: 12.5, fontWeight: 500,
              color: isActive ? "var(--ink-strong)" : "var(--ink-muted)",
            }}>{d.date}</span>
            {d.hasSummary && (
              <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, color: "var(--ink-soft)", letterSpacing: "0.04em" }}>
                ✦ summarised
              </span>
            )}
          </button>
        );
      })}
      <button onClick={onOpenCalendar} style={{
        padding: "5px 10px",
        border: "1px dashed var(--rule)",
        background: "transparent",
        borderRadius: 6, cursor: "pointer", flexShrink: 0,
        fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--ink-muted)",
        letterSpacing: "0.04em",
      }}>calendar ⌗</button>
    </div>
  );
}

// ─── Day summary card ───
function DaySummaryCard({ summary }) {
  return (
    <div className="ai-card" style={{
      margin: "16px 14px 4px",
      padding: "16px 16px 14px",
    }}>
      <div style={{
        fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--ink-muted)",
        letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4,
      }}>
        end-of-day summary · {summary.date} · 23:59
      </div>
      <div style={{
        fontFamily: "var(--serif)", fontSize: 16, fontWeight: 500,
        color: "var(--ink-strong)", lineHeight: 1.35,
        letterSpacing: "-0.005em", marginBottom: 8, textWrap: "pretty",
      }}>"{summary.headline}"</div>
      <div style={{
        fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.6,
        color: "var(--ink)", textWrap: "pretty", marginBottom: 10,
      }}>{summary.body}</div>
      <div style={{
        display: "flex", gap: 14,
        fontFamily: "var(--mono)", fontSize: 10,
        color: "var(--ink-muted)", letterSpacing: "0.04em",
      }}>
        <span><span style={{ color: "var(--ink-strong)" }}>{summary.writes}</span> messages</span>
        <span><span style={{ color: "var(--red)" }}>{summary.hatched}</span> hatched</span>
        <span><span style={{ color: "var(--green)" }}>{summary.openQs}</span> open ?</span>
      </div>
    </div>
  );
}

// ─── Dynamic composer ─────────────────────────────────
// Segments accumulate as you toggle tags. Clicking the active tag deselects it.
function Composer({ onSend }) {
  const [activeTag, setActiveTag] = React.useState(null);
  const [segments, setSegments] = React.useState([]);   // committed segments
  const [current, setCurrent] = React.useState("");
  const inputRef = React.useRef(null);

  const tagOptions = [
    { kind: "idea",     color: "var(--red)",    label: "idea" },
    { kind: "question", color: "var(--green)",  label: "question" },
    { kind: "explore",  color: "var(--blue)",   label: "explore" },
    { kind: "project",  color: "var(--orange)", label: "project" },
  ];

  // Commit current input to segments under the *current* activeTag, then switch tag
  const switchTag = (newTag) => {
    const txt = current;   // commit even whitespace-only? No — keep meaningful
    let next = segments;
    if (txt.length > 0) {
      next = [...segments, activeTag
        ? { t: "tag", kind: activeTag, v: txt }
        : { t: "text", v: txt }];
    }
    setSegments(next);
    setCurrent("");
    setActiveTag(newTag);
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  };

  const toggleTag = (kind) => {
    switchTag(activeTag === kind ? null : kind);
  };

  const send = () => {
    let body = segments;
    if (current.trim().length > 0) {
      body = [...segments, activeTag
        ? { t: "tag", kind: activeTag, v: current }
        : { t: "text", v: current }];
    }
    if (body.length === 0) return;
    onSend(body);
    setSegments([]);
    setCurrent("");
    setActiveTag(null);
  };

  const clearDraft = () => {
    setSegments([]);
    setCurrent("");
    setActiveTag(null);
  };

  const activeColor = activeTag
    ? { idea: "var(--red)", question: "var(--green)", explore: "var(--blue)", project: "var(--orange)" }[activeTag]
    : "var(--ink)";

  const hasDraft = segments.length > 0 || current.length > 0;

  return (
    <div style={{
      borderTop: "1px solid var(--rule)",
      background: "var(--paper-soft)",
      padding: "10px 14px 12px",
    }}>
      {/* tag picker row */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ marginRight: 4 }}>tag</span>
        {tagOptions.map(t => {
          const on = activeTag === t.kind;
          return (
            <button key={t.kind} onClick={() => toggleTag(t.kind)} style={{
              padding: "3px 10px",
              borderRadius: 999,
              border: "1px solid " + (on ? t.color : "var(--rule)"),
              background: on ? t.color : "transparent",
              color: on ? "var(--paper-soft)" : t.color,
              fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.06em",
              textTransform: "uppercase", cursor: "pointer",
            }}>{t.label}</button>
          );
        })}
        {hasDraft && (
          <button onClick={clearDraft} style={{
            marginLeft: "auto", padding: "3px 8px",
            border: "1px solid var(--rule)", borderRadius: 999,
            background: "transparent",
            fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--ink-muted)",
            letterSpacing: "0.04em", cursor: "pointer",
          }}>clear ✕</button>
        )}
      </div>

      {/* draft preview (visible only when there are committed segments) */}
      {segments.length > 0 && (
        <div style={{
          padding: "8px 12px",
          background: "var(--paper)",
          border: "1px dashed var(--rule)",
          borderRadius: 8,
          marginBottom: 6,
          fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.55,
          color: "var(--ink)",
        }}>
          <MessageBody body={segments} />
          {current && (
            <span style={{
              color: activeColor,
              fontStyle: activeTag === "project" ? "normal" : (activeTag ? "italic" : "normal"),
              opacity: 0.7,
            }}>{current}</span>
          )}
        </div>
      )}

      {/* live input — color reflects active tag */}
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 8,
        background: "var(--paper)",
        border: "1px solid " + (activeTag ? activeColor : "var(--rule)"),
        borderRadius: 8,
        padding: "8px 10px",
      }}>
        <textarea
          ref={inputRef}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={activeTag ? `typing as ${activeTag}…` : "say something… toggle tags as you go"}
          rows={1}
          style={{
            flex: 1, resize: "none", border: "none", outline: "none",
            background: "transparent",
            fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.5,
            color: activeColor,
            fontStyle: activeTag && activeTag !== "project" ? "italic" : "normal",
            minHeight: 22,
          }}
        />
        <button className="icon-btn" title="podcast-on-this" style={{ flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="5" y="2" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M3 7a4 4 0 008 0M7 11v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
        <button onClick={send} disabled={!hasDraft} style={{
          flexShrink: 0, height: 32, padding: "0 14px",
          border: "1px solid var(--ink-strong)",
          background: hasDraft ? "var(--ink-strong)" : "var(--paper-deep)",
          color: hasDraft ? "var(--paper-soft)" : "var(--ink-soft)",
          fontFamily: "var(--sans)", fontWeight: 500, fontSize: 12,
          borderRadius: 6,
          cursor: hasDraft ? "pointer" : "not-allowed",
        }}>send</button>
      </div>

      {/* helper text */}
      <div style={{
        marginTop: 6, fontFamily: "var(--mono)", fontSize: 9.5,
        color: "var(--ink-soft)", letterSpacing: "0.04em",
      }}>
        select a tag → type → toggle off or switch to mix tags within one message
      </div>
    </div>
  );
}

// ─── Chat screen ───
function ChatScreen({ onOpenDiscussion, channelName = "duochat-shift", tagline = "features & protocol decisions for our move to duochat", projectData }) {
  const [currentDay, setCurrentDay] = React.useState("today");
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const defaultMessagesToday = projectData ? (projectData.messages_today || []) : D.messages_today;
  const [todayMessages, setTodayMessages] = React.useState(defaultMessagesToday);
  const [merged, setMerged] = React.useState(new Set());

  const handleSend = (body) => {
    const next = {
      id: "u" + Date.now(),
      author: "you",
      avatarColor: "var(--ink-strong)",
      time: "now",
      body,
      ai: null,
      reactions: [],
      discussionCount: 0,
    };
    setTodayMessages(prev => [...prev, next]);
    // simulate AI auto-response if body contains an idea
    const hasIdea = body.some(s => s.kind === "idea");
    if (hasIdea) {
      setTimeout(() => {
        setTodayMessages(prev => prev.map(m => m.id === next.id ? {
          ...m,
          ai: {
            words: 506,
            time: "now",
            text: "an idea worth holding in the lab. the move from intuition to mechanism here matters: the idea sounds whole, but its parts compose differently than you might expect at first read. before committing to a build, consider the failure modes — what does this look like when it goes wrong, and who notices first?…",
          },
        } : m));
      }, 800);
    }
  };

  const handleMergeToggle = (id) => {
    setMerged(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  let messages, summary = null;
  if (currentDay === "today") {
    messages = todayMessages;
  } else if (currentDay === "2026-04-29") {
    messages = projectData ? (projectData.messages || []) : D.messages;
    const summaries = projectData ? (projectData.daily_summaries || []) : D.daily_summaries;
    summary = summaries.find(s => s.iso === "2026-04-29");
  } else if (currentDay === "2026-04-28") {
    messages = [];   // demo: 2 days ago is summarised but messages compacted away
    const summaries = projectData ? (projectData.daily_summaries || []) : D.daily_summaries;
    summary = summaries.find(s => s.iso === "2026-04-28");
  } else {
    messages = [];
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {calendarOpen && <CalendarView onClose={() => setCalendarOpen(false)} onSelect={setCurrentDay} />}
      <ChannelHeader channel={channelName} tagline={tagline} />
      <DayStrip currentDay={currentDay} setCurrentDay={setCurrentDay} onOpenCalendar={() => setCalendarOpen(true)} />

      <div style={{ flex: 1, overflow: "auto" }} className="no-scrollbar">
        {summary && <DaySummaryCard summary={summary} />}

        {messages.length === 0 && !summary && (
          <div style={{
            padding: 30, textAlign: "center",
            fontFamily: "var(--serif)", fontStyle: "italic",
            color: "var(--ink-muted)",
          }}>nothing here yet.</div>
        )}

        {messages.length === 0 && summary && (
          <div style={{
            padding: "14px 18px",
            fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)",
            letterSpacing: "0.04em", textAlign: "center",
          }}>
            messages compacted into the summary above · expand to see all →
          </div>
        )}

        {messages.length > 0 && (
          <>
            <div style={{
              padding: "16px 18px 6px",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{ flex: 1, height: 1, background: "var(--rule-soft)" }} />
              <span className="eyebrow">
                {currentDay === "today" ? "today · live" : currentDay === "2026-04-29" ? "Apr 29 · sealed" : "Apr 28 · sealed"}
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--rule-soft)" }} />
            </div>

            {messages.map((m, idx) => (
              <Message
                key={m.id} m={m}
                onOpen={onOpenDiscussion}
                onMergeToggle={handleMergeToggle}
                mergedWithPrev={merged.has(m.id)}
                prevAuthor={idx > 0 ? messages[idx - 1].author : null}
              />
            ))}

            {currentDay === "today" && (
              <div style={{
                padding: "16px 18px 24px", textAlign: "center",
                fontFamily: "var(--mono)", fontSize: 9.5,
                color: "var(--ink-soft)", letterSpacing: "0.04em",
              }}>
                ollama will write today's summary at 23:59 · {todayMessages.length} messages so far
              </div>
            )}
          </>
        )}
      </div>

      {currentDay === "today" ? (
        <Composer onSend={handleSend} />
      ) : (
        <div style={{
          padding: "16px 18px",
          borderTop: "1px solid var(--rule)",
          background: "var(--paper-soft)",
          fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13,
          color: "var(--ink-muted)", textAlign: "center",
        }}>this day is sealed. switch to today to add new messages.</div>
      )}
    </div>
  );
}

// ─── Discussion side panel ─────────────────────────
function DiscussionPanel({ message, onClose }) {
  const [view, setView] = React.useState("discussion");
  const replies = D.discussion_m2;

  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "rgba(30,24,16,0.30)",
      zIndex: 50,
      display: "flex", justifyContent: "flex-end",
      animation: "fadeIn 200ms ease-out",
    }} onClick={onClose}>
      <div className="slide-in" onClick={(e) => e.stopPropagation()}
        style={{
          width: "90%", height: "100%",
          background: "var(--paper)",
          display: "flex", flexDirection: "column",
          boxShadow: "-12px 0 32px rgba(40,30,15,0.18)",
          borderLeft: "1px solid var(--rule)",
        }}>
        <div style={{
          padding: "14px 16px 12px",
          borderBottom: "1px solid var(--rule)",
          background: "var(--paper)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span className="eyebrow">discussion</span>
            <button onClick={onClose} className="icon-btn" style={{ width: 28, height: 28 }}>
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div style={{
            display: "flex",
            background: "var(--paper-deep)",
            borderRadius: 6, padding: 2,
            border: "1px solid var(--rule-soft)",
          }}>
            {[
              { id: "discussion",    label: "discussion",    hint: "single tap" },
              { id: "understanding", label: "understanding", hint: "double tap" },
              { id: "podcast",       label: "podcast",       hint: "triple tap" },
            ].map(o => (
              <button key={o.id} onClick={() => setView(o.id)} style={{
                flex: 1, padding: "6px 4px",
                background: view === o.id ? "var(--paper-soft)" : "transparent",
                border: "none", borderRadius: 4, cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
                boxShadow: view === o.id ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              }}>
                <span style={{
                  fontFamily: "var(--sans)", fontSize: 12, fontWeight: 500,
                  color: view === o.id ? "var(--ink-strong)" : "var(--ink-muted)",
                }}>{o.label}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, color: "var(--ink-soft)", letterSpacing: "0.04em" }}>{o.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{
          padding: "12px 16px",
          background: "var(--paper-soft)",
          borderBottom: "1px solid var(--rule-soft)",
          display: "flex", gap: 10,
        }}>
          <div className="avatar" style={{
            background: message.avatarColor, color: "var(--paper-soft)",
            width: 24, height: 24, fontSize: 11,
          }}>{message.author[0].toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--ink-muted)", fontFamily: "var(--mono)" }}>
              {message.author} · {message.time}
            </div>
            <div style={{
              fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.5,
              color: "var(--ink)", marginTop: 2,
            }}>
              <MessageBody body={message.body} />
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto" }} className="no-scrollbar">
          {view === "discussion"    && <DiscussionView replies={replies} message={message} />}
          {view === "understanding" && <UnderstandingView message={message} />}
          {view === "podcast"       && <PodcastView message={message} />}
        </div>
      </div>
    </div>
  );
}

function DiscussionView({ replies, message }) {
  return (
    <div>
      <div style={{
        padding: "10px 16px",
        display: "flex", alignItems: "center", gap: 8,
        borderBottom: "1px dashed var(--rule)",
      }}>
        <span className="eyebrow">↳ minor spill</span>
        <span style={{ flex: 1 }}></span>
        <button style={{
          background: "transparent", border: "1px solid var(--rule)",
          borderRadius: 999, padding: "3px 10px",
          fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)",
          textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
        }}>group with…</button>
      </div>

      {message.ai && (
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--rule-soft)" }}>
          <div className="ai-card">
            <div style={{
              fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.6,
              color: "var(--ink)", marginBottom: 10,
            }}>
              {message.ai.text}
            </div>
            <div style={{
              display: "flex", gap: 8, fontFamily: "var(--mono)", fontSize: 10,
              color: "var(--ink-muted)", letterSpacing: "0.04em",
            }}>
              <span>{message.ai.words} words · ollama 3.1:8b</span>
              <span style={{ marginLeft: "auto", color: "var(--ink-strong)", cursor: "pointer" }}>continue thread →</span>
            </div>
          </div>
        </div>
      )}

      {replies.map((r) => (
        <div key={r.id} style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--rule-soft)",
          display: "flex", gap: 10,
        }}>
          <div className="avatar" style={{
            background: r.avatarColor, color: "var(--paper-soft)",
            width: 24, height: 24, fontSize: 11,
          }}>{r.author[0].toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--ink-muted)", fontFamily: "var(--mono)" }}>
              {r.author} · {r.time}
            </div>
            <div style={{
              fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.55,
              color: "var(--ink)", marginTop: 2,
            }}>
              <MessageBody body={r.body} />
            </div>
            {r.sub_discussion > 0 && (
              <div style={{
                marginTop: 6,
                fontFamily: "var(--mono)", fontSize: 10.5,
                color: "var(--ink-muted)",
                display: "inline-flex", alignItems: "center", gap: 4,
                cursor: "pointer",
              }}>
                <span style={{ color: "var(--ink)" }}>↳</span>
                {r.sub_discussion} in sub-discussion
              </div>
            )}
          </div>
        </div>
      ))}

      <div style={{ padding: "12px 16px" }}>
        <div style={{
          background: "var(--paper-soft)",
          border: "1px solid var(--rule)", borderRadius: 8,
          padding: "8px 12px",
          fontFamily: "var(--serif)", fontStyle: "italic",
          color: "var(--ink-soft)", fontSize: 13.5,
        }}>reply to this discussion…</div>
      </div>
    </div>
  );
}

function UnderstandingView({ message }) {
  return (
    <div style={{ padding: "16px" }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>your understanding · double-tap to record</div>
      <div className="card" style={{ padding: 14 }}>
        <div style={{
          fontFamily: "var(--serif)", fontStyle: "italic",
          fontSize: 14.5, lineHeight: 1.6, color: "var(--ink)",
        }}>
          "what i take from this is that migration is fundamentally a trust problem. the team needs proof that the new tool will hold the old conversations as carefully as the people who wrote them."
        </div>
        <div style={{
          marginTop: 12, display: "flex", gap: 8,
          fontFamily: "var(--mono)", fontSize: 10,
          color: "var(--ink-muted)", letterSpacing: "0.04em",
        }}>
          <span>recorded Apr 29 · 18:08</span>
          <span>·</span>
          <span>1m 14s · 142 words</span>
        </div>
      </div>

      <div className="eyebrow" style={{ marginTop: 22, marginBottom: 10 }}>others' understandings · 3</div>
      {[
        { who: "ananya", text: "this is mostly about pacing — going slow on a fast-moving team feels expensive but pays back twice", color: "var(--blue)" },
        { who: "kabir", text: "agree on mirroring. would add: weekly stand-up on what feels missing in duochat vs the old place", color: "var(--orange)" },
        { who: "ollama", text: "the human framing here is correct. systems-wise i'd add a rollback path before committing to mirror→move", color: "var(--ink-strong)" },
      ].map((u, i) => (
        <div key={i} className="card" style={{ padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div className="avatar" style={{ background: u.color, color: "var(--paper-soft)", width: 20, height: 20, fontSize: 10 }}>
              {u.who[0].toUpperCase()}
            </div>
            <span style={{ fontFamily: "var(--sans)", fontWeight: 500, fontSize: 12 }}>{u.who}</span>
          </div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>"{u.text}"</div>
        </div>
      ))}
    </div>
  );
}

function PodcastView({ message }) {
  return (
    <div style={{ padding: "16px" }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>solo podcast · triple-tap to record</div>

      <div className="card" style={{ padding: 16, marginBottom: 14, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{
          width: 96, height: 96, borderRadius: "50%",
          border: "1.5px solid var(--ink-strong)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 14, position: "relative",
          background: "radial-gradient(circle, var(--red-hl) 0%, transparent 70%)",
        }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--red)" }} />
          <div style={{
            position: "absolute", inset: -8, borderRadius: "50%",
            border: "1px solid var(--red)", opacity: 0.4,
          }} />
        </div>
        <div style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-muted)", marginBottom: 4 }}>
          press to start podcasting on this idea
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-soft)", letterSpacing: "0.06em" }}>
          autosaves · transcribes · extracts takeaways
        </div>
      </div>

      <div className="eyebrow" style={{ marginBottom: 8 }}>previous episodes · 2</div>
      {[
        { title: "ep 02 — why migration is a trust problem", duration: "8:14", date: "Apr 29", takeaways: 4 },
        { title: "ep 01 — the read-only mirror idea", duration: "5:42", date: "Apr 28", takeaways: 3 },
      ].map((p, i) => (
        <div key={i} className="card hoverable" style={{ padding: 12, marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
          <button className="icon-btn" style={{ flexShrink: 0, background: "var(--ink-strong)", color: "var(--paper-soft)" }}>
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1l7 4-7 4V1z" fill="currentColor"/></svg>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 13.5, color: "var(--ink-strong)" }}>{p.title}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)", letterSpacing: "0.04em", marginTop: 2 }}>
              {p.duration} · {p.date} · {p.takeaways} takeaways
            </div>
          </div>
          <span style={{ color: "var(--ink-soft)" }}>›</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, {
  ChatScreen, DiscussionPanel, MessageBody,
});
