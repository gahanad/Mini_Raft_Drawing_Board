# MINI_RAFT Project Workflow Report

## 1. Project Overview

MINI_RAFT is a real-time collaborative drawing board built with a browser frontend, a WebSocket gateway, and three backend replica nodes. The goal of the project is to keep drawing available even when one replica fails. The replicas use a Raft-style leader election and majority replication approach.

The system has these main parts:

- Frontend: captures drawing input and renders strokes on the canvas.
- Gateway: accepts WebSocket messages from browsers, queues drawing strokes, sends them to the current Raft leader, and broadcasts committed strokes back to connected clients.
- Replica nodes: run the same `server.js` file. Each node can be follower, candidate, or leader.
- Docker Compose: starts three replicas and one gateway on a shared Docker network.

The cluster has three replicas. A majority is two nodes. Therefore, if one node dies, the remaining two nodes can still elect a leader and commit new drawing strokes.

## 2. Runtime Architecture

The runtime flow is:

Browser -> Gateway WebSocket -> Raft Leader -> Followers -> Gateway -> Browsers

The important ports are:

- Gateway: port 8080
- Replica 1: port 5001
- Replica 2: port 5002
- Replica 3: port 5003

In Docker Compose, each replica receives:

- `PORT`: the port it listens on.
- `SELF_ID`: its identity, such as `replica1`.
- `REPLICAS`: the URLs of the other replica nodes.

All three replicas use the same code. The environment variables decide which node each container becomes.

## 3. Frontend Startup

The frontend page loads these scripts:

- `frontend/js/canvas.js`
- `frontend/js/draw.js`
- `frontend/js/websocket.js`
- `frontend/script.js`

The HTML file creates the toolbar and the canvas:

```html
<canvas id="board"></canvas>
```

The JavaScript files then attach behavior to that canvas.

## 4. `canvas.js` Explanation

The `canvas.js` file prepares the drawing area.

```js
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
```

This gets the canvas element and its 2D drawing context. All actual line drawing happens through `ctx`.

The function:

```js
function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}
```

sets the internal canvas size to match its visible size on the page. This is important because mouse positions must match drawing coordinates.

The function:

```js
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}
```

converts the browser mouse position into canvas coordinates. Without this, drawing could appear shifted or scaled incorrectly.

At the end, the file exposes useful objects globally:

```js
window.canvas = canvas;
window.ctx = ctx;
window.getMousePos = getMousePos;
```

This allows `draw.js` to use the canvas, context, and mouse position helper.

## 5. `draw.js` Explanation

The `draw.js` file handles actual drawing.

It begins with drawing state:

```js
window.currentColor = "#000000";
window.brushSize = 3;
window.isEraser = false;
```

These values store the selected color, brush size, and eraser mode.

The main drawing function is:

```js
window.drawLine = function (data) {
    ctx.beginPath();
    ctx.moveTo(data.x1, data.y1);
    ctx.lineTo(data.x2, data.y2);
    ctx.strokeStyle = data.color || "#000000";
    ctx.lineWidth = data.size || 3;
    ctx.lineCap = "round";
    ctx.stroke();
};
```

This draws one line segment between two points. Every stroke sent through the system contains:

- `x1`, `y1`: starting point
- `x2`, `y2`: ending point
- `color`: stroke color
- `size`: brush size
- `type`: usually `draw`

The redraw function is:

```js
window.redrawAll = function (log) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    log.forEach(entry => {
        if (entry.type === "draw") {
            window.drawLine(entry);
        }
    });
};
```

When a new browser connects, gateway sends the stored canvas log. `redrawAll` clears the board and draws every saved stroke again.

Mouse drawing starts here:

```js
canvas.addEventListener("mousedown", (e) => {
    drawing = true;
    const pos = getMousePos(e);
    lastX = pos.x;
    lastY = pos.y;
});
```

When the user presses the mouse, drawing mode begins and the current mouse point becomes the starting point.

On mouse movement:

```js
canvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;
```

the file checks whether the user is currently drawing. If not, nothing happens.

The throttle:

```js
const now = Date.now();
if (now - lastSendTime < 16) return;
lastSendTime = now;
```

prevents the browser from sending too many strokes per second. This was important because too many mousemove messages can overload the gateway and replicas during failover.

Then a stroke object is created:

```js
const data = {
    type: "draw",
    x1: lastX, y1: lastY,
    x2: currentX, y2: currentY,
    color,
    size
};
```

The line is drawn locally immediately:

