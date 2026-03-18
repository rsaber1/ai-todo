import { useState, useRef, useEffect, useCallback } from "react";

// ── Prompts ────────────────────────────────────────────────────────────────

const LIST_PROMPT = `You are a todo list manager. The user gives natural language commands to manage tasks.
Respond ONLY with a valid JSON object, no markdown, no preamble.
Structure:
{ "tasks": [ { "id": number, "text": string, "done": boolean, "priority": "high"|"medium"|"low"|null, "deadline": string|null, "notes": string|null, "nextSteps": [ { "id": number, "text": string, "done": boolean } ] } ], "message": string }
Rules:
- Return the COMPLETE updated task list.
- Preserve all fields on existing tasks unless asked to change them.
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

const NEXT_STEPS_PROMPT = `You are a productivity assistant. Given a task, suggest 3-5 concrete actionable next steps.
Respond ONLY with valid JSON, no markdown, no preamble.
Structure: { "nextSteps": [ { "id": number, "text": string, "done": boolean } ], "summary": string }
- Steps should be specific and immediately actionable.
- summary = 1-2 sentence overview.
- IDs start at 1.`;

const TASK_CHAT_PROMPT = `You are a focused productivity assistant helping with a specific task. Give concise, practical advice in plain text. No JSON.`;

const VOICE_PROMPT = `You are a helpful voice assistant for a task management app. The user may ask about their tasks, add new ones, mark things done, or just chat. Keep responses SHORT — 1-3 sentences max, conversational. If the user wants to modify tasks, confirm what you did briefly.`;

// ── Constants ──────────────────────────────────────────────────────────────

const PRIORITY_COLORS = { high: "#E53935", medium: "#FB8C00", low: "#43A047" };
const PRIORITY_BG = { high: "#FFEBEE", medium: "#FFF3E0", low: "#E8F5E9" };
const PRIORITY_LABELS = { high: "High", medium: "Medium", low: "Low" };
const VOICES = ["alloy", "echo", "fable", "nova", "onyx", "shimmer"];

const CARD_COLORS = [
  { header: "#1565C0", light: "#E3F2FD" },
  { header: "#6A1B9A", light: "#F3E5F5" },
  { header: "#00695C", light: "#E0F2F1" },
  { header: "#E65100", light: "#FFF3E0" },
  { header: "#37474F", light: "#ECEFF1" },
  { header: "#AD1457", light: "#FCE4EC" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function callGPT(apiKey, systemPrompt, userContent, json = true) {
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

async function textToSpeech(apiKey, text, voice) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "tts-1", input: text, voice, speed: 1.0 }),
  });
  if (!res.ok) throw new Error("TTS failed");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── Checkbox ──────────────────────────────────────────────────────────────

function Checkbox({ checked, onChange, size = 18 }) {
  return (
    <div onClick={e => { e.stopPropagation(); onChange(); }} style={{
      width: size, height: size, borderRadius: "4px", flexShrink: 0,
      border: checked ? "none" : "2px solid #ccc",
      background: checked ? "#1565C0" : "transparent",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", transition: "all 0.2s",
    }}>
      {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </div>
  );
}

// ── Task Tile Card ─────────────────────────────────────────────────────────

function TaskTile({ task, index, onOpen, onToggle }) {
  const color = CARD_COLORS[index % CARD_COLORS.length];
  const completedSteps = (task.nextSteps || []).filter(s => s.done).length;
  const totalSteps = (task.nextSteps || []).length;
  const progress = totalSteps > 0 ? completedSteps / totalSteps : 0;

  return (
    <div
      onClick={() => onOpen(task)}
      style={{
        background: "white", borderRadius: "8px", overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)", cursor: "pointer",
        transition: "transform 0.15s, box-shadow 0.15s", display: "flex", flexDirection: "column",
        opacity: task.done ? 0.6 : 1,
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.18)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)"; }}
    >
      {/* Coloured header bar */}
      <div style={{ background: color.header, padding: "14px 14px 10px", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
          <div onClick={e => { e.stopPropagation(); onToggle(task.id); }} style={{ marginTop: "2px" }}>
            <div style={{
              width: 16, height: 16, borderRadius: "3px", border: "2px solid rgba(255,255,255,0.6)",
              background: task.done ? "rgba(255,255,255,0.9)" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {task.done && <svg width="9" height="7" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke={color.header} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </div>
          </div>
          <div style={{ flex: 1, color: "white", fontSize: "13px", fontWeight: "600", lineHeight: 1.3, textDecoration: task.done ? "line-through" : "none", opacity: task.done ? 0.7 : 1 }}>
            {task.text.length > 50 ? task.text.slice(0, 50) + "…" : task.text}
          </div>
        </div>
      </div>

      {/* Card body */}
      <div style={{ padding: "10px 14px 14px", flex: 1, background: color.light }}>
        {/* Priority + deadline */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
          {task.priority && (
            <span style={{ fontSize: "10px", fontWeight: "700", color: PRIORITY_COLORS[task.priority], background: PRIORITY_BG[task.priority], padding: "2px 7px", borderRadius: "12px", letterSpacing: "0.05em" }}>
              {PRIORITY_LABELS[task.priority].toUpperCase()}
            </span>
          )}
          {task.deadline && (
            <span style={{ fontSize: "10px", color: "#555", background: "rgba(0,0,0,0.07)", padding: "2px 7px", borderRadius: "12px" }}>
              {task.deadline}
            </span>
          )}
        </div>

        {/* Notes preview */}
        {task.notes && (
          <p style={{ fontSize: "12px", color: "#666", margin: "0 0 8px", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {task.notes}
          </p>
        )}

        {/* Steps progress */}
        {totalSteps > 0 && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ fontSize: "10px", color: "#888" }}>Steps</span>
              <span style={{ fontSize: "10px", color: "#888" }}>{completedSteps}/{totalSteps}</span>
            </div>
            <div style={{ height: "4px", background: "rgba(0,0,0,0.1)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress * 100}%`, background: color.header, borderRadius: "2px", transition: "width 0.3s" }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Task Modal (popout) ────────────────────────────────────────────────────

