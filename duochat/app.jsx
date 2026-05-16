// duochat — main app shell: workspace bar, top tabs, project drill-down, tweaks

const TABS = [
  { id: "chat",     label: "chat" },
  { id: "incubate", label: "lab" },
  { id: "media",    label: "media" },
  { id: "read",     label: "read" },
  { id: "explore",  label: "explore" },
  { id: "projects", label: "projects" },
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "frame": "mobile",
  "tagPalette": "warm",
  "density": "calm",
  "showAiFirstResponse": true
}/*EDITMODE-END*/;

// ── Workspace bar ──
function WorkspaceBar({ frame, activeProject }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: frame === "mobile" ? "10px 16px 8px" : "10px 20px 8px",
      borderBottom: "1px solid var(--rule-soft)",
      background: "var(--paper)",
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 5,
        background: "var(--ink-strong)",
        color: "var(--paper)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--serif)", fontWeight: 600, fontSize: 12,
      }}>d</div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <div style={{
          fontFamily: "var(--sans)", fontWeight: 600, fontSize: 13,
          color: "var(--ink-strong)", letterSpacing: "-0.005em",
        }}>the deep workshop</div>
        <div style={{
          fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--ink-muted)",
          letterSpacing: "0.04em", marginTop: 1,
        }}>4 members · {activeProject ? `inside ${activeProject.name}` : "Apr 30 · today"}</div>
      </div>
      <span style={{ flex: 1 }}></span>
      <button className="icon-btn" style={{ width: 26, height: 26 }} title="search">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M7.5 7.5L10 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>
      <button className="icon-btn" style={{ width: 26, height: 26 }} title="channel switcher">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M1.5 3h9M1.5 6h9M1.5 9h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

