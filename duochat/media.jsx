// Media — calm daily feed (one per category) + library view
// User idea: "media is supposed to be calming — even if i add hundreds, it shows me 1 (or user-decided)
// from each category in a day. when i'm done i'm done. those are marked as read. library shows everything."

const Dm = window.DUOCHAT_DATA;

function MediaScreen({ projectData, projectName }) {
  const [view, setView] = React.useState("today");   // today | library
  const [perCategory, setPerCategory] = React.useState(1);  // user-decided count per category
  const sourceMediaToday = projectData ? (projectData.media_today || []) : Dm.media_today;
  const sourceMediaLibrary = projectData ? (projectData.media_library || []) : Dm.media_library;
  const [todayItems, setTodayItems] = React.useState(sourceMediaToday);
  const [libraryFilter, setLibraryFilter] = React.useState("all");

  const total = todayItems.length;
  const done = todayItems.filter(i => i.done).length;
  const allDone = done === total;

  const toggleDone = (id) => {
    setTodayItems(prev => prev.map(i => i.id === id ? { ...i, done: !i.done } : i));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ScreenHeader
        eyebrow={projectName ? `media · ${projectName}` : "media · calm by design"}
        title="today's feed"
        tagline="one from each category. read it, mark it, be done. add as many as you like — only today's surface."
        count={`${done} / ${total} done`}
      />

      {/* sub-tabs: today / library */}
      <div style={{
        padding: "10px 14px 0",
        display: "flex", alignItems: "center", gap: 14,
        background: "var(--paper)",
        borderBottom: "1px solid var(--rule-soft)",
      }}>
        {[
          { id: "today", label: "today" },
          { id: "library", label: "library" },
        ].map(t => (
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
        {view === "today" && (
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="eyebrow" style={{ fontSize: 9 }}>per category</span>
            {[1, 2, 3].map(n => (
              <button key={n} onClick={() => setPerCategory(n)} style={{
                width: 22, height: 22, borderRadius: "50%",
                border: "1px solid " + (perCategory === n ? "var(--ink-strong)" : "var(--rule)"),
                background: perCategory === n ? "var(--ink-strong)" : "transparent",
                color: perCategory === n ? "var(--paper-soft)" : "var(--ink-muted)",
                fontFamily: "var(--mono)", fontSize: 10,
                cursor: "pointer",
              }}>{n}</button>
            ))}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto" }} className="no-scrollbar">
        {view === "today" ? (
          <TodayFeed items={todayItems} allDone={allDone} onToggleDone={toggleDone} />
        ) : (
          <LibraryView filter={libraryFilter} setFilter={setLibraryFilter} sourceMediaLibrary={sourceMediaLibrary} />
        )}
      </div>
    </div>
  );
}

// ── Today feed ──
function TodayFeed({ items, allDone, onToggleDone }) {
  const remaining = items.filter(i => !i.done);

  return (
    <div style={{ padding: "20px 16px 28px" }}>
      {/* mood line — calmness signal */}
      <div style={{
        fontFamily: "var(--serif)", fontStyle: "italic",
        fontSize: 13, color: "var(--ink-muted)",
        textAlign: "center", marginBottom: 22,
        textWrap: "pretty", maxWidth: "26em", marginInline: "auto",
      }}>
        {allDone
          ? "you're done with today. see you tomorrow."
          : `${remaining.length} pieces of media for today · come back tomorrow for the next set`}
      </div>

      {/* large breathing-room cards */}
      <div style={{ display: "grid", gap: 16, maxWidth: 560, margin: "0 auto" }}>
        {items.map(item => (
          <TodayCard key={item.id} item={item} onToggleDone={() => onToggleDone(item.id)} />
        ))}
      </div>

      {allDone && (
        <div style={{
          marginTop: 30, padding: "22px 18px",
          background: "var(--paper-soft)",
          border: "1px dashed var(--rule)",
          borderRadius: 10, textAlign: "center",
        }}>
          <div style={{
            fontFamily: "var(--serif)", fontSize: 17,
            color: "var(--ink-strong)", marginBottom: 6,
          }}>nothing left for today.</div>
          <div style={{
            fontFamily: "var(--serif)", fontStyle: "italic",
            fontSize: 13, color: "var(--ink-muted)",
          }}>add things to the library — they'll surface here over the coming days, one at a time.</div>
        </div>
      )}
    </div>
  );
}

function TodayCard({ item, onToggleDone }) {
  const cat = item.category;
  const catColor = {
    video: "var(--red)", article: "var(--blue)", paper: "var(--violet)",
    tweet: "var(--green)", image: "var(--orange)", model: "var(--teal)",
  }[cat] || "var(--ink-soft)";

  const glyph = {
    video: "▶", article: "▤", paper: "𝒫",
    tweet: "𝕏", image: "◉", model: "◇",
  }[cat] || "·";

  return (
    <div className="card" style={{
      padding: "18px 18px 16px",
      opacity: item.done ? 0.55 : 1,
      transition: "opacity 180ms ease",
      position: "relative",
    }}>
      {/* category eyebrow */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{
          width: 22, height: 22, borderRadius: "50%",
          background: catColor + "22",
          color: catColor,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 11,
        }}>{glyph}</span>
        <span className="eyebrow" style={{ color: catColor }}>{cat}</span>
        <span style={{ flex: 1 }}></span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)", letterSpacing: "0.04em" }}>
          {item.source}
        </span>
      </div>

      <div style={{
        fontFamily: "var(--serif)",
        fontSize: 19, fontWeight: 500,
        color: "var(--ink-strong)",
        lineHeight: 1.3,
        letterSpacing: "-0.01em",
        textDecoration: item.done ? "line-through" : "none",
        textDecorationColor: "var(--ink-soft)",
        textWrap: "pretty",
        marginBottom: 6,
      }}>{item.title}</div>

      <div style={{
        fontFamily: "var(--serif)",
        fontStyle: "italic",
        fontSize: 13.5,
        color: "var(--ink-muted)",
        lineHeight: 1.55,
        marginBottom: 14,
        textWrap: "pretty",
      }}>{item.blurb}</div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onToggleDone} style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "6px 12px",
          border: "1px solid " + (item.done ? "var(--green)" : "var(--rule)"),
          background: item.done ? "var(--green-hl)" : "var(--paper)",
          color: item.done ? "var(--green)" : "var(--ink-strong)",
          fontFamily: "var(--sans)", fontSize: 12, fontWeight: 500,
          borderRadius: 999, cursor: "pointer",
        }}>
          <span style={{
            width: 14, height: 14, borderRadius: "50%",
            border: "1.2px solid currentColor",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 10,
          }}>{item.done ? "✓" : ""}</span>
          {item.done ? "done" : "mark done"}
        </button>
        <button style={{
          padding: "6px 12px",
          border: "1px solid var(--rule)",
          background: "transparent",
          fontFamily: "var(--sans)", fontSize: 12, color: "var(--ink-muted)",
          borderRadius: 999, cursor: "pointer",
        }}>open →</button>
        <button style={{
          marginLeft: "auto",
          background: "transparent", border: "none",
          fontFamily: "var(--mono)", fontSize: 10,
          color: "var(--ink-soft)", letterSpacing: "0.04em",
          cursor: "pointer",
        }}>discuss</button>
      </div>
    </div>
  );
}

// ── Library view ──
function LibraryView({ filter, setFilter, sourceMediaLibrary }) {
  const categories = [
    { id: "all", label: "all" },
    { id: "video", label: "videos" },
    { id: "article", label: "articles" },
    { id: "paper", label: "papers" },
    { id: "tweet", label: "tweets" },
    { id: "image", label: "images" },
    { id: "model", label: "models" },
  ];
  const items = filter === "all" ? sourceMediaLibrary : sourceMediaLibrary.filter(i => i.type === filter);

  const groupedByDate = {};
  items.forEach(i => {
    if (!groupedByDate[i.added]) groupedByDate[i.added] = [];
    groupedByDate[i.added].push(i);
  });

  const doneCount = sourceMediaLibrary.filter(i => i.done).length;

  return (
    <div>
      {/* category chips */}
      <div style={{
        padding: "10px 14px",
        display: "flex", gap: 6, overflowX: "auto",
        background: "var(--paper)",
        borderBottom: "1px solid var(--rule-soft)",
      }} className="no-scrollbar">
        {categories.map(c => (
          <button key={c.id} onClick={() => setFilter(c.id)}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px solid " + (filter === c.id ? "var(--ink-strong)" : "var(--rule)"),
              background: filter === c.id ? "var(--ink-strong)" : "transparent",
              color: filter === c.id ? "var(--paper-soft)" : "var(--ink-muted)",
              fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer", whiteSpace: "nowrap",
            }}>{c.label}</button>
        ))}
      </div>

      <div style={{ padding: "14px 14px 24px" }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontFamily: "var(--mono)", fontSize: 10,
          color: "var(--ink-muted)", letterSpacing: "0.04em",
          marginBottom: 10,
        }}>
          <span>{sourceMediaLibrary.length} items in library</span>
          <span>{doneCount} done · {sourceMediaLibrary.length - doneCount} waiting</span>
        </div>

        {Object.entries(groupedByDate).map(([date, list]) => (
          <div key={date} style={{ marginBottom: 18 }}>
            <div style={{
              padding: "6px 0 8px",
              borderBottom: "1px solid var(--rule-soft)",
              fontFamily: "var(--mono)", fontSize: 10,
              color: "var(--ink-muted)", letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}>{date}</div>
            {list.map(item => <LibraryRow key={item.id} item={item} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function LibraryRow({ item }) {
  const catColor = {
    video: "var(--red)", article: "var(--blue)", paper: "var(--violet)",
    tweet: "var(--green)", image: "var(--orange)", model: "var(--teal)",
  }[item.type] || "var(--ink-soft)";

  const glyph = {
    video: "▶", article: "▤", paper: "𝒫",
    tweet: "𝕏", image: "◉", model: "◇",
  }[item.type] || "·";

  return (
    <div className="hoverable" style={{
      padding: "9px 4px",
      display: "flex", alignItems: "center", gap: 10,
      opacity: item.done ? 0.55 : 1,
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: "50%",
        background: catColor + "1a",
        color: catColor,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, flexShrink: 0,
      }}>{glyph}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--serif)", fontSize: 14, fontWeight: 500,
          color: "var(--ink-strong)", lineHeight: 1.3,
          letterSpacing: "-0.005em",
          textDecoration: item.done ? "line-through" : "none",
          textDecorationColor: "var(--ink-soft)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{item.title}</div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)", marginTop: 1, letterSpacing: "0.04em" }}>
          {item.source}
        </div>
      </div>
      <span style={{
        flexShrink: 0,
        fontFamily: "var(--mono)", fontSize: 10,
        color: item.done ? "var(--green)" : "var(--ink-soft)",
        letterSpacing: "0.04em",
      }}>{item.done ? "✓ done" : "○ open"}</span>
    </div>
  );
}

Object.assign(window, { MediaScreen });
