/** Single-page browser UI served as a string. */
export const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Playground</title>
<style>
  :root { --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #e6edf3; --dim: #8b949e; --accent: #58a6ff; --green: #3fb950; --yellow: #d29922; --red: #f85149; --purple: #bc8cff; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; background: var(--bg); color: var(--text); min-height: 100vh; }

  .container { max-width: 900px; margin: 0 auto; padding: 24px; }

  h1 { font-size: 1.4em; margin-bottom: 4px; }
  .subtitle { color: var(--dim); font-size: 0.85em; margin-bottom: 24px; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .card h2 { font-size: 1em; margin-bottom: 12px; color: var(--accent); }

  label { display: block; font-size: 0.8em; color: var(--dim); margin-bottom: 4px; }
  input, select, textarea { width: 100%; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: inherit; font-size: 0.85em; }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }
  textarea { resize: vertical; min-height: 60px; }

  .row { display: flex; gap: 12px; margin-bottom: 12px; }
  .row > * { flex: 1; }

  button { padding: 10px 20px; border: none; border-radius: 6px; font-family: inherit; font-size: 0.85em; cursor: pointer; font-weight: 600; }
  .btn-primary { background: var(--accent); color: var(--bg); }
  .btn-primary:hover { opacity: 0.9; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-stop { background: var(--red); color: white; }

  #output { max-height: 70vh; overflow-y: auto; scroll-behavior: smooth; }
  .event { padding: 8px 12px; border-left: 3px solid var(--border); margin-bottom: 6px; font-size: 0.8em; border-radius: 0 4px 4px 0; background: rgba(255,255,255,0.02); }
  .event .label { font-weight: 600; font-size: 0.75em; text-transform: uppercase; margin-bottom: 2px; }
  .event .body { color: var(--dim); white-space: pre-wrap; word-break: break-word; }
  .event.perceive { border-color: var(--accent); }
  .event.perceive .label { color: var(--accent); }
  .event.reason { border-color: var(--purple); }
  .event.reason .label { color: var(--purple); }
  .event.plan { border-color: var(--yellow); }
  .event.plan .label { color: var(--yellow); }
  .event.act { border-color: var(--green); }
  .event.act .label { color: var(--green); }
  .event.reflect { border-color: #f778ba; }
  .event.reflect .label { color: #f778ba; }
  .event.status { border-color: var(--dim); }
  .event.status .label { color: var(--dim); }
  .event.memory { border-color: var(--yellow); }
  .event.memory .label { color: var(--yellow); }
  .event.error { border-color: var(--red); }
  .event.error .label { color: var(--red); }
  .event.done { border-color: var(--green); background: rgba(63,185,80,0.08); }
  .event.done .label { color: var(--green); }
  .agent-tag { display: inline-block; background: var(--border); padding: 1px 6px; border-radius: 3px; font-size: 0.75em; margin-left: 6px; }

  .demos { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .demo-btn { padding: 6px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: inherit; font-size: 0.8em; cursor: pointer; }
  .demo-btn:hover { border-color: var(--accent); }
  .demo-btn.active { border-color: var(--accent); background: rgba(88,166,255,0.1); }

  .timer { color: var(--dim); font-size: 0.8em; }
</style>
</head>
<body>
<div class="container">
  <h1>Agent Playground</h1>
  <p class="subtitle">Interactive LangGraph agent harness &mdash; watch perceive &rarr; reason &rarr; plan &rarr; act &rarr; reflect in real-time</p>

  <div class="card">
    <h2>Configuration</h2>
    <div class="row">
      <div>
        <label>Anthropic API Key</label>
        <input type="password" id="apiKey" placeholder="sk-ant-..." />
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Demos</h2>
    <div class="demos" id="demos">
      <button class="demo-btn active" data-id="math" data-mode="single">Math Solver</button>
      <button class="demo-btn" data-id="research" data-mode="multi">Research Team (3 agents)</button>
      <button class="demo-btn" data-id="custom" data-mode="single">Custom Goal</button>
    </div>
    <div>
      <label>Goal</label>
      <textarea id="goal" rows="2">A store sells apples for $3 each. Alice buys 7 apples and Bob buys 5 apples. How much did they spend in total?</textarea>
    </div>
    <div style="margin-top:12px; display:flex; gap:8px; align-items:center;">
      <button class="btn-primary" id="runBtn" onclick="run()">Run Agent</button>
      <button class="btn-stop" id="stopBtn" onclick="stop()" style="display:none;">Stop</button>
      <span class="timer" id="timer"></span>
    </div>
  </div>

  <div class="card" id="outputCard" style="display:none;">
    <h2>Execution <span id="statusBadge" style="font-weight:400; font-size:0.85em;"></span></h2>
    <div id="output"></div>
  </div>
</div>

<script>
const goals = {
  math: "A store sells apples for $3 each. Alice buys 7 apples and Bob buys 5 apples. How much did they spend in total?",
  research: "AI-driven automation in healthcare",
  custom: "",
};

let selectedDemo = "math";
let eventSource = null;
let startTime = null;
let timerInterval = null;

document.querySelectorAll('.demo-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.demo-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDemo = btn.dataset.id;
    const g = goals[selectedDemo];
    document.getElementById('goal').value = g;
    if (selectedDemo === 'custom') document.getElementById('goal').focus();
  });
});

function addEvent(type, html, agentName) {
  const out = document.getElementById('output');
  const div = document.createElement('div');
  div.className = 'event ' + type;
  const agentTag = agentName ? '<span class="agent-tag">' + agentName + '</span>' : '';
  div.innerHTML = '<div class="label">' + type + agentTag + '</div><div class="body">' + html + '</div>';
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const s = ((Date.now() - startTime) / 1000).toFixed(1);
    document.getElementById('timer').textContent = s + 's';
  }, 100);
}
function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
}