// ── Top tabs (single view — all six fit) ──
function TabBar({ active, onChange }) {
  return (
    <div className="tab-bar" style={{ background: "var(--paper)" }}>
      {TABS.map(t => (
        <button key={t.id}
          className={"tab" + (active === t.id ? " active" : "")}
          onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Mobile shell ──
function MobileShell({ children }) {
  return (
    <IOSDevice width={402} height={874} dark={false}>
      <div className="paper-bg" style={{
        height: "100%", display: "flex", flexDirection: "column",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ height: 52, flexShrink: 0 }} />
        {children}
        <div style={{ height: 30, flexShrink: 0, background: "var(--paper)" }} />
      </div>
    </IOSDevice>
  );
}

// ── Desktop shell ──
function DesktopShell({ children }) {
  return (
    <div className="desktop-frame">
      <div className="desktop-chrome">
        <div className="traffic" style={{ background: "#e06959" }} />
        <div className="traffic" style={{ background: "#dca94d" }} />
        <div className="traffic" style={{ background: "#7fb55b" }} />
        <div style={{ marginLeft: 14, fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)", letterSpacing: "0.04em" }}>
          duochat.app — the deep workshop
        </div>
      </div>
      <div className="paper-bg" style={{
        flex: 1, display: "flex", flexDirection: "column", position: "relative",
        overflow: "hidden",
      }}>
        {children}
      </div>
    </div>
  );
}

// ── Desktop channel rail (chat tab only) ──
function DesktopChannelRail({ active }) {
  const cats = [
    { label: "text channels", items: ["duochat-shift", "organisational-rules", "things-to-do", "ideas-and-insights", "questions", "math-ideas"] },
    { label: "application-projects", items: ["projects", "duochat", "code-as-a-rag", "gemma-manager", "anatfor"] },
    { label: "media",       items: ["articles", "tweets", "youtube-videos-and-playlists", "ai-models", "images"] },
    { label: "explore",     items: ["maths", "general", "ai", "ai-philosophy", "random", "techtools"] },
  ];
  return (
    <div style={{
      width: 240, borderRight: "1px solid var(--rule)",
      background: "var(--paper-soft)",
      overflow: "auto", flexShrink: 0,
    }} className="no-scrollbar">
      {cats.map((c, i) => (
        <div key={i} style={{ padding: "12px 6px 4px" }}>
          <div className="eyebrow" style={{ padding: "0 12px 6px" }}>{c.label}</div>
          {c.items.map((name, j) => {
            const isActive = name === active;
            return (
              <div key={j} style={{
                padding: "5px 12px",
                display: "flex", alignItems: "center", gap: 6,
                fontFamily: "var(--sans)", fontSize: 12.5,
                color: isActive ? "var(--ink-strong)" : "var(--ink-muted)",
                background: isActive ? "var(--paper-deep)" : "transparent",
                borderRadius: 4, margin: "0 4px", cursor: "pointer",
                fontWeight: isActive ? 500 : 400,
              }}>
                <span style={{ color: "var(--ink-soft)", fontFamily: "var(--mono)", fontSize: 12 }}>#</span>
                {name}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── App ──
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [tab, setTab] = React.useState("chat");
  const [openMessage, setOpenMessage] = React.useState(null);
  const [activeProject, setActiveProject] = React.useState(null);

  const frame = t.frame;

  // When inside a project, render the project workspace (its own tabs).
  // When not, render the main top-level tabs.
  let body;
  if (activeProject) {
    body = (
      <ProjectWorkspace
        project={activeProject}
        onBack={() => setActiveProject(null)}
        onOpenDiscussion={setOpenMessage} />
    );
  } else {
    const screenFor = (tabId) => {
      if (tabId === "chat")     return <ChatScreen onOpenDiscussion={setOpenMessage} />;
      if (tabId === "incubate") return <IncubateScreen />;
      if (tabId === "media")    return <MediaScreen />;
      if (tabId === "read")     return <ReadScreen />;
      if (tabId === "explore")  return <ExploreScreen />;
      if (tabId === "projects") return <ProjectsScreen onOpenProject={setActiveProject} />;
      return null;
    };
    body = (
      <>
        <TabBar active={tab} onChange={setTab} />
        {frame === "desktop" && tab === "chat" ? (
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <DesktopChannelRail active="duochat-shift" />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {screenFor(tab)}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {screenFor(tab)}
          </div>
        )}
      </>
    );
  }

  const content = (
    <>
      <WorkspaceBar frame={frame} activeProject={activeProject} />
      <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {body}
        {openMessage && (
          <DiscussionPanel message={openMessage} onClose={() => setOpenMessage(null)} />
        )}
      </div>
    </>
  );

  return (
    <>
      {frame === "mobile" ? <MobileShell>{content}</MobileShell> : <DesktopShell>{content}</DesktopShell>}

      <TweaksPanel title="Tweaks">
        <TweakSection label="frame">
          <TweakRadio label="device" value={t.frame}
            options={[{ value: "mobile", label: "mobile" }, { value: "desktop", label: "desktop" }]}
            onChange={(v) => setTweak("frame", v)} />
        </TweakSection>

        <TweakSection label="aesthetic">
          <TweakSelect label="tag palette" value={t.tagPalette}
            options={[
              { value: "warm",   label: "warm (default)" },
              { value: "vivid",  label: "vivid (ink)" },
              { value: "mono",   label: "monochrome" },
            ]}
            onChange={(v) => { setTweak("tagPalette", v); applyPalette(v); }} />
          <TweakRadio label="density" value={t.density}
            options={[
              { value: "calm",        label: "calm" },
              { value: "comfortable", label: "comfort" },
              { value: "compact",     label: "compact" },
            ]}
            onChange={(v) => { setTweak("density", v); applyDensity(v); }} />
        </TweakSection>

        <TweakSection label="behaviour">
          <TweakToggle label="ollama auto-responds to ideas" value={t.showAiFirstResponse}
            onChange={(v) => setTweak("showAiFirstResponse", v)} />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

// ── Tweak appliers ──
function applyPalette(p) {
  const root = document.documentElement;
  if (p === "vivid") {
    root.style.setProperty("--red", "#d94327");
    root.style.setProperty("--green", "#3d8a2f");
    root.style.setProperty("--blue", "#1f5fb8");
    root.style.setProperty("--orange", "#d68328");
    root.style.setProperty("--red-hl", "#fac9bd");
    root.style.setProperty("--green-hl", "#c8e2bf");
    root.style.setProperty("--blue-hl", "#c0d5f0");
    root.style.setProperty("--orange-hl", "#f5d4a3");
  } else if (p === "mono") {
    root.style.setProperty("--red", "#3a342a");
    root.style.setProperty("--green", "#3a342a");
    root.style.setProperty("--blue", "#3a342a");
    root.style.setProperty("--orange", "#3a342a");
    root.style.setProperty("--red-hl", "#e0d6c2");
    root.style.setProperty("--green-hl", "#e0d6c2");
    root.style.setProperty("--blue-hl", "#e0d6c2");
    root.style.setProperty("--orange-hl", "#e0d6c2");
  } else {
    root.style.setProperty("--red", "#b34a36");
    root.style.setProperty("--green", "#5a8a4f");
    root.style.setProperty("--blue", "#3a6aa3");
    root.style.setProperty("--orange", "#c08332");
    root.style.setProperty("--red-hl", "#f0d6ce");
    root.style.setProperty("--green-hl", "#d8e6cf");
    root.style.setProperty("--blue-hl", "#d3def0");
    root.style.setProperty("--orange-hl", "#f3dfbb");
  }
}

function applyDensity(d) {
  const factor = d === "compact" ? 0.92 : d === "comfortable" ? 1.0 : 1.04;
  document.documentElement.style.fontSize = `${16 * factor}px`;
}

// ── Mount ──
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
