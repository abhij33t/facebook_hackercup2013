export const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SuperAgent</title>
<style>
  :root { --bg: #0a0a0f; --surface: #12121a; --surface2: #1a1a26; --border: #2a2a3a; --text: #e4e4ef; --dim: #7a7a8e; --accent: #6c5ce7; --accent2: #a29bfe; --green: #00b894; --yellow: #fdcb6e; --red: #ff6b6b; --blue: #74b9ff; --pink: #fd79a8; --cyan: #81ecec; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

  .container { max-width: 960px; margin: 0 auto; padding: 32px 24px; }

  .header { text-align: center; margin-bottom: 32px; }
  .header h1 { font-size: 2em; font-weight: 800; background: linear-gradient(135deg, var(--accent), var(--accent2), var(--cyan)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 6px; }
  .header p { color: var(--dim); font-size: 0.9em; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }

  label { display: block; font-size: 0.75em; color: var(--dim); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  input, textarea { width: 100%; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: inherit; font-size: 0.9em; transition: border 0.2s; }
  input:focus, textarea:focus { outline: none; border-color: var(--accent); }
  textarea { resize: vertical; min-height: 80px; line-height: 1.5; }

  .suggestions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
  .suggestion { padding: 5px 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: 20px; color: var(--dim); font-size: 0.75em; cursor: pointer; transition: all 0.2s; }
  .suggestion:hover { border-color: var(--accent); color: var(--text); }

  .actions { display: flex; gap: 10px; align-items: center; margin-top: 16px; }
  button { padding: 10px 24px; border: none; border-radius: 8px; font-family: inherit; font-size: 0.9em; cursor: pointer; font-weight: 600; transition: all 0.15s; }
  .btn-run { background: linear-gradient(135deg, var(--accent), #845ef7); color: white; }
  .btn-run:hover { opacity: 0.9; transform: translateY(-1px); }
  .btn-run:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }
  .btn-stop { background: var(--red); color: white; }
  .timer { color: var(--dim); font-size: 0.85em; font-variant-numeric: tabular-nums; }

  #outputCard { display: none; }
  .phase-bar { display: flex; gap: 4px; margin-bottom: 16px; }
  .phase-dot { flex: 1; height: 4px; background: var(--border); border-radius: 2px; transition: background 0.3s; }
  .phase-dot.active { background: var(--accent); }
  .phase-dot.done { background: var(--green); }

  #output { max-height: 65vh; overflow-y: auto; scroll-behavior: smooth; padding-right: 4px; }
  #output::-webkit-scrollbar { width: 4px; }
  #output::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .evt { padding: 10px 14px; margin-bottom: 6px; border-radius: 8px; font-size: 0.82em; line-height: 1.5; background: var(--surface2); border-left: 3px solid var(--border); }
  .evt .tag { font-weight: 700; font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; display: flex; align-items: center; gap: 6px; }
  .evt .agent-badge { background: var(--border); padding: 1px 7px; border-radius: 10px; font-weight: 500; font-size: 0.9em; }
  .evt .body { color: var(--dim); white-space: pre-wrap; word-break: break-word; }

  .evt.decompose { border-color: var(--blue); }
  .evt.decompose .tag { color: var(--blue); }
  .evt.plan { border-color: var(--yellow); }
  .evt.plan .tag { color: var(--yellow); }
  .evt.assemble { border-color: var(--cyan); }
  .evt.assemble .tag { color: var(--cyan); }
  .evt.execute { border-color: var(--accent2); }
  .evt.execute .tag { color: var(--accent2); }
  .evt.synthesize { border-color: var(--pink); }
  .evt.synthesize .tag { color: var(--pink); }
  .evt.reflect { border-color: var(--yellow); }
  .evt.reflect .tag { color: var(--yellow); }
  .evt.complete { border-color: var(--green); background: rgba(0,184,148,0.06); }
  .evt.complete .tag { color: var(--green); }
  .evt.error { border-color: var(--red); background: rgba(255,107,107,0.06); }
  .evt.error .tag { color: var(--red); }

  .node-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 0.85em; font-weight: 600; }
  .node-perceive { background: rgba(116,185,255,0.15); color: var(--blue); }
  .node-reason { background: rgba(162,155,254,0.15); color: var(--accent2); }
  .node-plan { background: rgba(253,203,110,0.15); color: var(--yellow); }
  .node-act { background: rgba(0,184,148,0.15); color: var(--green); }
  .node-reflect { background: rgba(253,121,168,0.15); color: var(--pink); }

  .answer-box { background: var(--surface); border: 1px solid var(--green); border-radius: 10px; padding: 16px; margin-top: 12px; }
  .answer-box h3 { color: var(--green); font-size: 0.85em; margin-bottom: 8px; }
  .answer-box .content { white-space: pre-wrap; line-height: 1.6; font-size: 0.9em; }

  .key-row { display: flex; gap: 10px; }
  .key-row input { flex: 1; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>SuperAgent</h1>
    <p>Describe any problem. It will analyze, create specialist agents, execute, and synthesize an answer.</p>
  </div>

  <div class="card">
    <div class="key-row">
      <div style="flex:1">
        <label>API Key</label>
        <input type="password" id="apiKey" placeholder="sk-ant-..." />
      </div>
    </div>
  </div>

  <div class="card">
    <label>What do you want solved?</label>
    <textarea id="goal" placeholder="Describe any problem, question, or task..."></textarea>
    <div class="suggestions">
      <span class="suggestion" data-g="Compare React, Vue, and Svelte for building a large-scale enterprise dashboard. Consider performance, developer experience, and ecosystem.">Tech comparison</span>
      <span class="suggestion" data-g="A farmer has 120 meters of fencing. What dimensions should a rectangular pen have to maximize the enclosed area? Prove your answer.">Math proof</span>
      <span class="suggestion" data-g="Research the current state of quantum computing and write a briefing document for a non-technical executive audience.">Research report</span>
      <span class="suggestion" data-g="Design a microservices architecture for an e-commerce platform that handles 10,000 orders per minute. Include service boundaries, data flow, and failure modes.">System design</span>
      <span class="suggestion" data-g="Analyze the pros and cons of remote work vs office work. Consider productivity, culture, costs, and employee wellbeing. Produce a recommendation for a 200-person startup.">Business analysis</span>
    </div>
    <div class="actions">
      <button class="btn-run" id="runBtn" onclick="run()">Solve</button>
      <button class="btn-stop" id="stopBtn" onclick="stop()" style="display:none">Stop</button>
      <span class="timer" id="timer"></span>
    </div>
  </div>

  <div class="card" id="outputCard">
    <div class="phase-bar">
      <div class="phase-dot" id="ph-decompose" title="Decompose"></div>
      <div class="phase-dot" id="ph-assemble" title="Assemble"></div>
      <div class="phase-dot" id="ph-execute" title="Execute"></div>
      <div class="phase-dot" id="ph-synthesize" title="Synthesize"></div>
      <div class="phase-dot" id="ph-complete" title="Complete"></div>
    </div>
    <div id="output"></div>
    <div id="answerBox" class="answer-box" style="display:none">
      <h3>Final Answer</h3>
      <div class="content" id="answerContent"></div>
    </div>
  </div>
</div>

<script>
document.querySelectorAll('.suggestion').forEach(el => {
  el.addEventListener('click', () => {
    document.getElementById('goal').value = el.dataset.g;
  });
});

let timerInterval = null;
let startTime = null;

function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    document.getElementById('timer').textContent = ((Date.now()-startTime)/1000).toFixed(1)+'s';
  }, 100);
}
function stopTimer() { if (timerInterval) clearInterval(timerInterval); }

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function addEvt(cls, tag, body, agentName) {
  const out = document.getElementById('output');
  const d = document.createElement('div');
  d.className = 'evt ' + cls;
  const badge = agentName ? '<span class="agent-badge">'+esc(agentName)+'</span>' : '';
  d.innerHTML = '<div class="tag">'+tag+' '+badge+'</div><div class="body">'+body+'</div>';
  out.appendChild(d);
  out.scrollTop = out.scrollHeight;
}

function setPhase(name) {
  const phases = ['decompose','assemble','execute','synthesize','complete'];
  const idx = phases.indexOf(name);
  phases.forEach((p,i) => {
    const el = document.getElementById('ph-'+p);
    if (i < idx) el.className = 'phase-dot done';
    else if (i === idx) el.className = 'phase-dot active';
    else el.className = 'phase-dot';
  });
}

function run() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const goal = document.getElementById('goal').value.trim();
  if (!apiKey) { alert('Enter your Anthropic API key'); return; }
  if (!goal) { alert('Enter a problem to solve'); return; }

  document.getElementById('output').innerHTML = '';
  document.getElementById('answerBox').style.display = 'none';
  document.getElementById('outputCard').style.display = '';
  document.getElementById('runBtn').disabled = true;
  document.getElementById('stopBtn').style.display = '';
  document.querySelectorAll('.phase-dot').forEach(d => d.className = 'phase-dot');
  startTimer();

  fetch('/api/solve', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ apiKey, goal }),
  }).then(response => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    function pump() {
      return reader.read().then(({done,value}) => {
        if (done) { onDone(); return; }
        buf += decoder.decode(value, {stream:true});
        const lines = buf.split('\\n');
        buf = lines.pop() || '';
        let evtType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) evtType = line.slice(7);
          else if (line.startsWith('data: ')) {
            try { handleSSE(evtType, JSON.parse(line.slice(6))); } catch {}
          }
        }
        return pump();
      });
    }
    pump().catch(e => { addEvt('error','ERROR',esc(e.message)); onDone(); });
  }).catch(e => { addEvt('error','ERROR',esc(e.message)); onDone(); });
}

