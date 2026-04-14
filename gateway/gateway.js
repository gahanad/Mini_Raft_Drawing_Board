const express = require("express");
const axios = require("axios");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");


const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
// For running gateway at the same time as frontend
app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
});


const PORT = parseInt(process.env.PORT || "8080", 10);
const REPLICAS = process.env.REPLICAS ? process.env.REPLICAS.split(",") : [];

let cachedLeader = null;
let canvasLog = [];
let writeQueue = [];
let queueRunning = false;
let deadUntil = {};

function broadcast(message) {
    const payload = JSON.stringify(message);

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

function normalizeStroke(stroke) {
    if (stroke && stroke.type) return stroke;
    return { type: "draw", ...stroke };
}

function markDead(url) {
    deadUntil[url] = Date.now() + 5000;

    if (cachedLeader === url) {
        cachedLeader = null;
    }
}

function isDead(url) {
    return deadUntil[url] && Date.now() < deadUntil[url];
}

function getTargets() {
    const targets = [];

    if (cachedLeader && !isDead(cachedLeader)) {
        targets.push(cachedLeader);
    }

    for (const replica of REPLICAS) {
        if (!targets.includes(replica) && !isDead(replica)) {
            targets.push(replica);
        }
    }

    for (const replica of REPLICAS) {
        if (!targets.includes(replica)) {
            targets.push(replica);
        }
    }

    return targets;
}

async function fetchStateFromAnyReplica() {
    for (const url of getTargets()) {
        try {
            const res = await axios.get(`${url}/getState`, {
                timeout: 3000,
                proxy: false
            });

            if (res.data.leaderUrl) {
                cachedLeader = res.data.leaderUrl;
            }

            if (Array.isArray(res.data.log) && res.data.log.length > canvasLog.length) {
                canvasLog = res.data.log;
            }

            console.log(`Gateway synced from ${url}`);
            return;
        } catch (err) {
            markDead(url);
        }
    }
}

async function sendStrokeOnce(stroke) {
    for (const url of getTargets()) {
        try {
            const res = await axios.post(`${url}/client-write`, {
                stroke
            }, {
                timeout: 8000,
                proxy: false
            });

            if (res.data.success) {
                cachedLeader = res.data.leaderUrl || url;
                deadUntil[cachedLeader] = 0;

                return {
                    success: true,
                    stroke: res.data.stroke || stroke
                };
            }
        } catch (err) {
            if (err.response && err.response.data && err.response.data.leaderUrl) {
                cachedLeader = err.response.data.leaderUrl;
            } else {
                markDead(url);
            }
        }
    }

    return {
        success: false
    };
}

async function submitToCluster(stroke) {
    for (let attempt = 1; attempt <= 12; attempt++) {
        const result = await sendStrokeOnce(stroke);

        if (result.success) {
            return result;
        }

        broadcast({
            type: "status",
            online: false
        });

        await new Promise((resolve) => setTimeout(resolve, 800));
    }

    return {
        success: false
    };
}

function enqueueStroke(stroke) {
    writeQueue.push(stroke);

    // Prevent unlimited queue growth during failover.
    if (writeQueue.length > 300) {
        writeQueue = writeQueue.slice(writeQueue.length - 300);
    }

    runQueue();
}

async function runQueue() {
    if (queueRunning) return;

    queueRunning = true;

    while (writeQueue.length > 0) {
        const stroke = writeQueue.shift();
        const result = await submitToCluster(stroke);

        if (result.success) {
            canvasLog.push(result.stroke);

            broadcast({
                type: "status",
                online: true
            });

            broadcast(result.stroke);
        } else {
            console.log("Gateway could not commit stroke after retries.");

            broadcast({
                type: "status",
                online: false
            });

            // Stop briefly so we do not flood during election.
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
    }

    queueRunning = false;
}

wss.on("connection", async (ws) => {
    console.log("Client connected.");

    ws.send(JSON.stringify({
        type: "init",
        data: canvasLog
    }));

    ws.send(JSON.stringify({
        type: "status",
        online: true
    }));

    fetchStateFromAnyReplica();

    ws.on("message", (message) => {
        let stroke;

        try {
            stroke = normalizeStroke(JSON.parse(message));
        } catch (err) {
            console.log(`Invalid client message: ${err.message}`);
            return;
        }

        if (stroke.type !== "draw") {
            return;
        }

        enqueueStroke(stroke);
    });
});

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        replicas: REPLICAS,
        cachedLeader,
        cachedStrokes: canvasLog.length,
        queuedStrokes: writeQueue.length
    });
});

server.listen(PORT, "::", () => {
    console.log(`Gateway ready on port ${PORT}`);
});

