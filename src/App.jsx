import { useState, useRef, useEffect } from "react";

// ── Prompts ────────────────────────────────────────────────────────────────

const LIST_PROMPT = `You are a todo list manager. The user gives natural language commands to manage tasks.
Respond ONLY with a valid JSON object, no markdown, no preamble.
Structure:
{ "tasks": [ { "id": number, "text": string, "done": boolean, "priority": "high"|"medium"|"low"|null, "deadline": string|null, "notes": string|null, "nextSteps": [ { "id": number, "text": string, "done": boolean } ] } ], "message": string }
Rules:
- Return the COMPLETE updated task list.
- Preserve all fields (nextSteps, notes, etc) on existing tasks unless asked to change them.
- New tasks get empty nextSteps array.
- Assign incrementing IDs from the current max.
- "message" = 1 sentence confirmation.`;

const IMPORT_PROMPT = `You are a task extraction assistant. Extract ALL actionable tasks from pasted text.
Respond ONLY with valid JSON, no markdown, no preamble.
Structure:
{ "tasks": [ { "id": number, "text": string, "done": boolean, "priority": "high"|"medium"|"low"|null, "deadline": string|null, "notes": string|null, "nextSteps": [ { "id": number, "text": string, "done": boolean } ] } ], "message": string }
Rules:
- Extract every task/action item, even implicit ones.
- done = false unless clearly completed.
- priority from urgency language (urgent/ASAP = high).
- deadline = human-readable string if mentioned.
- notes = brief context for that task.
- nextSteps = any sub-tasks or steps mentioned for that task.
- message = summary of what was found.
- IDs start at 1.`;

const NEXT_STEPS_PROMPT = `You are a productivity assistant. Given a task title and context, suggest 3-5 concrete, actionable next steps to complete this task.
Respond ONLY with valid JSON, no markdown, no preamble.
Structure: { "nextSteps": [ { "id": number, "text": string, "done": boolean } ], "summary": string }
Rules:
- Steps should be specific and immediately actionable.
- summary = 1-2 sentence overview of the approach.
- IDs start at 1.`;

const TASK_CHAT_PROMPT = `You are a focused productivity assistant helping the user work on a specific task. 
You have full context of the task details. Give concise, practical advice. 
Do not respond with JSON — respond naturally in plain text.`;

// ── Constants ──────────────────────────────────────────────────────────────

const PC = { high: "#e05252", medium: "#c8a96e", low: "#5a8a6a" };
const PL = { high: "High", medium: "Medium", low: "Low" };

const baseInput = {
  background: "#111", border: "1px solid #2a2a2a", borderRadius: "8px",
  color: "#f5f0e8", padding: "10px 14px", fontSize: "14px",
  fontFamily: "Georgia, serif", outline: "none", width: "100%", boxSizing: "border-box",
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function callGPT(apiKey, systemPrompt, userContent) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini", temperature: 0.3,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
    }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || "API error"); }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Checkbox({ checked, onChange, size = 18 }) {
  return (
    <div onClick={onChange} style={{
      width: size, height: size, borderRadius: "4px", flexShrink: 0,
      border: checked ? "none" : "1.5px solid #444",
      background: checked ? "#c8a96e" : "transparent",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", transition: "all 0.2s",
    }}>
      {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#0f0f0f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </div>
  );
}

function TaskRow({ task, selected, onSelect, onToggle }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: "12px",
        padding: "11px 12px", borderRadius: "8px", cursor: "pointer",
        background: selected ? "#1e1e1e" : "transparent",
        borderLeft: selected ? "2px solid #c8a96e" : "2px solid transparent",
        transition: "all 0.15s",
      }}
      onClick={onSelect}
    >
      <div onClick={(e) => { e.stopPropagation(); onToggle(); }}>
        <Checkbox checked={task.done} onChange={() => {}} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: task.done ? "#555" : "#d4cfc7", fontSize: "14px",
          textDecoration: task.done ? "line-through" : "none",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {task.text}
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "3px", alignItems: "center", flexWrap: "wrap" }}>
          {task.priority && (
            <span style={{ fontSize: "11px", color: PC[task.priority] }}>{PL[task.priority]}</span>
          )}
          {task.deadline && (
            <span style={{ fontSize: "11px", color: "#666" }}>{task.deadline}</span>
          )}
          {task.nextSteps?.length > 0 && (
            <span style={{ fontSize: "11px", color: "#555" }}>
              {task.nextSteps.filter(s => s.done).length}/{task.nextSteps.length} steps
            </span>
          )}
        </div>
      </div>
      <span style={{ color: "#333", fontSize: "12px" }}>›</span>
    </div>
  );
}