```js
window.drawLine(data);
```

Then it is sent to the gateway:

```js
if (window.socket && window.socket.readyState === WebSocket.OPEN) {
    window.socket.send(JSON.stringify(data));
}
```

So the local browser draws instantly, and the network sends the same stroke for replication.

## 6. `websocket.js` Explanation

The WebSocket file connects the browser to the gateway:

```js
socket = new WebSocket("ws://localhost:8080");
window.socket = socket;
```

The global `window.socket` is important because `draw.js` uses it to send drawing data.

When the socket opens:

```js
socket.onopen = () => {
    console.log("Connected to gateway");
    setStatus(true);
};
```

the UI status becomes online.

When the browser receives an initialization message:

```js
if (msg.type === "init") {
    window.redrawAll(msg.data || []);
    return;
}
```

it redraws all saved strokes. This is how a newly opened browser gets the current canvas.

When the browser receives a drawing message:

```js
if (msg.type === "draw") {
    window.drawLine(msg);
    return;
}
```

it draws the committed stroke from the gateway.

If the socket closes:

```js
setTimeout(() => {
    connectSocket();
}, 1500);
```

the browser reconnects automatically.

## 7. Gateway Role

The gateway is the bridge between browser clients and Raft replicas. It uses:

- Express HTTP server
- WebSocket server
- Axios for HTTP calls to replicas

The gateway knows all replicas from:

```js
const REPLICAS = process.env.REPLICAS ? process.env.REPLICAS.split(",") : [];
```

It stores:

```js
let cachedLeader = null;
let canvasLog = [];
let writeQueue = [];
let queueRunning = false;
let deadUntil = {};
```

`cachedLeader` remembers the last known leader. `canvasLog` stores committed strokes at the gateway level. `writeQueue` ensures strokes are sent one by one instead of all at the same time. `deadUntil` temporarily skips replicas that recently failed.

## 8. Why Gateway Queue Was Needed

Drawing produces many mousemove events. Without a queue, every event starts its own retry loop. During leader failure, that caused a request storm:

```text
stroke 1 -> retry replicas
stroke 2 -> retry replicas
stroke 3 -> retry replicas
...
```

This flooded the dead leader and also overloaded the surviving replicas. The symptoms were:

- repeated `ECONNABORTED`
- gateway stuck trying the old leader
- new leader elected but drawing not replicated

The solution is:

```js
function enqueueStroke(stroke) {
    writeQueue.push(stroke);
    if (writeQueue.length > 300) {
        writeQueue = writeQueue.slice(writeQueue.length - 300);
    }
    runQueue();
}
```

This stores strokes in a queue. It also prevents unlimited memory growth by keeping only the latest 300 pending strokes.

The queue worker is:

```js
async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    while (writeQueue.length > 0) {
        const stroke = writeQueue.shift();
        const result = await submitToCluster(stroke);
        ...
    }
    queueRunning = false;
}
```

Only one queue worker runs at a time. This means the gateway commits one stroke, broadcasts it, then moves to the next stroke.

This was the final fix that made failover work correctly.

## 9. Gateway Write Flow

When a browser sends a draw message, gateway receives it here:

```js
ws.on("message", (message) => {
    let stroke = normalizeStroke(JSON.parse(message));
    if (stroke.type !== "draw") return;
    enqueueStroke(stroke);
});
```

The stroke is not sent immediately. It is added to the queue.

The queue calls:

```js
const result = await submitToCluster(stroke);
```

`submitToCluster` repeatedly tries to write until success or retry limit.

The actual write attempt is:

```js
const res = await axios.post(`${url}/client-write`, { stroke }, {
    timeout: 8000,
    proxy: false
});
```

If the contacted replica is not leader, it returns a leader URL. Gateway stores it:

```js
cachedLeader = err.response.data.leaderUrl;
```

If write succeeds, gateway stores and broadcasts the stroke:

```js
canvasLog.push(result.stroke);
broadcast({ type: "status", online: true });
broadcast(result.stroke);
```

This sends the committed drawing to all connected browsers.

## 10. Replica Server State

Each replica keeps Raft state:

```js
let state = "follower";
let currentTerm = 0;
let votedFor = null;
let leaderId = null;
```

`state` can be:

- follower
- candidate
- leader

`currentTerm` is the current Raft term. `votedFor` stores which candidate got this node's vote in the current term. `leaderId` stores the known leader.

Each replica also keeps log state:

```js
let log = [];
let commitIndex = 0;
let appliedStrokes = [];
```

`log` stores Raft log entries. Each entry contains term, index, and stroke. `commitIndex` says how many entries are committed. `appliedStrokes` contains strokes that are safe to show in the canvas.

## 11. Raft Majority

The cluster size is:

```js
const CLUSTER_SIZE = REPLICAS.length + 1;
const MAJORITY = Math.floor(CLUSTER_SIZE / 2) + 1;
```

With three replicas:

```text
MAJORITY = floor(3 / 2) + 1 = 2
```

So the system can continue if one replica fails. Any operation needs two acknowledgements: the leader itself plus at least one follower.

## 12. Leader Election

Each follower has a randomized election timer:

```js
const ELECTION_MIN_MS = 10000;
const ELECTION_MAX_MS = 16000;
```

The timer is randomized so all nodes do not start elections at the same moment.

When timeout happens:

```js
if (state !== "leader") {
    startElection();
}
```

The node becomes candidate:

```js
state = "candidate";
currentTerm += 1;
votedFor = SELF_ID;
leaderId = null;
```

Then it asks other replicas for votes:

```js
postToPeer(peer, "/requestVote", {
    term: electionTerm,
    candidateId: SELF_ID,
    lastLogIndex: lastLogIndex(),
    lastLogTerm: lastLogTerm()
});
```

If it receives majority votes:

```js
if (votes >= MAJORITY) {
    becomeLeader();
}
```

it becomes leader.

## 13. `/requestVote` Logic

The `/requestVote` endpoint receives vote requests from candidates.

If the candidate term is old:

```js
if (term < currentTerm) {
    return res.json({ term: currentTerm, voteGranted: false });
}
```

the vote is rejected.

If the candidate term is newer:

```js
if (term > currentTerm) {
    becomeFollower(term);
}
```

the node updates its term and becomes follower.

Then it checks whether it can vote:

```js
const canVote = votedFor === null || votedFor === candidateId;
const logOk = isCandidateLogOk(candidateLastIndex, candidateLastTerm);
```

If both are true, it grants the vote:

```js
votedFor = candidateId;
resetElectionTimer();
return res.json({ term: currentTerm, voteGranted: true });
```

This is Raft's election safety rule: a node votes only once per term.

## 14. Becoming Leader

When a candidate wins:

```js
function becomeLeader() {
    state = "leader";
    leaderId = SELF_ID;
    votedFor = SELF_ID;
    sendHeartbeats();
    heartbeatTimer = setInterval(sendHeartbeats, HEARTBEAT_MS);
}
```

The leader sends heartbeats to followers using `AppendEntries` with no entries. Heartbeats tell followers that the leader is alive.

## 15. AppendEntries and Heartbeats

Raft uses `AppendEntries` for both heartbeat and replication.

The leader sends:

```js
sendAppendEntries(peer, []);
```

for heartbeat, and:

```js
sendAppendEntries(peer, [entry]);
```

for actual drawing replication.

The follower endpoint is:

```js
app.post("/appendEntries", (req, res) => {
    ...
});
```

If the leader term is old, the follower rejects it:

```js
if (term < currentTerm) {
    return res.json({ term: currentTerm, success: false });
}
```

Otherwise it accepts the leader:

```js
becomeFollower(term, incomingLeaderId);
```

and merges any new entries:

```js
mergeEntries(entries);
```

If the leader says entries are committed:

```js
commitIndex = Math.min(leaderCommit, log.length);
applyCommittedEntries();
```

the follower applies them to the drawing state.

## 16. Client Write on Leader

Gateway sends drawing strokes to:

```text
POST /client-write
```

Only the leader accepts writes:

```js
if (state !== "leader") {
    return res.status(403).json({
        success: false,
        leaderId,
        leaderUrl: urlForNode(leaderId)
    });
}
```

If a follower receives a write, it rejects it and tells gateway who the leader is.

If the node is leader, it creates a log entry:

```js
const entry = {
    index: log.length + 1,
    term: currentTerm,
    stroke
};
```

Then it pushes the entry into its own log:

```js
log.push(entry);
```

and replicates it:

```js
const committed = await replicateToMajority(entry);
```

## 17. Replication to Majority

Replication uses:

```js
function replicateToMajority(entry) {
    ...
}
```

The leader counts itself as one acknowledgement:

```js
let acks = 1;
```

Then it sends the entry to followers:

```js
sendAppendEntries(peer, [entry])
```