function TaskModal({ task, apiKey, onUpdate, onClose }) {
  const [editing, setEditing] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [newStepText, setNewStepText] = useState("");
  const chatEndRef = useRef(null);
  const color = CARD_COLORS[task.id % CARD_COLORS.length];

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const update = (fields) => onUpdate({ ...task, ...fields });

  const saveField = (field, value) => { update({ [field]: value }); setEditing(e => ({ ...e, [field]: false })); };

  const toggleStep = (stepId) => {
    update({ nextSteps: task.nextSteps.map(s => s.id === stepId ? { ...s, done: !s.done } : s) });
  };

  const addStep = () => {
    if (!newStepText.trim()) return;
    const maxId = task.nextSteps?.length > 0 ? Math.max(...task.nextSteps.map(s => s.id)) : 0;
    update({ nextSteps: [...(task.nextSteps || []), { id: maxId + 1, text: newStepText.trim(), done: false }] });
    setNewStepText("");
  };

  const suggestSteps = async () => {
    setStepsLoading(true);
    try {
      const raw = await callGPT(apiKey, NEXT_STEPS_PROMPT, `Task: ${task.text}\nNotes: ${task.notes || "none"}\nDeadline: ${task.deadline || "none"}`);
      const parsed = JSON.parse(raw);
      const maxId = task.nextSteps?.length > 0 ? Math.max(...task.nextSteps.map(s => s.id)) : 0;
      const newSteps = (parsed.nextSteps || []).map((s, i) => ({ ...s, id: maxId + i + 1 }));
      update({ nextSteps: [...(task.nextSteps || []), ...newSteps], notes: task.notes || parsed.summary });
    } catch (e) { alert("Error: " + e.message); }
    finally { setStepsLoading(false); }
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim(); setChatInput("");
    const newMessages = [...chatMessages, { role: "user", content: userMsg }];
    setChatMessages(newMessages); setChatLoading(true);
    try {
      const context = `Task: ${task.text}\nPriority: ${task.priority || "none"}\nDeadline: ${task.deadline || "none"}\nNotes: ${task.notes || "none"}\nNext steps: ${(task.nextSteps || []).map(s => `${s.done ? "✓" : "○"} ${s.text}`).join(", ") || "none"}`;
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.5, messages: [{ role: "system", content: TASK_CHAT_PROMPT + "\n\nTask context:\n" + context }, ...newMessages] }),
      });
      const data = await res.json();
      setChatMessages([...newMessages, { role: "assistant", content: data.choices[0].message.content.trim() }]);
    } catch (e) { setChatMessages([...newMessages, { role: "assistant", content: "Error: " + e.message }]); }
    finally { setChatLoading(false); }
  };

  const completedSteps = (task.nextSteps || []).filter(s => s.done).length;
  const totalSteps = (task.nextSteps || []).length;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: "20px" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "white", borderRadius: "12px", width: "100%", maxWidth: "680px", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>

        {/* Modal header */}
        <div style={{ background: color.header, padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
            <Checkbox checked={task.done} onChange={() => update({ done: !task.done })} size={20} />
            <div style={{ flex: 1 }}>
              {editing.text ? (
                <input autoFocus defaultValue={task.text}
                  onBlur={e => saveField("text", e.target.value)}
                  onKeyDown={e => e.key === "Enter" && saveField("text", e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.15)", border: "none", borderBottom: "2px solid rgba(255,255,255,0.5)", color: "white", fontSize: "17px", fontFamily: "inherit", outline: "none", padding: "4px 0" }}
                />
              ) : (
                <div onClick={() => setEditing(e => ({ ...e, text: true }))}
                  style={{ color: "white", fontSize: "17px", fontWeight: "600", lineHeight: 1.3, cursor: "text", textDecoration: task.done ? "line-through" : "none", opacity: task.done ? 0.7 : 1 }}>
                  {task.text}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "white", width: "28px", height: "28px", borderRadius: "50%", cursor: "pointer", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
          </div>

          {/* Priority + Deadline */}
          <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
            <select value={task.priority || ""} onChange={e => update({ priority: e.target.value || null })}
              style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: "6px", color: "white", fontSize: "12px", padding: "5px 10px", fontFamily: "inherit", cursor: "pointer", outline: "none" }}>
              <option value="">No priority</option>
              <option value="high">! High</option>
              <option value="medium">· Medium</option>
              <option value="low">↓ Low</option>
            </select>
            {editing.deadline ? (
              <input autoFocus defaultValue={task.deadline || ""} placeholder="e.g. Friday, March 20"
                onBlur={e => saveField("deadline", e.target.value || null)}
                onKeyDown={e => e.key === "Enter" && saveField("deadline", e.target.value || null)}
                style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: "6px", color: "white", fontSize: "12px", padding: "5px 10px", fontFamily: "inherit", outline: "none", width: "160px" }}
              />
            ) : (
              <div onClick={() => setEditing(e => ({ ...e, deadline: true }))}
                style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: "6px", color: task.deadline ? "white" : "rgba(255,255,255,0.5)", fontSize: "12px", padding: "5px 10px", cursor: "text" }}>
                {task.deadline || "Add deadline…"}
              </div>
            )}
          </div>
        </div>

        {/* Modal body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* Notes */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", color: "#999", textTransform: "uppercase", marginBottom: "8px" }}>Notes</div>
            {editing.notes ? (
              <textarea autoFocus defaultValue={task.notes || ""} rows={3}
                onBlur={e => saveField("notes", e.target.value || null)}
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #ddd", borderRadius: "8px", padding: "10px 12px", fontSize: "14px", fontFamily: "inherit", outline: "none", resize: "vertical", lineHeight: 1.6, color: "#333" }}
              />
            ) : (
              <div onClick={() => setEditing(e => ({ ...e, notes: true }))}
                style={{ color: task.notes ? "#555" : "#bbb", fontSize: "14px", lineHeight: 1.6, fontStyle: task.notes ? "normal" : "italic", cursor: "text", minHeight: "36px", padding: "4px 0" }}>
                {task.notes || "Add notes…"}
              </div>
            )}
          </div>

          {/* Next Steps */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", color: "#999", textTransform: "uppercase" }}>
                Next steps {totalSteps > 0 && `· ${completedSteps}/${totalSteps}`}
              </div>
              <button onClick={suggestSteps} disabled={stepsLoading}
                style={{ background: color.header, color: "white", border: "none", borderRadius: "6px", padding: "4px 12px", fontSize: "12px", cursor: stepsLoading ? "default" : "pointer", fontFamily: "inherit", opacity: stepsLoading ? 0.6 : 1 }}>
                {stepsLoading ? "thinking…" : "✦ Suggest"}
              </button>
            </div>

            {(task.nextSteps || []).map(step => (
              <div key={step.id} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px", padding: "8px 12px", background: step.done ? "#f9f9f9" : "#fff", border: "1px solid #eee", borderRadius: "8px" }}>
                <Checkbox checked={step.done} onChange={() => toggleStep(step.id)} size={16} />
                <span style={{ flex: 1, fontSize: "14px", color: step.done ? "#aaa" : "#333", textDecoration: step.done ? "line-through" : "none", lineHeight: 1.4 }}>{step.text}</span>
                <button onClick={() => update({ nextSteps: task.nextSteps.filter(s => s.id !== step.id) })}
                  style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: "16px", padding: "0", lineHeight: 1 }}>×</button>
              </div>
            ))}

            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              <input value={newStepText} onChange={e => setNewStepText(e.target.value)} onKeyDown={e => e.key === "Enter" && addStep()}
                placeholder="Add a step…"
                style={{ flex: 1, border: "1px solid #ddd", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", fontFamily: "inherit", outline: "none", color: "#333" }}
              />
              <button onClick={addStep} disabled={!newStepText.trim()}
                style={{ background: newStepText.trim() ? color.header : "#eee", color: newStepText.trim() ? "white" : "#bbb", border: "none", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", cursor: newStepText.trim() ? "pointer" : "default", fontFamily: "inherit", transition: "all 0.2s" }}>
                +
              </button>
            </div>
          </div>

          {/* Task Chat */}
          <div>
            <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", color: "#999", textTransform: "uppercase", marginBottom: "10px" }}>Chat about this task</div>
            {chatMessages.length > 0 && (
              <div style={{ marginBottom: "12px", maxHeight: "240px", overflowY: "auto" }}>
                {chatMessages.map((m, i) => (
                  <div key={i} style={{ marginBottom: "8px", display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={{ maxWidth: "85%", padding: "8px 12px", borderRadius: "12px", fontSize: "14px", lineHeight: 1.5, background: m.role === "user" ? color.header : "#f1f3f4", color: m.role === "user" ? "white" : "#333" }}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "8px" }}>
                    <div style={{ padding: "8px 12px", borderRadius: "12px", background: "#f1f3f4", color: "#999", fontSize: "14px" }}>thinking…</div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendChat()}
                placeholder="Ask anything about this task…" disabled={chatLoading}
                style={{ flex: 1, border: "1px solid #ddd", borderRadius: "8px", padding: "9px 12px", fontSize: "14px", fontFamily: "inherit", outline: "none", color: "#333" }}
              />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                style={{ background: chatInput.trim() && !chatLoading ? color.header : "#eee", color: chatInput.trim() && !chatLoading ? "white" : "#bbb", border: "none", borderRadius: "8px", padding: "9px 16px", fontSize: "14px", cursor: chatInput.trim() ? "pointer" : "default", fontFamily: "inherit", transition: "all 0.2s" }}>
                →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Voice Orb ──────────────────────────────────────────────────────────────

function VoiceOrb({ apiKey, voice, tasks, onTasksUpdate, onClose }) {
  const [phase, setPhase] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);
  const activeRef = useRef(true);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const phaseColors = { idle: "#1565C0", listening: "#43A047", thinking: "#FB8C00", speaking: "#6A1B9A" };
  const phaseLabels = { idle: "Starting…", listening: "Listening — speak now", thinking: "Thinking…", speaking: "Speaking…" };

  const speak = async (text) => {
    if (!activeRef.current) return;
    setPhase("speaking");
    try {
      const url = await textToSpeech(apiKey, text, voice);
      const audio = new Audio(url);
      audioRef.current = audio;
      await new Promise(resolve => { audio.onended = resolve; audio.onerror = resolve; audio.play().catch(resolve); });
      URL.revokeObjectURL(url);
    } catch (e) { console.error("TTS error:", e); }
    if (activeRef.current) startListening();
  };

  const processAudio = async (audioBlob) => {
    if (!activeRef.current) return;
    setPhase("thinking");
    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "audio.webm");
      formData.append("model", "whisper-1");
      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      if (!whisperRes.ok) throw new Error("Whisper transcription failed");
      const { text: transcript } = await whisperRes.json();
      if (!transcript?.trim()) { if (activeRef.current) startListening(); return; }

      const raw = await callGPT(
        apiKey,
        VOICE_PROMPT + `\n\nCurrent tasks (JSON): ${JSON.stringify(tasksRef.current)}\n\nIf the user wants to modify tasks, return a JSON block at the very end:\n<TASKS_UPDATE>[updated tasks array]</TASKS_UPDATE>\nOtherwise omit it.`,
        transcript, false
      );

      let reply = raw;
      const updateMatch = raw.match(/<TASKS_UPDATE>([\s\S]*?)<\/TASKS_UPDATE>/);
      if (updateMatch) {
        reply = raw.replace(/<TASKS_UPDATE>[\s\S]*?<\/TASKS_UPDATE>/, "").trim();
        try {
          const updatedTasks = JSON.parse(updateMatch[1]);
          if (Array.isArray(updatedTasks) && updatedTasks.length > 0) onTasksUpdate(updatedTasks);
        } catch (_) {}
      }
      await speak(reply);
    } catch (e) {
      setErrorMsg(e.message);
      if (activeRef.current) await speak("Sorry, I hit an error. Please try again.");
    }
  };

  const startListening = async () => {
    if (!activeRef.current) return;
    setPhase("listening");
    setErrorMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size > 5000) processAudio(blob);
        else if (activeRef.current) startListening();
      };
      recorder.start();
      setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 8000);
    } catch (e) {
      setErrorMsg("Microphone access denied — please allow mic permissions and try again.");
      setPhase("idle");
    }
  };

  useEffect(() => {
    activeRef.current = true;
    startListening();
    return () => {
      activeRef.current = false;
      mediaRecorderRef.current?.stop();
      audioRef.current?.pause();
    };
  }, []);

  const handleOrbClick = () => {
    if (phase === "listening" && mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    } else if (phase === "idle") {
      startListening();
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 400 }}>
      <style>{`
        @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
      <div onClick={handleOrbClick} style={{
        width: "130px", height: "130px", borderRadius: "50%",
        background: phaseColors[phase],
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: "28px", transition: "background 0.4s",
        boxShadow: `0 0 50px ${phaseColors[phase]}55`,
        cursor: phase === "listening" ? "pointer" : "default",
        animation: phase === "listening" ? "pulse 1.8s ease-in-out infinite" : phase === "thinking" ? "spin 2s linear infinite" : "none",
      }}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="white" opacity={phase === "speaking" ? 0.5 : 1}/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          <line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          <line x1="8" y1="23" x2="16" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      <div style={{ color: "white", fontSize: "20px", fontFamily: "Georgia, serif", marginBottom: "8px" }}>{phaseLabels[phase]}</div>
      <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "13px", fontFamily: "Georgia, serif", marginBottom: "12px" }}>
        {phase === "listening" ? "Recording up to 8s — tap orb to send early" : "Speak to manage your tasks"}
      </div>
      {errorMsg && <div style={{ color: "#EF9A9A", fontSize: "13px", fontFamily: "Georgia, serif", marginBottom: "12px", maxWidth: "300px", textAlign: "center" }}>⚠ {errorMsg}</div>}
      <button onClick={() => { activeRef.current = false; mediaRecorderRef.current?.stop(); audioRef.current?.pause(); onClose(); }}
        style={{ marginTop: "24px", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: "24px", color: "white", padding: "10px 32px", fontSize: "14px", cursor: "pointer", fontFamily: "Georgia, serif" }}>
        End voice session
      </button>
    </div>
  );
}

// ── Settings Modal ─────────────────────────────────────────────────────────

function SettingsModal({ apiKey, voice, onVoiceChange, onKeyChange, onClose }) {
  const [keyInput, setKeyInput] = useState(apiKey);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: "20px" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "white", borderRadius: "12px", padding: "32px", width: "100%", maxWidth: "400px", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <h2 style={{ margin: "0 0 24px", fontSize: "18px", fontWeight: "600", color: "#111", fontFamily: "Georgia, serif" }}>Settings</h2>

        <div style={{ marginBottom: "20px" }}>
          <label style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", color: "#999", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>OpenAI API Key</label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)}
              style={{ flex: 1, border: "1px solid #ddd", borderRadius: "8px", padding: "9px 12px", fontSize: "14px", fontFamily: "monospace", outline: "none", color: "#333" }}
            />
            <button onClick={() => onKeyChange(keyInput)}
              style={{ background: "#1565C0", color: "white", border: "none", borderRadius: "8px", padding: "9px 16px", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>Save</button>
          </div>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <label style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", color: "#999", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>Voice</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {VOICES.map(v => (
              <button key={v} onClick={() => onVoiceChange(v)}
                style={{ background: voice === v ? "#1565C0" : "#f1f3f4", color: voice === v ? "white" : "#555", border: "none", borderRadius: "20px", padding: "6px 16px", fontSize: "13px", cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize", transition: "all 0.2s" }}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <button onClick={onClose}
          style={{ width: "100%", background: "#f1f3f4", border: "none", borderRadius: "8px", padding: "10px", fontSize: "14px", cursor: "pointer", fontFamily: "inherit", color: "#333" }}>
          Done
        </button>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("oai_todo_key") || "");
  const [voice, setVoice] = useState(() => localStorage.getItem("oai_todo_voice") || "nova");
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
  const [selectedTask, setSelectedTask] = useState(null);
  const [showVoice, setShowVoice] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [filter, setFilter] = useState("all"); // all | active | done
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const handleKeySubmit = () => {
    if (!apiKeyInput.trim()) return;
    const key = apiKeyInput.trim();
    localStorage.setItem("oai_todo_key", key);
    setApiKey(key); setShowKeyModal(false);
  };

  const saveKey = (key) => {
    localStorage.setItem("oai_todo_key", key);
    setApiKey(key);
  };

  const saveVoice = (v) => {
    localStorage.setItem("oai_todo_voice", v);
    setVoice(v);
  };

  const sendCommand = async () => {
    if (!command.trim() || loading) return;
    const cmd = command.trim(); setCommand(""); setLoading(true); setError("");
    try {
      const raw = await callGPT(apiKey, LIST_PROMPT, `Current tasks: ${JSON.stringify(tasksRef.current)}\n\nCommand: ${cmd}`);
      const parsed = JSON.parse(raw);
      setTasks(parsed.tasks || []); setMessage(parsed.message || "Done.");
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const toggleDone = async (id) => {
    const task = tasks.find(t => t.id === id); if (!task || loading) return;
    const cmd = `${task.done ? "uncheck" : "mark as done"} task with id ${id}`;
    setLoading(true); setError("");
    try {
      const raw = await callGPT(apiKey, LIST_PROMPT, `Current tasks: ${JSON.stringify(tasksRef.current)}\n\nCommand: ${cmd}`);
      const parsed = JSON.parse(raw);
      setTasks(parsed.tasks || []); setMessage(parsed.message || "Done.");
      if (selectedTask?.id === id) setSelectedTask(prev => ({ ...prev, done: !prev.done }));
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
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    setSelectedTask(updated);
  };

  const filteredTasks = tasks.filter(t => filter === "all" ? true : filter === "active" ? !t.done : t.done);
  const pendingCount = tasks.filter(t => !t.done).length;

  return (
    <div style={{ minHeight: "100vh", background: "#F5F5F5", fontFamily: "Georgia, serif" }}>

      {/* API Key Modal */}
      {showKeyModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: "20px" }}>
          <div style={{ background: "white", borderRadius: "12px", padding: "40px", maxWidth: "420px", width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.15em", color: "#999", marginBottom: "12px", textTransform: "uppercase" }}>Setup</div>
            <h2 style={{ color: "#111", margin: "0 0 8px", fontSize: "22px", fontWeight: "normal" }}>OpenAI API Key</h2>
            <p style={{ color: "#888", fontSize: "14px", margin: "0 0 24px", lineHeight: 1.6 }}>Saved to localStorage — enter once, remembered forever.</p>
            <input autoFocus type="password" placeholder="sk-..." value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleKeySubmit()}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #ddd", borderRadius: "8px", padding: "12px 14px", fontSize: "14px", fontFamily: "monospace", marginBottom: "16px", outline: "none", color: "#333" }}
            />
            <button onClick={handleKeySubmit} style={{ width: "100%", background: "#1565C0", color: "white", border: "none", borderRadius: "8px", padding: "12px", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>Continue →</button>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: "20px" }}
          onClick={e => e.target === e.currentTarget && setShowImport(false)}>
          <div style={{ background: "white", borderRadius: "12px", padding: "40px", maxWidth: "580px", width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.15em", color: "#999", marginBottom: "12px", textTransform: "uppercase" }}>Import</div>
            <h2 style={{ color: "#111", margin: "0 0 8px", fontSize: "22px", fontWeight: "normal" }}>Paste Conversation</h2>
            <p style={{ color: "#888", fontSize: "14px", margin: "0 0 16px", lineHeight: 1.6 }}>Paste any text — ChatGPT conversation, notes, emails. GPT extracts tasks, deadlines, priorities, and next steps.</p>
            <textarea autoFocus placeholder="Paste your conversation or notes here…" value={importText}
              onChange={e => setImportText(e.target.value)} rows={10}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #ddd", borderRadius: "8px", padding: "12px 14px", fontSize: "14px", fontFamily: "inherit", marginBottom: "16px", outline: "none", resize: "vertical", lineHeight: 1.6, color: "#333" }}
            />
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => { setShowImport(false); setImportText(""); setError(""); }}
                style={{ flex: 1, background: "#f1f3f4", border: "none", borderRadius: "8px", color: "#555", padding: "12px", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              <button onClick={handleImport} disabled={importLoading || !importText.trim()}
                style={{ flex: 2, background: importLoading || !importText.trim() ? "#ddd" : "#1565C0", color: importLoading || !importText.trim() ? "#aaa" : "white", border: "none", borderRadius: "8px", padding: "12px", fontSize: "14px", cursor: importLoading ? "default" : "pointer", fontFamily: "inherit" }}>
                {importLoading ? "Extracting tasks…" : "Extract Tasks →"}
              </button>
            </div>
            {error && <div style={{ fontSize: "13px", color: "#E53935", marginTop: "12px" }}>⚠ {error}</div>}
          </div>
        </div>
      )}

      {/* Task modal popout */}
      {selectedTask && <TaskModal task={selectedTask} apiKey={apiKey} onUpdate={updateTask} onClose={() => setSelectedTask(null)} />}

      {/* Voice orb */}
      {showVoice && <VoiceOrb apiKey={apiKey} voice={voice} tasks={tasks} onTasksUpdate={setTasks} onClose={() => setShowVoice(false)} />}

      {/* Settings */}
      {showSettings && <SettingsModal apiKey={apiKey} voice={voice} onVoiceChange={saveVoice} onKeyChange={saveKey} onClose={() => setShowSettings(false)} />}

      {/* Top bar */}
      <div style={{ background: "#1565C0", padding: "0 24px", display: "flex", alignItems: "center", gap: "16px", height: "56px", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}>
        <h1 style={{ color: "white", margin: 0, fontSize: "18px", fontWeight: "600", letterSpacing: "0.02em", flex: 1 }}>My Tasks</h1>
        {pendingCount > 0 && <span style={{ background: "rgba(255,255,255,0.2)", color: "white", fontSize: "12px", padding: "3px 10px", borderRadius: "12px" }}>{pendingCount} open</span>}
        <button onClick={() => setShowVoice(true)} title="Voice mode"
          style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "8px", color: "white", width: "36px", height: "36px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="white"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="white" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <button onClick={() => setShowSettings(true)} title="Settings"
          style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "8px", color: "white", width: "36px", height: "36px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>
          ⚙
        </button>
      </div>

      {/* Command bar */}
      <div style={{ background: "white", borderBottom: "1px solid #e0e0e0", padding: "12px 24px", display: "flex", gap: "10px", alignItems: "center" }}>
        <input value={command} onChange={e => setCommand(e.target.value)} onKeyDown={e => e.key === "Enter" && sendCommand()}
          placeholder='Type a command — e.g. "add review contract high priority by Monday" or "clear completed"'
          disabled={loading}
          style={{ flex: 1, border: "1px solid #ddd", borderRadius: "8px", padding: "9px 14px", fontSize: "14px", fontFamily: "inherit", outline: "none", color: "#333" }}
          onFocus={e => e.target.style.borderColor = "#1565C0"} onBlur={e => e.target.style.borderColor = "#ddd"}
        />
        <button onClick={sendCommand} disabled={loading || !command.trim()}
          style={{ background: loading ? "#ddd" : "#1565C0", color: loading ? "#aaa" : "white", border: "none", borderRadius: "8px", padding: "9px 20px", fontSize: "14px", cursor: loading ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "all 0.2s" }}>
          {loading ? "…" : "Go"}
        </button>
        <button onClick={() => setShowImport(true)}
          style={{ background: "#f1f3f4", border: "none", borderRadius: "8px", color: "#555", padding: "9px 16px", fontSize: "14px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
          ↓ Import
        </button>
      </div>

      {/* Status bar */}
      {(message || error) && (
        <div style={{ padding: "8px 24px", background: error ? "#FFEBEE" : "#E3F2FD", borderBottom: `1px solid ${error ? "#FFCDD2" : "#BBDEFB"}` }}>
          <span style={{ fontSize: "13px", color: error ? "#E53935" : "#1565C0" }}>{error ? `⚠ ${error}` : message}</span>
        </div>
      )}

      {/* Filter tabs */}
      {tasks.length > 0 && (
        <div style={{ padding: "16px 24px 0", display: "flex", gap: "4px" }}>
          {["all", "active", "done"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ background: filter === f ? "#1565C0" : "transparent", color: filter === f ? "white" : "#888", border: filter === f ? "none" : "1px solid #ddd", borderRadius: "20px", padding: "5px 16px", fontSize: "13px", cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize", transition: "all 0.2s" }}>
              {f === "all" ? `All (${tasks.length})` : f === "active" ? `Active (${pendingCount})` : `Done (${tasks.length - pendingCount})`}
            </button>
          ))}
        </div>
      )}

      {/* Tile grid */}
      <div style={{ padding: "20px 24px 40px" }}>
        {filteredTasks.length === 0 ? (
          <div style={{ textAlign: "center", color: "#bbb", fontSize: "15px", padding: "80px 0" }}>
            {tasks.length === 0 ? "No tasks yet. Type a command above or import a conversation." : "No tasks in this filter."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
            {filteredTasks.map((task, i) => (
              <TaskTile key={task.id} task={task} index={task.id} onOpen={setSelectedTask} onToggle={toggleDone} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