function TaskPanel({ task, apiKey, onUpdate, onClose }) {
  const [editing, setEditing] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [newStepText, setNewStepText] = useState("");
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const update = (fields) => onUpdate({ ...task, ...fields });

  const saveField = (field, value) => {
    update({ [field]: value });
    setEditing(e => ({ ...e, [field]: false }));
  };

  const toggleStep = (stepId) => {
    const nextSteps = task.nextSteps.map(s => s.id === stepId ? { ...s, done: !s.done } : s);
    update({ nextSteps });
  };

  const addStep = () => {
    if (!newStepText.trim()) return;
    const maxId = task.nextSteps?.length > 0 ? Math.max(...task.nextSteps.map(s => s.id)) : 0;
    const nextSteps = [...(task.nextSteps || []), { id: maxId + 1, text: newStepText.trim(), done: false }];
    update({ nextSteps });
    setNewStepText("");
  };

  const removeStep = (stepId) => {
    update({ nextSteps: task.nextSteps.filter(s => s.id !== stepId) });
  };

  const suggestSteps = async () => {
    setStepsLoading(true);
    try {
      const raw = await callGPT(apiKey, NEXT_STEPS_PROMPT,
        `Task: ${task.text}\nNotes: ${task.notes || "none"}\nDeadline: ${task.deadline || "none"}`);
      const parsed = JSON.parse(raw);
      const maxId = task.nextSteps?.length > 0 ? Math.max(...task.nextSteps.map(s => s.id)) : 0;
      const newSteps = (parsed.nextSteps || []).map((s, i) => ({ ...s, id: maxId + i + 1 }));
      update({ nextSteps: [...(task.nextSteps || []), ...newSteps], notes: task.notes || parsed.summary });
    } catch (e) { alert("Error: " + e.message); }
    finally { setStepsLoading(false); }
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    const newMessages = [...chatMessages, { role: "user", content: userMsg }];
    setChatMessages(newMessages);
    setChatLoading(true);
    try {
      const context = `Task: ${task.text}\nPriority: ${task.priority || "none"}\nDeadline: ${task.deadline || "none"}\nNotes: ${task.notes || "none"}\nNext steps: ${(task.nextSteps || []).map(s => `${s.done ? "✓" : "○"} ${s.text}`).join(", ") || "none"}`;
      const messages = [
        { role: "system", content: TASK_CHAT_PROMPT + "\n\nTask context:\n" + context },
        ...newMessages,
      ];
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.5, messages }),
      });
      const data = await res.json();
      const reply = data.choices[0].message.content.trim();
      setChatMessages([...newMessages, { role: "assistant", content: reply }]);
    } catch (e) { setChatMessages([...newMessages, { role: "assistant", content: "Error: " + e.message }]); }
    finally { setChatLoading(false); }
  };

  const completedSteps = (task.nextSteps || []).filter(s => s.done).length;
  const totalSteps = (task.nextSteps || []).length;

  return (
    <div style={{
      width: "420px", minWidth: "420px", height: "100vh", background: "#141414",
      borderLeft: "1px solid #1e1e1e", display: "flex", flexDirection: "column",
      fontFamily: "Georgia, serif", overflow: "hidden",
    }}>
      {/* Panel header */}
      <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
          <Checkbox checked={task.done} onChange={() => update({ done: !task.done })} size={20} />
          <div style={{ flex: 1 }}>
            {editing.text ? (
              <input
                autoFocus defaultValue={task.text}
                onBlur={(e) => saveField("text", e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveField("text", e.target.value)}
                style={{ ...baseInput, fontSize: "16px", marginBottom: "0" }}
              />
            ) : (
              <div
                onClick={() => setEditing(e => ({ ...e, text: true }))}
                style={{
                  color: task.done ? "#555" : "#f5f0e8", fontSize: "16px", lineHeight: 1.4,
                  textDecoration: task.done ? "line-through" : "none",
                  cursor: "text",
                }}
              >
                {task.text}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#444", cursor: "pointer",
            fontSize: "18px", padding: "0", lineHeight: 1, flexShrink: 0,
          }}>×</button>
        </div>

        {/* Priority + Deadline row */}
        <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
          <select
            value={task.priority || ""}
            onChange={(e) => update({ priority: e.target.value || null })}
            style={{
              background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "6px",
              color: task.priority ? PC[task.priority] : "#555", fontSize: "12px",
              padding: "5px 10px", fontFamily: "inherit", cursor: "pointer", outline: "none",
            }}
          >
            <option value="">No priority</option>
            <option value="high">! High</option>
            <option value="medium">· Medium</option>
            <option value="low">↓ Low</option>
          </select>

          {editing.deadline ? (
            <input
              autoFocus defaultValue={task.deadline || ""}
              placeholder="e.g. Friday, March 20"
              onBlur={(e) => saveField("deadline", e.target.value || null)}
              onKeyDown={(e) => e.key === "Enter" && saveField("deadline", e.target.value || null)}
              style={{ ...baseInput, fontSize: "12px", padding: "5px 10px", width: "160px", marginBottom: 0 }}
            />
          ) : (
            <div
              onClick={() => setEditing(e => ({ ...e, deadline: true }))}
              style={{
                background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "6px",
                color: task.deadline ? "#c8a96e" : "#444", fontSize: "12px",
                padding: "5px 10px", cursor: "text",
              }}
            >
              {task.deadline || "Add deadline…"}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

        {/* Notes */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "11px", letterSpacing: "0.12em", color: "#555", textTransform: "uppercase", marginBottom: "8px" }}>Notes</div>
          {editing.notes ? (
            <textarea
              autoFocus defaultValue={task.notes || ""}
              rows={4}
              onBlur={(e) => saveField("notes", e.target.value || null)}
              style={{ ...baseInput, resize: "vertical", lineHeight: 1.6, marginBottom: 0 }}
            />
          ) : (
            <div
              onClick={() => setEditing(e => ({ ...e, notes: true }))}
              style={{
                color: task.notes ? "#888" : "#333", fontSize: "14px", lineHeight: 1.6,
                fontStyle: task.notes ? "italic" : "normal", cursor: "text",
                minHeight: "40px",
              }}
            >
              {task.notes || "Add notes…"}
            </div>
          )}
        </div>

        {/* Next Steps */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", letterSpacing: "0.12em", color: "#555", textTransform: "uppercase" }}>
              Next steps {totalSteps > 0 && `· ${completedSteps}/${totalSteps}`}
            </div>
            <button
              onClick={suggestSteps}
              disabled={stepsLoading}
              style={{
                background: "transparent", border: "1px solid #2a2a2a", borderRadius: "6px",
                color: stepsLoading ? "#444" : "#888", fontSize: "11px", padding: "3px 10px",
                cursor: stepsLoading ? "default" : "pointer", fontFamily: "inherit",
              }}
            >
              {stepsLoading ? "thinking…" : "✦ Suggest"}
            </button>
          </div>

          {(task.nextSteps || []).map(step => (
            <div key={step.id} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <Checkbox checked={step.done} onChange={() => toggleStep(step.id)} size={16} />
              <span style={{
                flex: 1, fontSize: "14px", color: step.done ? "#555" : "#aaa",
                textDecoration: step.done ? "line-through" : "none", lineHeight: 1.4,
              }}>
                {step.text}
              </span>
              <button
                onClick={() => removeStep(step.id)}
                style={{ background: "none", border: "none", color: "#333", cursor: "pointer", fontSize: "14px", padding: "0" }}
              >×</button>
            </div>
          ))}

          {/* Add step input */}
          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
            <input
              value={newStepText}
              onChange={(e) => setNewStepText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addStep()}
              placeholder="Add a step…"
              style={{ ...baseInput, fontSize: "13px", padding: "7px 12px", flex: 1, marginBottom: 0 }}
            />
            <button
              onClick={addStep}
              disabled={!newStepText.trim()}
              style={{
                background: newStepText.trim() ? "#c8a96e" : "#1e1e1e",
                color: newStepText.trim() ? "#0f0f0f" : "#444",
                border: "none", borderRadius: "8px", padding: "7px 14px",
                fontSize: "13px", cursor: newStepText.trim() ? "pointer" : "default",
                fontFamily: "inherit", transition: "all 0.2s",
              }}
            >+</button>
          </div>
        </div>

        {/* Task Chat */}
        <div>
          <div style={{ fontSize: "11px", letterSpacing: "0.12em", color: "#555", textTransform: "uppercase", marginBottom: "10px" }}>
            Chat about this task
          </div>

          {chatMessages.length > 0 && (
            <div style={{ marginBottom: "12px", maxHeight: "280px", overflowY: "auto" }}>
              {chatMessages.map((m, i) => (
                <div key={i} style={{
                  marginBottom: "10px",
                  display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                }}>
                  <div style={{
                    maxWidth: "85%", padding: "8px 12px", borderRadius: "10px",
                    fontSize: "13px", lineHeight: 1.5,
                    background: m.role === "user" ? "#c8a96e" : "#1e1e1e",
                    color: m.role === "user" ? "#0f0f0f" : "#aaa",
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "10px" }}>
                  <div style={{ padding: "8px 12px", borderRadius: "10px", background: "#1e1e1e", color: "#555", fontSize: "13px" }}>
                    thinking…
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          <div style={{ display: "flex", gap: "8px" }}>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder="Ask anything about this task…"
              disabled={chatLoading}
              style={{ ...baseInput, fontSize: "13px", padding: "8px 12px", flex: 1, marginBottom: 0 }}
            />
            <button
              onClick={sendChat}
              disabled={chatLoading || !chatInput.trim()}
              style={{
                background: chatInput.trim() && !chatLoading ? "#c8a96e" : "#1e1e1e",
                color: chatInput.trim() && !chatLoading ? "#0f0f0f" : "#444",
                border: "none", borderRadius: "8px", padding: "8px 14px",
                fontSize: "13px", cursor: chatInput.trim() ? "pointer" : "default",
                fontFamily: "inherit", transition: "all 0.2s",
              }}
            >→</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("oai_todo_key") || "");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKeyModal, setShowKeyModal] = useState(() => !localStorage.getItem("oai_todo_key"));
  const [tasks, setTasks] = useState([]);
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Type a command or import a conversation to get started");
  const [error, setError] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
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
    setApiKey(key); setShowKeyModal(false);
  };

  const sendCommand = async () => {
    if (!command.trim() || loading) return;
    const cmd = command.trim(); setCommand(""); setLoading(true); setError("");
    try {
      const raw = await callGPT(apiKey, LIST_PROMPT,
        `Current tasks: ${JSON.stringify(tasksRef.current)}\n\nCommand: ${cmd}`);
      const parsed = JSON.parse(raw);
      setTasks(parsed.tasks || []); setMessage(parsed.message || "Done.");
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const toggleDone = async (id) => {
    const task = tasks.find(t => t.id === id); if (!task || loading) return;
    const cmd = `${task.done ? "uncheck" : "mark as done"} task with id ${id}`;
    setLoading(true); setError("");
    try {
      const raw = await callGPT(apiKey, LIST_PROMPT,
        `Current tasks: ${JSON.stringify(tasksRef.current)}\n\nCommand: ${cmd}`);
      const parsed = JSON.parse(raw);
      setTasks(parsed.tasks || []); setMessage(parsed.message || "Done.");
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    setImportLoading(true); setError("");
    try {
      const raw = await callGPT(apiKey, IMPORT_PROMPT, importText);
      const parsed = JSON.parse(raw);
      const existing = tasksRef.current;
      const maxId = existing.length > 0 ? Math.max(...existing.map(t => t.id)) : 0;
      const newTasks = (parsed.tasks || []).map((t, i) => ({ ...t, id: maxId + i + 1, nextSteps: t.nextSteps || [] }));
      setTasks([...existing, ...newTasks]);
      setMessage(parsed.message || `Imported ${newTasks.length} tasks.`);
      setShowImport(false); setImportText("");
    } catch (e) { setError(e.message); } finally { setImportLoading(false); }
  };

  const updateTask = (updated) => {
    setTasks(tasks => tasks.map(t => t.id === updated.id ? updated : t));
  };

  const selectedTask = tasks.find(t => t.id === selectedId);
  const pending = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0f0f0f", fontFamily: "Georgia, serif", overflow: "hidden" }}>

      {/* API Key Modal */}
      {showKeyModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: "24px" }}>
          <div style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "12px", padding: "40px", maxWidth: "420px", width: "100%" }}>
            <div style={{ fontSize: "11px", letterSpacing: "0.15em", color: "#555", marginBottom: "12px", textTransform: "uppercase" }}>Setup</div>
            <h2 style={{ color: "#f5f0e8", margin: "0 0 8px", fontSize: "22px", fontWeight: "normal" }}>OpenAI API Key</h2>
            <p style={{ color: "#666", fontSize: "14px", margin: "0 0 24px", lineHeight: 1.6 }}>Saved to localStorage — enter once, remembered forever.</p>
            <input autoFocus type="password" placeholder="sk-..." value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleKeySubmit()}
              style={{ ...baseInput, marginBottom: "16px" }}
            />
            <button onClick={handleKeySubmit} style={{ width: "100%", background: "#c8a96e", color: "#0f0f0f", border: "none", borderRadius: "8px", padding: "12px", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: "24px" }}>
          <div style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "12px", padding: "40px", maxWidth: "580px", width: "100%" }}>
            <div style={{ fontSize: "11px", letterSpacing: "0.15em", color: "#555", marginBottom: "12px", textTransform: "uppercase" }}>Import</div>
            <h2 style={{ color: "#f5f0e8", margin: "0 0 8px", fontSize: "22px", fontWeight: "normal" }}>Paste Conversation</h2>
            <p style={{ color: "#666", fontSize: "14px", margin: "0 0 16px", lineHeight: 1.6 }}>Paste any text — ChatGPT conversation, notes, emails. GPT extracts tasks, deadlines, priorities, and next steps automatically.</p>
            <textarea autoFocus placeholder="Paste your conversation or notes here…" value={importText}
              onChange={e => setImportText(e.target.value)} rows={12}
              style={{ ...baseInput, resize: "vertical", lineHeight: 1.6, marginBottom: "16px" }}
            />
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => { setShowImport(false); setImportText(""); setError(""); }}
                style={{ flex: 1, background: "transparent", border: "1px solid #333", borderRadius: "8px", color: "#888", padding: "12px", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>
                Cancel
              </button>
              <button onClick={handleImport} disabled={importLoading || !importText.trim()}
                style={{ flex: 2, background: importLoading || !importText.trim() ? "#2a2a2a" : "#c8a96e", color: importLoading || !importText.trim() ? "#555" : "#0f0f0f", border: "none", borderRadius: "8px", padding: "12px", fontSize: "14px", cursor: importLoading ? "default" : "pointer", fontFamily: "inherit" }}>
                {importLoading ? "Extracting tasks…" : "Extract Tasks →"}
              </button>
            </div>
            {error && <div style={{ fontSize: "13px", color: "#e05252", marginTop: "12px" }}>⚠ {error}</div>}
          </div>
        </div>
      )}

      {/* Left — Task List */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, borderRight: selectedTask ? "1px solid #1e1e1e" : "none" }}>
        {/* Header */}
        <div style={{ padding: "28px 28px 16px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "4px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
              <h1 style={{ color: "#f5f0e8", margin: 0, fontSize: "28px", fontWeight: "normal", letterSpacing: "-0.02em" }}>Tasks</h1>
              {tasks.length > 0 && <span style={{ color: "#555", fontSize: "13px" }}>{pending.length} remaining</span>}
            </div>
            <button onClick={() => setShowImport(true)} style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: "8px", color: "#666", padding: "6px 12px", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#c8a96e"; e.currentTarget.style.color = "#c8a96e"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#666"; }}>
              ↓ Import
            </button>
          </div>
          <div style={{ fontSize: "12px", color: loading ? "#c8a96e" : "#444", fontStyle: "italic", minHeight: "18px" }}>
            {loading ? "thinking…" : error ? <span style={{ color: "#e05252" }}>⚠ {error}</span> : message}
          </div>
        </div>

        {/* Command input */}
        <div style={{ padding: "0 28px 20px", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: "8px" }}>
            <input ref={inputRef} value={command} onChange={e => setCommand(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendCommand()}
              placeholder='e.g. "add review contract — high priority, by Monday"'
              disabled={loading}
              style={{ ...baseInput, flex: 1, marginBottom: 0, fontSize: "13px" }}
              onFocus={e => e.target.style.borderColor = "#c8a96e"}
              onBlur={e => e.target.style.borderColor = "#2a2a2a"}
            />
            <button onClick={sendCommand} disabled={loading || !command.trim()}
              style={{ background: loading ? "#1e1e1e" : "#c8a96e", color: loading ? "#444" : "#0f0f0f", border: "none", borderRadius: "8px", padding: "10px 18px", fontSize: "13px", cursor: loading ? "default" : "pointer", fontFamily: "inherit", transition: "all 0.2s", whiteSpace: "nowrap" }}>
              {loading ? "…" : "Go"}
            </button>
          </div>
        </div>

        {/* Task list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px" }}>
          {tasks.length === 0 ? (
            <div style={{ textAlign: "center", color: "#2a2a2a", fontSize: "14px", padding: "60px 0" }}>
              No tasks yet. Type a command or import a conversation.
            </div>
          ) : (
            <>
              {pending.map(task => (
                <TaskRow key={task.id} task={task} selected={selectedId === task.id}
                  onSelect={() => setSelectedId(selectedId === task.id ? null : task.id)}
                  onToggle={() => toggleDone(task.id)}
                />
              ))}
              {done.length > 0 && (
                <>
                  <div style={{ fontSize: "11px", letterSpacing: "0.12em", color: "#333", textTransform: "uppercase", padding: "16px 12px 8px" }}>
                    Completed · {done.length}
                  </div>
                  {done.map(task => (
                    <TaskRow key={task.id} task={task} selected={selectedId === task.id}
                      onSelect={() => setSelectedId(selectedId === task.id ? null : task.id)}
                      onToggle={() => toggleDone(task.id)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 28px", borderTop: "1px solid #1a1a1a", display: "flex", justifyContent: "flex-end" }}>
          <span onClick={() => { setApiKeyInput(apiKey); setShowKeyModal(true); }}
            style={{ fontSize: "12px", color: "#333", cursor: "pointer", transition: "color 0.2s" }}
            onMouseEnter={e => e.target.style.color = "#888"}
            onMouseLeave={e => e.target.style.color = "#333"}>
            change key
          </span>
        </div>
      </div>

      {/* Right — Task Panel */}
      {selectedTask && (
        <TaskPanel
          key={selectedTask.id}
          task={selectedTask}
          apiKey={apiKey}
          onUpdate={updateTask}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