function stop() { onDone(); }
function onDone() {
  document.getElementById('runBtn').disabled = false;
  document.getElementById('stopBtn').style.display = 'none';
  stopTimer();
}

function handleSSE(type, data) {
  switch(type) {
    case 'decompose':
      setPhase('decompose');
      addEvt('decompose', 'DECOMPOSE', esc(typeof data === 'string' ? data : JSON.stringify(data)));
      break;

    case 'plan': {
      const p = data;
      let body = esc(p.analysis) + '\\n\\nAgents to create:\\n';
      (p.agents||[]).forEach(a => {
        body += '  \\u2022 '+esc(a.name)+' ('+esc(a.role)+') \\u2014 tools: '+esc((a.tools||[]).join(', ')||'none');
        if (a.dependsOn && a.dependsOn.length) body += ' \\u2014 depends on: '+esc(a.dependsOn.join(', '));
        body += '\\n';
      });
      body += '\\nSynthesis: '+esc(p.synthesisStrategy);
      addEvt('plan', 'PLAN', body);
      break;
    }

    case 'assemble':
      setPhase('assemble');
      addEvt('assemble', 'ASSEMBLE', 'Creating '+esc(data.agentName)+'\\nTools: '+esc(data.tools.join(', ')||'none')+'\\nPersona: '+esc(data.persona));
      break;

    case 'execute': {
      setPhase('execute');
      const d = data;
      if (d.status === 'starting') {
        addEvt('execute', 'EXECUTE', 'Starting agent...', d.agentName);
      } else if (d.status === 'step' && d.node) {
        const nodeData = d.data || {};
        let body = '';
        if (d.node === 'perceive') body = nodeData.perception || '';
        else if (d.node === 'reason') body = nodeData.reasoning || '';
        else if (d.node === 'plan') body = 'Tasks planned';
        else if (d.node === 'act') {
          body = 'Task: '+(nodeData.task||'n/a');
          if (nodeData.result) body += '\\nResult: '+JSON.stringify(nodeData.result).slice(0,300);
        }
        else if (d.node === 'reflect') {
          body = nodeData.reflection || '';
          if (nodeData.output) body += '\\n\\nOutput: '+nodeData.output;
        }
        const badge = '<span class="node-badge node-'+d.node+'">'+d.node+'</span> ';
        const out = document.getElementById('output');
        const el = document.createElement('div');
        el.className = 'evt execute';
        el.innerHTML = '<div class="tag">'+badge+'<span class="agent-badge">'+esc(d.agentName)+'</span></div><div class="body">'+esc(body)+'</div>';
        out.appendChild(el);
        out.scrollTop = out.scrollHeight;
      } else if (d.status === 'done') {
        addEvt('execute', 'AGENT DONE', 'Completed', d.agentName);
      }
      break;
    }

    case 'synthesize':
      setPhase('synthesize');
      addEvt('synthesize', 'SYNTHESIZE', esc(typeof data === 'string' ? data : JSON.stringify(data)));
      break;

    case 'reflect':
      addEvt('reflect', 'REFLECT', esc(data.assessment)+(data.needsMoreAgents ? '\\n\\u26a0 Creating additional agents...' : ''));
      break;

    case 'complete':
      setPhase('complete');
      addEvt('complete', 'COMPLETE', 'Agents created: '+data.agentsCreated+' | Total steps: '+data.totalSteps);
      document.getElementById('answerBox').style.display = '';
      document.getElementById('answerContent').textContent = data.answer;
      onDone();
      break;

    case 'error':
      addEvt('error', 'ERROR', esc(typeof data === 'string' ? data : data.error || JSON.stringify(data)));
      break;

    case 'done':
      onDone();
      break;
  }
}
</script>
</body>
</html>`;