If one follower accepts, acknowledgements become two. Since majority is two, the entry is committed.

When committed:

```js
commitIndex = entry.index;
applyCommittedEntries();
sendHeartbeats();
```

Then the leader replies success to gateway:

```js
res.json({
    success: true,
    leaderId: SELF_ID,
    leaderUrl: urlForNode(SELF_ID),
    stroke
});
```

## 18. Dead Peer Backoff

When a replica is down, repeated calls to it waste time. The code marks failed peers:

```js
function markPeerDown(peer) {
    peerDownUntil[peer] = Date.now() + DEAD_PEER_BACKOFF_MS;
}
```

Before contacting a peer:

```js
if (isPeerSkipped(peer)) {
    return null;
}
```

This prevents the leader from continuously trying a dead node. It keeps the remaining two nodes responsive.

## 19. Failure Scenario

Normal state:

```text
replica2 is leader
replica1 is follower
replica3 is follower
```

User draws. Gateway sends stroke to replica2. Replica2 writes locally and replicates to followers:

```text
replica2 + replica1 + replica3 = 3/3
```

Then replica2 dies.

Followers stop receiving heartbeat. After randomized timeout, one follower starts election:

```text
replica1 started election
replica3 voted for replica1
replica1 became leader
```

Now user draws again. Gateway eventually sends stroke to replica1. Replica1 commits with:

```text
replica1 + replica3 = 2/3 majority
```

So drawing continues even though replica2 is dead.

## 20. Main Bug Found During Development

The original issue was not only the election algorithm. There were two major mistakes:

1. The active code used ring election instead of Raft.
2. The gateway sent too many parallel retry loops during drawing.

The second issue was the most painful. Mouse movement creates many strokes. If each stroke retries all replicas independently during leader failure, the gateway floods the cluster. This caused:

- timeouts
- leader changes
- failed state sync
- drawing freeze

The final solution was:

- Raft-style majority leader election
- Raft-style majority write replication
- dead-peer backoff
- gateway write queue
- frontend mousemove throttle

## 21. Final End-to-End Workflow

1. Docker starts gateway and three replicas.
2. Each replica starts as follower.
3. If no heartbeat is received, a replica starts election.
4. Candidate increments term and sends `/requestVote`.
5. If it gets two votes, it becomes leader.
6. Leader sends heartbeat using `/appendEntries`.
7. Browser connects to gateway using WebSocket.
8. Gateway sends current `canvasLog` as `init`.
9. User presses mouse on canvas.
10. `draw.js` records starting position.
11. User moves mouse.
12. `draw.js` creates a `draw` stroke object.
13. Browser draws it locally.
14. Browser sends stroke through WebSocket.
15. Gateway receives stroke.
16. Gateway adds stroke to `writeQueue`.
17. Queue sends one stroke at a time to the known leader.
18. If target is not leader, gateway uses returned leader URL.
19. Leader creates a Raft log entry.
20. Leader replicates entry using `/appendEntries`.
21. Once majority acknowledges, leader commits the entry.
22. Leader replies success to gateway.
23. Gateway saves stroke in `canvasLog`.
24. Gateway broadcasts the committed stroke to all browsers.
25. Other browsers draw the same stroke.

## 22. Why the System Works with One Failed Node

The cluster has three replicas, so majority is two. If one replica fails, two replicas are still alive. Raft can still elect a leader because the candidate votes for itself and receives one more vote.

For writes, the leader counts itself as one acknowledgement. If one follower accepts the entry, majority is reached:

```text
leader ack + follower ack = 2/3 majority
```

That is why drawing continues after one node failure.

## 23. Important Demo Logs

Successful normal write:

```text
replica2 write acks: majority
```

Leader failure:

```text
replica2 exited with code 137
```

New leader election:

```text
replica1 started election for term 2
replica3 voted for replica1 in term 2
replica1 became LEADER for term 2
```

Successful write after failover:

```text
replica1 write acks: majority
```

These logs prove that failover and majority replication are working.

## 24. Conclusion

The final system implements a practical Raft-style replicated drawing application. The frontend captures strokes and sends them through WebSocket. The gateway serializes writes with a queue and routes them to the current leader. The replicas elect a leader using terms and votes, then replicate drawing entries using majority acknowledgement.

The key improvement was the gateway queue. Without it, drawing generated too many parallel retries during failover and overloaded the replicas. With queueing, dead-peer backoff, majority voting, and majority replication, the app continues working even after one replica fails.

