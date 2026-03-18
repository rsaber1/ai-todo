import { useState, useRef, useEffect } from "react";

const SYSTEM_PROMPT = `You are a todo list manager. The user will give you natural language commands to manage their tasks.
You must ALWAYS respond with ONLY a valid JSON object — no preamble, no explanation, no markdown.

The JSON must have this structure:
{
  "tasks": [ { "id": number, "text": string, "done": boolean, "priority": "high"|"medium"|"low"|null, "deadline": string|null, "notes": string|null } ],
  "message": string
}

Rules:
- "tasks" is the COMPLETE updated task list after applying the user's command.
- "message" is a short, friendly confirmation of what you did (1 sentence max).
- Preserve existing tasks unless the command modifies or removes them.
- Assign new tasks unique incrementing IDs based on the highest existing ID.
- Commands like "add X", "remove X", "mark X as done", "uncheck X", "clear completed", "delete all" are common.
- If the command is ambiguous, do your best and explain in "message".
- NEVER include anything outside the JSON object.`;

const IMPORT_PROMPT = `You are a task extraction assistant. The user will paste raw text from a conversation or notes.
Extract ALL actionable tasks, todos, action items, and things-to-do from the text.
Also extract any deadlines, priorities, or context mentioned.

You must ALWAYS respond with ONLY a valid JSON object — no preamble, no explanation, no markdown.

The JSON must have this structure:
{
  "tasks": [ { "id": number, "text": string, "done": boolean, "priority": "high"|"medium"|"low"|null, "deadline": string|null, "notes": string|null } ],
  "message": string
}

Rules:
- Extract every task or action item you find, even implicit ones.
- "done" should be false for all extracted tasks unless the text clearly says it's completed.
- "priority" should reflect urgency language in the text (e.g. "urgent", "ASAP" = high).
- "deadline" should be a human-readable date string if mentioned (e.g. "Friday", "March 20").
- "notes" can include brief context from the conversation relevant to that task.
- "message" should summarize how many tasks were found and from what context.
- Start IDs from 1.
- NEVER include anything outside the JSON object.`;

const PRIORITY_COLORS = { high: "#e05252", medium: "#c8a96e", low: "#5a8a6a" };
const PRIORITY_LABELS = { high: "!", medium: "·", low: "↓" };

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "#111", border: "1px solid #2a2a2a", borderRadius: "8px",
  color: "#f5f0e8", padding: "12px 14px", fontSize: "14px",
  fontFamily: "monospace", marginBottom: "16px", outline: "none",
};

function Modal({ children, wide }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "24px",
    }}>
      <div style={{
        background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "12px",
        padding: "40px", maxWidth: wide ? "580px" : "420px", width: "100%",
      }}>
        {children}
      </div>
    </div>
  );
}

function Label({ children }) {
  return (
    <div style={{ fontSize: "13px", letterSpacing: "0.15em", color: "#555", marginBottom: "12px", textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled, style: extraStyle }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: "100%", background: disabled ? "#2a2a2a" : "#c8a96e",
      color: disabled ? "#555" : "#0f0f0f",
      border: "none", borderRadius: "8px", padding: "12px",
      fontSize: "14px", cursor: disabled ? "default" : "pointer",
      fontFamily: "inherit", letterSpacing: "0.05em", transition: "all 0.2s",
      ...extraStyle,
    }}>
      {children}
    </button>
  );
}