function run() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const goal = document.getElementById('goal').value.trim();
  if (!apiKey) { alert('Please enter your Anthropic API key.'); return; }
  if (!goal) { alert('Please enter a goal.'); return; }

  document.getElementById('output').innerHTML = '';
  document.getElementById('outputCard').style.display = '';
  document.getElementById('runBtn').disabled = true;
  document.getElementById('stopBtn').style.display = '';
  document.getElementById('statusBadge').textContent = '(running...)';
  startTimer();

  eventSource = new EventSource('/api/run?' + new URLSearchParams({
    // We'll use POST via fetch + ReadableStream instead for the body
  }));
  // EventSource only does GET, so use fetch with streaming
  eventSource = null;

  fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, demoId: selectedDemo, goal }),
  }).then(response => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    function pump() {
      return reader.read().then(({ done, value }) => {
        if (done) {
          onDone();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\\n');
        buffer = lines.pop() || '';
        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              handleEvent(eventType, data);
            } catch {}
          }
        }
        return pump();
      });
    }
    pump().catch(err => {
      addEvent('error', escHtml(err.message));
      onDone();
    });
  }).catch(err => {
    addEvent('error', escHtml(err.message));
    onDone();
  });
}

function stop() {
  // We can't abort fetch easily, but we can close the UI
  onDone();
}

function onDone() {
  document.getElementById('runBtn').disabled = false;
  document.getElementById('stopBtn').style.display = 'none';
  document.getElementById('statusBadge').textContent = '(complete)';
  stopTimer();
}

function handleEvent(type, data) {
  const agent = data.agent || '';
  switch (type) {
    case 'step': {
      const node = data.node;
      const d = data.details || {};
      let body = '';
      if (node === 'perceive') body = escHtml(d.perception || '');
      else if (node === 'reason') body = escHtml(d.reasoning || '');
      else if (node === 'plan') body = 'Tasks planned';
      else if (node === 'act') {
        body = 'Task: ' + escHtml(d.task || 'n/a');
        if (d.result) body += '\\nResult: ' + escHtml(JSON.stringify(d.result).slice(0, 300));
      }
      else if (node === 'reflect') {
        body = escHtml(d.reflection || '');
        if (d.output) body += '\\n\\nOutput: ' + escHtml(d.output);
      }
      else if (node === 'escalate') body = 'Escalated: ' + escHtml(d.output || '');
      addEvent(node, body, agent);
      break;
    }
    case 'status':
      addEvent('status', escHtml(data.phase) + (data.agent ? ' (' + escHtml(data.agent) + ')' : '') + (data.taskStats ? ' ' + JSON.stringify(data.taskStats) : ''));
      break;
    case 'memory':
      const eps = (data.episodes || []).map(e => '  ' + escHtml(e.action) + ' -> ' + escHtml(e.outcome) + ' (reward: ' + e.reward + ')').join('\\n');
      addEvent('memory', (data.agent ? '' : '') + 'Episodes learned:\\n' + eps, data.agent);
      break;
    case 'error':
      addEvent('error', escHtml(data.error));
      break;
    case 'done':
      addEvent('done', 'Pipeline complete.');
      onDone();
      break;
  }
}
</script>
</body>
</html>`;
