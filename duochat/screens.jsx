// Incubate Lab, Projects (with drill-down workspace), and shared ScreenHeader

const D2 = window.DUOCHAT_DATA;

// ── shared header ──
function ScreenHeader({ title, tagline, eyebrow, count, action, compact }) {
  return (
    <div style={{
      padding: compact ? "12px 18px 10px" : "16px 18px 14px",
      borderBottom: "1px solid var(--rule)",
      background: "var(--paper)",
    }}>
      {eyebrow && <div className="eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</div>}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h1 style={{
          fontFamily: "var(--serif)",
          fontSize: compact ? 20 : 26, fontWeight: 600,
          letterSpacing: "-0.012em",
          color: "var(--ink-strong)",
          margin: 0,
        }}>{title}</h1>
        {count !== undefined && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-muted)" }}>{count}</span>
        )}
        {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
      </div>
      {tagline && (
        <div style={{
          fontFamily: "var(--serif)", fontStyle: "italic",
          fontSize: 13.5, color: "var(--ink-muted)",
          marginTop: 4, textWrap: "pretty", maxWidth: "32em",
        }}>{tagline}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// INCUBATE LAB (with custom user tags)
// ─────────────────────────────────────────────
function IncubateScreen({ projectData, projectName }) {
  const [filter, setFilter] = React.useState("all");
  const [customTags, setCustomTags] = React.useState([
    // demo seeds — user can add more
    { id: "metaphor", label: "metaphors", color: "#7d5aa6" },
    { id: "constraint", label: "constraints", color: "#3d8a82" },
  ]);
  const [addOpen, setAddOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newColor, setNewColor] = React.useState("#aa5a7d");

  // Built-in (project filter REMOVED — projects have their own workspace now)
  const builtins = [
    { id: "all",      label: "all",       color: "var(--ink-strong)" },
    { id: "idea",     label: "ideas",     color: "var(--red)" },
    { id: "question", label: "questions", color: "var(--green)" },
    { id: "explore",  label: "explore",   color: "var(--blue)" },
  ];

  const sourceIncubations = projectData ? (projectData.incubations || []) : D2.incubations;

  // exclude project from incubation items shown
  const items = sourceIncubations
    .filter(i => i.kind !== "project")
    .filter(i => filter === "all" ? true : i.kind === filter);

  // include demo items for the custom tags
  const itemsWithCustom = (() => {
    if (filter === "metaphor") {
      return [
        { id: "c1", kind: "custom", customLabel: "metaphors", customColor: "#7d5aa6",
          title: "channels are containers, not taxonomies", source: "#duochat-shift · ananya",
          ai_words: 0, age: "1d", status: "incubating",
          preview: "the metaphor matters: containers can hold the same thing in many shapes. taxonomies can't." },
        { id: "c2", kind: "custom", customLabel: "metaphors", customColor: "#7d5aa6",
          title: "messages as hash-identified objects", source: "ollama · 2d",
          ai_words: 0, age: "2d", status: "incubating",
          preview: "the data structure becomes a metaphor for ownership — the thing exists once, channels just point at it." },
      ];
    }
    if (filter === "constraint") {
      return [
        { id: "c3", kind: "custom", customLabel: "constraints", customColor: "#3d8a82",
          title: "no notifications during deep work", source: "#duochat-shift · kabir",
          ai_words: 0, age: "1d", status: "incubating",
          preview: "self-imposed constraint we want to test. if it works, every team should run it." },
      ];
    }
    if (customTags.find(t => t.id === filter)) return [];
    return items;
  })();

  const addTag = () => {
    if (!newName.trim()) return;
    const id = newName.trim().toLowerCase().replace(/\s+/g, "-");
    setCustomTags(prev => [...prev, { id, label: newName.trim(), color: newColor }]);
    setNewName("");
    setAddOpen(false);
    setFilter(id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }} className="dot-grid-bg">
      <ScreenHeader
        eyebrow="incubation lab"
        title="things that aren't done thinking"
        tagline="ideas, questions and threads pulled from chat — held here until they hatch or rot"
        count={`${D2.incubations.filter(i => i.kind !== "project").length + 3} active`}
      />

      {/* filter chips */}
      <div style={{
        padding: "10px 14px",
        display: "flex", gap: 6, overflowX: "auto",
        background: "var(--paper)",
        borderBottom: "1px solid var(--rule-soft)",
        alignItems: "center",
      }} className="no-scrollbar">
        {builtins.map(f => <Chip key={f.id} f={f} active={filter === f.id} onClick={() => setFilter(f.id)} />)}
        {customTags.map(f => <Chip key={f.id} f={f} active={filter === f.id} onClick={() => setFilter(f.id)} />)}
        <button onClick={() => setAddOpen(true)} style={{
          padding: "4px 10px", borderRadius: 999,
          border: "1px dashed var(--rule)",
          background: "var(--paper-soft)",
          color: "var(--ink-muted)",
          fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.06em",
          textTransform: "uppercase", cursor: "pointer",
          whiteSpace: "nowrap", flexShrink: 0,
        }}>+ new tag</button>
      </div>

      {/* add tag inline form */}
      {addOpen && (
        <div className="fade-in" style={{
          padding: "12px 14px",
          background: "var(--paper-soft)",
          borderBottom: "1px solid var(--rule-soft)",
          display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
        }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="tag name…"
            onKeyDown={(e) => e.key === "Enter" && addTag()}
            style={{
              flex: 1, minWidth: 120,
              padding: "5px 10px", border: "1px solid var(--rule)", borderRadius: 6,
              background: "var(--paper)", color: "var(--ink)",
              fontFamily: "var(--sans)", fontSize: 13, outline: "none",
            }} />
          <div style={{ display: "flex", gap: 4 }}>
            {["#b34a36", "#c08332", "#5a8a4f", "#3a6aa3", "#7d5aa6", "#3d8a82", "#aa5a7d"].map(c => (
              <button key={c} onClick={() => setNewColor(c)}
                style={{
                  width: 22, height: 22, borderRadius: "50%",
                  background: c,
                  border: newColor === c ? "2px solid var(--ink-strong)" : "1px solid var(--rule)",
                  cursor: "pointer",
                }} />
            ))}
          </div>
          <button onClick={addTag} style={{
            padding: "5px 12px",
            background: "var(--ink-strong)", color: "var(--paper-soft)",
            border: "none", borderRadius: 6,
            fontFamily: "var(--sans)", fontSize: 12, fontWeight: 500,
            cursor: "pointer",
          }}>add</button>
          <button onClick={() => setAddOpen(false)} style={{
            padding: "5px 10px",
            background: "transparent", border: "1px solid var(--rule)",
            borderRadius: 6,
            fontFamily: "var(--sans)", fontSize: 12, color: "var(--ink-muted)",
            cursor: "pointer",
          }}>cancel</button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "16px 14px 24px" }} className="no-scrollbar">
        <div style={{ display: "grid", gap: 12 }}>
          {itemsWithCustom.length === 0 && (
            <div style={{
              padding: 30, textAlign: "center",
              fontFamily: "var(--serif)", fontStyle: "italic",
              color: "var(--ink-muted)",
            }}>nothing tagged here yet.</div>
          )}
          {itemsWithCustom.map(item => <IncubationCard key={item.id} item={item} />)}
        </div>
      </div>
    </div>
  );
}

function Chip({ f, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px",
      borderRadius: 999,
      border: "1px solid " + (active ? f.color : "var(--rule)"),
      background: active ? f.color : "var(--paper-soft)",
      color: active ? "var(--paper-soft)" : f.color,
      fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.06em",
      textTransform: "uppercase",
      cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
    }}>
      {f.label}
    </button>
  );
}

function IncubationCard({ item }) {
  const kindColor = item.kind === "custom" ? item.customColor : {
    idea: "var(--red)", question: "var(--green)", explore: "var(--blue)", project: "var(--orange)",
  }[item.kind];
  const kindLabel = item.kind === "custom" ? item.customLabel : item.kind;

  const statusBadge = {
    incubating: { glyph: "◐", label: "incubating" },
    open: { glyph: "○", label: "open" },
    wild: { glyph: "✦", label: "wild" },
    active: { glyph: "●", label: "active" },
  }[item.status] || { glyph: "·", label: item.status };

  return (
    <div className="card hoverable" style={{
      padding: 14, borderLeft: `3px solid ${kindColor}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "2px 8px", borderRadius: 999,
          fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.04em",
          color: kindColor, background: kindColor + "1a",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: kindColor }} />
          {kindLabel}
        </span>
        <span style={{
          fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)",
          letterSpacing: "0.04em",
        }}>{statusBadge.glyph} {statusBadge.label} · {item.age}</span>
      </div>

      <div style={{
        fontFamily: "var(--serif)", fontSize: 18, fontWeight: 500,
        color: "var(--ink-strong)", lineHeight: 1.3, marginBottom: 6,
        letterSpacing: "-0.005em", textWrap: "pretty",
      }}>
        {item.kind === "question" && <span style={{ color: kindColor, marginRight: 6 }}>?</span>}
        {item.title}
      </div>

      <div style={{
        fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13.5,
        color: "var(--ink-muted)", lineHeight: 1.55, marginBottom: 10, textWrap: "pretty",
      }}>{item.preview}</div>

      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        fontFamily: "var(--mono)", fontSize: 10,
        color: "var(--ink-muted)", letterSpacing: "0.04em",
      }}>
        <span>{item.source}</span>
        {item.ai_words > 0 && (
          <>
            <span>·</span>
            <span style={{ color: "var(--ink-strong)" }}>ollama · {item.ai_words}w</span>
          </>
        )}
        <span style={{ marginLeft: "auto", color: "var(--ink-strong)" }}>open →</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PROJECTS — list + drill-down
// ─────────────────────────────────────────────
function ProjectsScreen({ onOpenProject }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ScreenHeader
        eyebrow="projects · own workspace each"
        title="projects"
        tagline="open a project to get its own chat, lab, media, read, explore — and a schedule."
        count={`${D2.projects.length} active`}
      />
      <div style={{ flex: 1, overflow: "auto", padding: "14px 14px 24px" }} className="no-scrollbar">
        {D2.projects.map(p => <ProjectRow key={p.id} p={p} onOpen={() => onOpenProject(p)} />)}
      </div>
    </div>
  );
}

function ProjectRow({ p, onOpen }) {
  return (
    <div className="card hoverable" onClick={onOpen} style={{
      padding: 14, marginBottom: 10,
      display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
          <span className="tag project" style={{
            fontFamily: "var(--sans)", fontSize: 13, padding: "1px 8px",
          }}>{p.name}</span>
          <span className="eyebrow" style={{ fontSize: 9 }}># {p.channel}</span>
        </div>
        <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13, color: "var(--ink-muted)" }}>
          next · {p.nextStep}
        </div>
      </div>
      <div style={{
        textAlign: "right", flexShrink: 0,
        fontFamily: "var(--mono)", fontSize: 10,
        color: "var(--ink-muted)", letterSpacing: "0.04em",
      }}>
        <div><span style={{ color: "var(--red)" }}>{p.openIdeas}</span> ideas</div>
        <div><span style={{ color: "var(--green)" }}>{p.openQuestions}</span> open ?</div>
        <div style={{ marginTop: 2, color: "var(--ink-strong)", textTransform: "uppercase" }}>{p.phase}</div>
      </div>
      <span style={{ color: "var(--ink-soft)", fontFamily: "var(--mono)", fontSize: 14 }}>›</span>
    </div>
  );
}

// ─────────────────────────────────────────────
// PROJECT WORKSPACE  — own tab bar, own chat/lab/media/read/explore + schedule
// ─────────────────────────────────────────────
function ProjectWorkspace({ project, onBack, onOpenDiscussion }) {
  const [tab, setTab] = React.useState("schedule");   // open straight to schedule so the new thing is visible
  const pd = D2.project_data[project.name] || {};  // project-scoped data

  const PROJECT_TABS = [
    { id: "chat",     label: "chat" },
    { id: "incubate", label: "lab" },
    { id: "media",    label: "media" },
    { id: "read",     label: "read" },
    { id: "explore",  label: "explore" },
    { id: "schedule", label: "schedule" },
  ];

  const renderBody = () => {
    if (tab === "chat") return <ChatScreen onOpenDiscussion={onOpenDiscussion}
                                          channelName={project.channel}
                                          tagline={`scoped to ${project.name} · open ideas live here`}
                                          projectData={pd} />;
    if (tab === "incubate") return <IncubateScreen projectData={pd} projectName={project.name} />;
    if (tab === "media")    return <MediaScreen projectData={pd} projectName={project.name} />;
    if (tab === "read")     return <ReadScreen projectData={pd} projectName={project.name} />;
    if (tab === "explore")  return <ExploreScreen projectData={pd} projectName={project.name} />;
    if (tab === "schedule") return <ProjectSchedule project={project} />;
    return null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* project header */}
      <div style={{
        padding: "10px 14px 8px",
        background: "var(--paper-soft)",
        borderBottom: "1px solid var(--rule-soft)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <button onClick={onBack} style={{
          border: "none", background: "transparent",
          fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)",
          cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase",
          padding: 0,
        }}>← projects</button>
        <span style={{ flex: 1 }}></span>
        <span className="tag project" style={{
          fontFamily: "var(--sans)", fontSize: 12, padding: "1px 8px",
        }}>{project.name}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--ink-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {project.phase}
        </span>
      </div>

      {/* project tab bar */}
      <div className="tab-bar" style={{ background: "var(--paper)" }}>
        {PROJECT_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={"tab" + (tab === t.id ? " active" : "")}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {renderBody()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PROJECT SCHEDULE — Gantt of breakdown into smaller actions
// ─────────────────────────────────────────────
function ProjectSchedule({ project }) {
  const subtasks = D2.project_subtasks[project.name] || D2.project_subtasks["duochat"];
  const DAYS = 7;
  const dayLabels = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const today = 3; // index — wed

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 14px 24px" }} className="no-scrollbar">
      {/* header strip */}
      <div style={{
        fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)",
        letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4,
      }}>{project.name} · breakdown into smaller actions</div>
      <div style={{
        fontFamily: "var(--serif)", fontSize: 17, fontWeight: 500,
        color: "var(--ink-strong)", marginBottom: 14, letterSpacing: "-0.01em",
      }}>this week</div>

      {/* day header */}
      <div style={{
        display: "grid", gridTemplateColumns: "140px repeat(7, 1fr)",
        gap: 4, alignItems: "center", marginBottom: 4,
      }}>
        <div></div>
        {dayLabels.map((d, i) => (
          <div key={i} style={{
            textAlign: "center",
            fontFamily: "var(--mono)", fontSize: 10,
            color: i === today ? "var(--ink-strong)" : "var(--ink-soft)",
            fontWeight: i === today ? 600 : 400,
            letterSpacing: "0.04em",
          }}>{d}</div>
        ))}
      </div>

      {/* today marker line */}
      <div style={{ position: "relative" }}>
        <div style={{
          position: "absolute",
          left: `calc(140px + ${(today + 0.5) / DAYS} * (100% - 140px) - 4px)`,
          top: 0, bottom: 0, width: 1,
          background: "var(--red)", opacity: 0.5,
          pointerEvents: "none",
        }} />

        {subtasks.map((s, i) => <GanttBar key={i} s={s} days={DAYS} dayLabels={dayLabels} />)}
      </div>

      {/* legend / status counts */}
      <div style={{
        marginTop: 18, padding: "12px 14px",
        background: "var(--paper-soft)",
        border: "1px solid var(--rule-soft)",
        borderRadius: 8,
      }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>actions by status</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {[
            { s: "done", c: "var(--green)" },
            { s: "in-progress", c: "var(--blue)" },
            { s: "next", c: "var(--orange)" },
            { s: "milestone", c: "var(--ink-strong)" },
          ].map(x => {
            const n = subtasks.filter(t => t.status === x.s).length;
            return (
              <div key={x.s} style={{
                display: "flex", alignItems: "center", gap: 5,
                fontFamily: "var(--mono)", fontSize: 11,
                color: "var(--ink-muted)", letterSpacing: "0.04em",
              }}>
                <span style={{
                  width: 8, height: 8, background: x.c,
                  borderRadius: x.s === "milestone" ? 0 : 4,
                  transform: x.s === "milestone" ? "rotate(45deg)" : "none",
                }} />
                <span style={{ color: "var(--ink-strong)" }}>{n}</span> {x.s}
              </div>
            );
          })}
        </div>
      </div>

      <button style={{
        marginTop: 16, width: "100%",
        padding: "10px 0",
        background: "transparent",
        border: "1px dashed var(--rule)", borderRadius: 6,
        color: "var(--ink-muted)",
        fontFamily: "var(--sans)", fontSize: 12, fontWeight: 500,
        cursor: "pointer",
      }}>+ add action to breakdown</button>
    </div>
  );
}

function GanttBar({ s, days, dayLabels }) {
  const statusColor = {
    done:          "var(--green)",
    "in-progress": "var(--blue)",
    next:          "var(--orange)",
    milestone:     "var(--ink-strong)",
  }[s.status];
  const statusBg = {
    done:          "var(--green-hl)",
    "in-progress": "var(--blue-hl)",
    next:          "var(--orange-hl)",
    milestone:     "transparent",
  }[s.status];

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "140px repeat(7, 1fr)",
      gap: 4, alignItems: "center", marginBottom: 6,
    }}>
      <div style={{
        fontFamily: "var(--sans)", fontSize: 11.5, fontWeight: 500,
        color: "var(--ink-strong)", overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap",
        paddingRight: 6,
      }}>
        <span style={{
          display: "inline-block",
          width: 6, height: 6, borderRadius: "50%",
          background: statusColor, marginRight: 5,
          transform: s.status === "milestone" ? "rotate(45deg)" : "none",
          borderRadius: s.status === "milestone" ? 0 : "50%",
        }} />
        {s.name}
      </div>
      {dayLabels.map((_, dayIdx) => {
        const inSpan = dayIdx >= s.start && dayIdx < s.start + s.span;
        const isStart = dayIdx === s.start;
        const isEnd = dayIdx === s.start + s.span - 1;
        const isMilestone = s.status === "milestone";

        return (
          <div key={dayIdx} style={{
            height: 16,
            background: !isMilestone && inSpan ? statusBg : "transparent",
            borderLeft: !isMilestone && isStart ? `2px solid ${statusColor}` : "none",
            borderTopLeftRadius: isStart ? 3 : 0,
            borderBottomLeftRadius: isStart ? 3 : 0,
            borderTopRightRadius: isEnd ? 3 : 0,
            borderBottomRightRadius: isEnd ? 3 : 0,
            position: "relative",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {isMilestone && inSpan && (
              <div style={{
                width: 10, height: 10,
                background: "var(--ink-strong)",
                transform: "rotate(45deg)",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, {
  IncubateScreen, ProjectsScreen, ProjectWorkspace, ScreenHeader,
});