function TaskRow({ task, onToggle, loading, expanded, onExpand }) {
  const hasExtra = task.deadline || task.priority || task.notes;
  return (
    <div style={{ borderBottom: "1px solid #1a1a1a", padding: "10px 0", opacity: loading ? 0.6 : 1, transition: "opacity 0.15s" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div
          onClick={() => !loading && onToggle()}
          style={{
            width: "18px", height: "18px", borderRadius: "4px", flexShrink: 0,
            border: task.done ? "none" : "1.5px solid #444",
            background: task.done ? "#c8a96e" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: loading ? "default" : "pointer", transition: "all 0.2s",
          }}
        >
          {task.done && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path d="M1 4L3.5 6.5L9 1" stroke="#0f0f0f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        {task.priority && (
          <span style={{ fontSize: "11px", fontWeight: "bold", color: PRIORITY_COLORS[task.priority], flexShrink: 0, width: "10px", textAlign: "center" }}>
            {PRIORITY_LABELS[task.priority]}
          </span>
        )}

        <span
          onClick={() => hasExtra && onExpand()}
          style={{
            color: task.done ? "#444" : "#d4cfc7", fontSize: "15px", lineHeight: 1.5,
            textDecoration: task.done ? "line-through" : "none", flex: 1,
            cursor: hasExtra ? "pointer" : "default", transition: "color 0.2s",
          }}
        >
          {task.text}
        </span>

        {task.deadline && (
          <span style={{
            fontSize: "11px", color: "#888", background: "#1a1a1a",
            border: "1px solid #2a2a2a", borderRadius: "4px", padding: "2px 7px",
            whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {task.deadline}
          </span>
        )}

        {hasExtra && (
          <span
            onClick={onExpand}
            style={{ color: "#333", fontSize: "11px", cursor: "pointer", flexShrink: 0, transition: "color 0.2s" }}
            onMouseEnter={(e) => e.target.style.color = "#888"}
            onMouseLeave={(e) => e.target.style.color = "#333"}
          >
            {expanded ? "▲" : "▼"}
          </span>
        )}
      </div>

      {expanded && task.notes && (
        <div style={{
          marginTop: "8px", marginLeft: "30px", fontSize: "13px", color: "#666",
          fontStyle: "italic", lineHeight: 1.6, borderLeft: "2px solid #2a2a2a", paddingLeft: "12px",
        }}>
          {task.notes}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("oai_todo_key") || "");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKeyModal, setShowKeyModal] = useState(() => !localStorage.getItem("oai_todo_key"));
  const [tasks, setTasks] = useState([]);
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Tell me what to do — or import a conversation to extract tasks");
  const [error, setError] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const inputRef = useRef(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    if (!showKeyModal && !showImport && inputRef.current) inputRef.current.focus();
  }, [showKeyModal, showImport]);

  const handleKeySubmit = () => {
    if (!apiKeyInput.trim()) return;
    const key = apiKeyInput.trim();
    localStorage.setItem("oai_todo_key", key);
    setApiKey(key);
    setShowKeyModal(false);
  };

  const callOpenAI = async (systemPrompt, userContent) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || "OpenAI API error");
    }
    const data = await res.json();
    const raw = data.choices[0].message.content.trim();
    return JSON.parse(raw);
  };

  const sendCommand = async () => {
    if (!command.trim() || loading) return;
    const userCommand = command.trim();
    setCommand("");
    setLoading(true);
    setError("");
    try {
      const parsed = await callOpenAI(
        SYSTEM_PROMPT,
        `Current tasks: ${JSON.stringify(tasksRef.current)}\n\nCommand: ${userCommand}`
      );
      setTasks(parsed.tasks || []);
      setMessage(parsed.message || "Done.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleDone = async (id) => {
    const task = tasks.find((t) => t.id === id);
    if (!task || loading) return;
    const cmd = `${task.done ? "uncheck" : "mark as done"} "${task.text}"`;
    setLoading(true);
    setError("");
    try {
      const parsed = await callOpenAI(
        SYSTEM_PROMPT,
        `Current tasks: ${JSON.stringify(tasksRef.current)}\n\nCommand: ${cmd}`
      );
      setTasks(parsed.tasks || []);
      setMessage(parsed.message || "Done.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    setImportLoading(true);
    setError("");
    try {
      const parsed = await callOpenAI(IMPORT_PROMPT, importText);
      const existing = tasksRef.current;
      const maxId = existing.length > 0 ? Math.max(...existing.map((t) => t.id)) : 0;
      const newTasks = (parsed.tasks || []).map((t, i) => ({ ...t, id: maxId + i + 1 }));
      setTasks([...existing, ...newTasks]);
      setMessage(parsed.message || `Imported ${newTasks.length} tasks.`);
      setShowImport(false);
      setImportText("");
    } catch (e) {
      setError(e.message);
    } finally {
      setImportLoading(false);
    }
  };

  const pending = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  return (
    <div style={{
      minHeight: "100vh", background: "#0f0f0f",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Georgia', 'Times New Roman', serif", padding: "24px",
    }}>
      {showKeyModal && (
        <Modal>
          <Label>Setup</Label>
          <h2 style={{ color: "#f5f0e8", margin: "0 0 8px", fontSize: "22px", fontWeight: "normal" }}>OpenAI API Key</h2>
          <p style={{ color: "#666", fontSize: "14px", margin: "0 0 24px", lineHeight: 1.6 }}>
            Saved to localStorage — enter once, remembered forever.
          </p>
          <input
            autoFocus type="password" placeholder="sk-..."
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleKeySubmit()}
            style={inputStyle}
          />
          <PrimaryButton onClick={handleKeySubmit}>Continue →</PrimaryButton>
        </Modal>
      )}

      {showImport && (
        <Modal wide>
          <Label>Import</Label>
          <h2 style={{ color: "#f5f0e8", margin: "0 0 8px", fontSize: "22px", fontWeight: "normal" }}>Paste Conversation</h2>
          <p style={{ color: "#666", fontSize: "14px", margin: "0 0 16px", lineHeight: 1.6 }}>
            Paste any text — a ChatGPT conversation, notes, emails, anything. GPT will extract tasks, deadlines, and priorities automatically.
          </p>
          <textarea
            autoFocus
            placeholder="Paste your conversation or notes here…"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={12}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
          />
          <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
            <button
              onClick={() => { setShowImport(false); setImportText(""); setError(""); }}
              style={{
                flex: 1, background: "transparent", border: "1px solid #333",
                borderRadius: "8px", color: "#888", padding: "12px",
                fontSize: "14px", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
            <PrimaryButton onClick={handleImport} disabled={importLoading || !importText.trim()} extraStyle={{ flex: 2 }}>
              {importLoading ? "Extracting tasks…" : "Extract Tasks →"}
            </PrimaryButton>
          </div>
          {error && <div style={{ fontSize: "13px", color: "#e05252", marginTop: "12px" }}>⚠ {error}</div>}
        </Modal>
      )}

      <div style={{ width: "100%", maxWidth: "600px" }}>
        <div style={{ marginBottom: "28px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
              <h1 style={{ color: "#f5f0e8", margin: 0, fontSize: "32px", fontWeight: "normal", letterSpacing: "-0.02em" }}>
                Tasks
              </h1>
              {tasks.length > 0 && (
                <span style={{ color: "#555", fontSize: "14px" }}>{pending.length} remaining</span>
              )}
            </div>
            <button
              onClick={() => setShowImport(true)}
              style={{
                background: "transparent", border: "1px solid #2a2a2a", borderRadius: "8px",
                color: "#666", padding: "7px 14px", fontSize: "12px", cursor: "pointer",
                fontFamily: "inherit", letterSpacing: "0.05em", transition: "all 0.2s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#c8a96e"; e.currentTarget.style.color = "#c8a96e"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#666"; }}
            >
              ↓ Import conversation
            </button>
          </div>
          <div style={{
            fontSize: "13px", color: loading ? "#c8a96e" : "#555",
            marginTop: "6px", minHeight: "20px", transition: "color 0.2s", fontStyle: "italic",
          }}>
            {loading ? "thinking…" : error && !showImport ? "" : message}
          </div>
          {error && !showImport && (
            <div style={{ fontSize: "13px", color: "#e05252", marginTop: "4px" }}>⚠ {error}</div>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", marginBottom: "32px" }}>
          <input
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendCommand()}
            placeholder='e.g. "add call dentist — high priority, by Friday"'
            disabled={loading}
            style={{
              flex: 1, background: "#1a1a1a", border: "1px solid #2a2a2a",
              borderRadius: "8px", color: "#f5f0e8", padding: "12px 16px",
              fontSize: "14px", fontFamily: "inherit", outline: "none", transition: "border-color 0.2s",
            }}
            onFocus={(e) => e.target.style.borderColor = "#c8a96e"}
            onBlur={(e) => e.target.style.borderColor = "#2a2a2a"}
          />
          <button
            onClick={sendCommand}
            disabled={loading || !command.trim()}
            style={{
              background: loading ? "#2a2a2a" : "#c8a96e", color: loading ? "#555" : "#0f0f0f",
              border: "none", borderRadius: "8px", padding: "12px 20px",
              fontSize: "14px", cursor: loading ? "default" : "pointer",
              fontFamily: "inherit", transition: "all 0.2s", whiteSpace: "nowrap",
            }}
          >
            {loading ? "…" : "Go"}
          </button>
        </div>

        {tasks.length === 0 ? (
          <div style={{ textAlign: "center", color: "#2a2a2a", fontSize: "14px", padding: "48px 0", borderTop: "1px solid #1a1a1a" }}>
            No tasks yet. Type a command or import a conversation.
          </div>
        ) : (
          <div>
            {pending.length > 0 && (
              <div style={{ marginBottom: "24px" }}>
                {pending.map((task) => (
                  <TaskRow key={task.id} task={task}
                    onToggle={() => toggleDone(task.id)} loading={loading}
                    expanded={expandedId === task.id}
                    onExpand={() => setExpandedId(expandedId === task.id ? null : task.id)}
                  />
                ))}
              </div>
            )}
            {done.length > 0 && (
              <div>
                <div style={{
                  fontSize: "11px", letterSpacing: "0.12em", color: "#333",
                  textTransform: "uppercase", marginBottom: "12px", paddingTop: "8px",
                  borderTop: "1px solid #1a1a1a",
                }}>
                  Completed · {done.length}
                </div>
                {done.map((task) => (
                  <TaskRow key={task.id} task={task}
                    onToggle={() => toggleDone(task.id)} loading={loading}
                    expanded={expandedId === task.id}
                    onExpand={() => setExpandedId(expandedId === task.id ? null : task.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{
          marginTop: "40px", fontSize: "12px", color: "#2a2a2a", lineHeight: 1.7,
          borderTop: "1px solid #1a1a1a", paddingTop: "16px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>! high · medium ↓ low · click ▼ to expand notes</span>
          <span
            onClick={() => { setApiKeyInput(apiKey); setShowKeyModal(true); }}
            style={{ color: "#333", cursor: "pointer", whiteSpace: "nowrap", marginLeft: "16px", transition: "color 0.2s" }}
            onMouseEnter={(e) => e.target.style.color = "#888"}
            onMouseLeave={(e) => e.target.style.color = "#333"}
          >
            change key
          </span>
        </div>
      </div>
    </div>
  );
}
