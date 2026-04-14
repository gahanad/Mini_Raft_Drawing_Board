const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "20mb" }));

const PORT = parseInt(process.env.PORT, 10);
const SELF_ID = process.env.SELF_ID;
const REPLICAS = process.env.REPLICAS ? process.env.REPLICAS.split(",") : [];

const CLUSTER_SIZE = REPLICAS.length + 1;
const MAJORITY = Math.floor(CLUSTER_SIZE / 2) + 1;

const HEARTBEAT_MS = 2000;
const ELECTION_MIN_MS = 10000;
const ELECTION_MAX_MS = 16000;
const RPC_TIMEOUT_MS = 1500;
const DEAD_PEER_BACKOFF_MS = 30000;

let state = "follower";
let currentTerm = 0;
let votedFor = null;
let leaderId = null;

let log = [];
let commitIndex = 0;
let appliedStrokes = [];

let electionTimer = null;
let heartbeatTimer = null;
let peerDownUntil = {};

function nodeIdFromUrl(url) {
    const match = String(url).match(/replica\d+/);
    return match ? match[0] : url;
}

function urlForNode(nodeId) {
    if (!nodeId) return null;
    if (nodeId === SELF_ID) return `http://${SELF_ID}:${PORT}`;
    return REPLICAS.find((url) => nodeIdFromUrl(url) === nodeId) || null;
}

function lastLogIndex() {
    return log.length;
}

function lastLogTerm() {
    return log.length === 0 ? 0 : log[log.length - 1].term;
}

function randomElectionTimeout() {
    return ELECTION_MIN_MS + Math.floor(Math.random() * (ELECTION_MAX_MS - ELECTION_MIN_MS));
}

function resetElectionTimer() {
    clearTimeout(electionTimer);

    electionTimer = setTimeout(() => {
        if (state !== "leader") {
            startElection();
        }
    }, randomElectionTimeout());
}

function becomeFollower(term, newLeaderId = null) {
    if (term > currentTerm) {
        currentTerm = term;
        votedFor = null;
    }

    state = "follower";
    leaderId = newLeaderId;

    clearInterval(heartbeatTimer);
    resetElectionTimer();
}

function becomeLeader() {
    state = "leader";
    leaderId = SELF_ID;
    votedFor = SELF_ID;

    clearTimeout(electionTimer);
    clearInterval(heartbeatTimer);

    console.log(`${SELF_ID} became LEADER for term ${currentTerm}`);

    sendHeartbeats();
    heartbeatTimer = setInterval(sendHeartbeats, HEARTBEAT_MS);
}

function isCandidateLogOk(candidateLastIndex, candidateLastTerm) {
    if (candidateLastTerm !== lastLogTerm()) {
        return candidateLastTerm > lastLogTerm();
    }

    return candidateLastIndex >= lastLogIndex();
}

function isPeerSkipped(peer) {
    return peerDownUntil[peer] && Date.now() < peerDownUntil[peer];
}

function markPeerDown(peer) {
    peerDownUntil[peer] = Date.now() + DEAD_PEER_BACKOFF_MS;
}

async function postToPeer(peer, path, body, timeout = RPC_TIMEOUT_MS) {
    if (isPeerSkipped(peer)) {
        return null;
    }

    try {
        const res = await axios.post(`${peer}${path}`, body, {
            timeout,
            proxy: false
        });

        peerDownUntil[peer] = 0;
        return res.data;
    } catch (err) {
        markPeerDown(peer);

        if (path === "/requestVote") {
            console.log(`${path} to ${peer} failed: ${err.code || err.message}`);
        }


        return null;
    }
}

async function startElection() {
    state = "candidate";
    currentTerm += 1;
    votedFor = SELF_ID;
    leaderId = null;

    const electionTerm = currentTerm;
    let votes = 1;

    console.log(`${SELF_ID} started election for term ${electionTerm}`);

    resetElectionTimer();

    await Promise.all(REPLICAS.map(async (peer) => {
        const data = await postToPeer(peer, "/requestVote", {
            term: electionTerm,
            candidateId: SELF_ID,
            lastLogIndex: lastLogIndex(),
            lastLogTerm: lastLogTerm()
        }, RPC_TIMEOUT_MS);

        if (!data) return;

        if (data.term > currentTerm) {
            becomeFollower(data.term);
            return;
        }

        if (state === "candidate" && data.voteGranted) {
            votes += 1;
        }
    }));

    if (state === "candidate" && currentTerm === electionTerm && votes >= MAJORITY) {
        becomeLeader();
    } else if (state === "candidate") {
        resetElectionTimer();
    }
}

function applyCommittedEntries() {
    appliedStrokes = log
        .slice(0, commitIndex)
        .map((entry) => entry.stroke)
        .filter(Boolean);
}

function mergeEntries(entries) {
    for (const entry of entries) {
        const existing = log[entry.index - 1];

        if (!existing) {
            log.push(entry);
        } else if (existing.term !== entry.term) {
            log = log.slice(0, entry.index - 1);
            log.push(entry);
        }
    }
}

async function sendAppendEntries(peer, entries = []) {
    const data = await postToPeer(peer, "/appendEntries", {
        term: currentTerm,
        leaderId: SELF_ID,
        entries,
        leaderCommit: commitIndex
    }, RPC_TIMEOUT_MS);

    if (!data) return false;

    if (data.term > currentTerm) {
        becomeFollower(data.term);
        return false;
    }

    return data.success === true;
}

function sendHeartbeats() {
    if (state !== "leader") return;

    for (const peer of REPLICAS) {
        sendAppendEntries(peer, []);
    }
}

function replicateToMajority(entry) {
    return new Promise((resolve) => {
        let acks = 1;
        let completed = 1;
        let resolved = false;

        function finish(result) {
            if (!resolved) {
                resolved = true;
                resolve(result);
            }
        }

        for (const peer of REPLICAS) {
            if (isPeerSkipped(peer)) {
                completed += 1;
                continue;
            }

            sendAppendEntries(peer, [entry]).then((ok) => {
                completed += 1;

                if (ok) {
                    acks += 1;
                }

                if (acks >= MAJORITY) {
                    finish(true);
                }

                if (completed >= CLUSTER_SIZE) {
                    finish(acks >= MAJORITY);
                }
            });
        }

        if (acks >= MAJORITY) {
            finish(true);
        }

        setTimeout(() => {
            finish(acks >= MAJORITY);
        }, RPC_TIMEOUT_MS + 200);
    });
}

app.post("/requestVote", (req, res) => {
    const {
        term,
        candidateId,
        lastLogIndex: candidateLastIndex,
        lastLogTerm: candidateLastTerm
    } = req.body;

    if (term < currentTerm) {
        return res.json({
            term: currentTerm,
            voteGranted: false
        });
    }

    if (term > currentTerm) {
        becomeFollower(term);
    }

    const canVote = votedFor === null || votedFor === candidateId;
    const logOk = isCandidateLogOk(candidateLastIndex, candidateLastTerm);

    if (canVote && logOk) {
        votedFor = candidateId;
        resetElectionTimer();

        console.log(`${SELF_ID} voted for ${candidateId} in term ${currentTerm}`);

        return res.json({
            term: currentTerm,
            voteGranted: true
        });
    }

    res.json({
        term: currentTerm,
        voteGranted: false
    });
});

app.post("/appendEntries", (req, res) => {
    const {
        term,
        leaderId: incomingLeaderId,
        entries = [],
        leaderCommit = 0
    } = req.body;

    if (term < currentTerm) {
        return res.json({
            term: currentTerm,
            success: false
        });
    }

    becomeFollower(term, incomingLeaderId);

    mergeEntries(entries);

    if (leaderCommit > commitIndex) {
        commitIndex = Math.min(leaderCommit, log.length);
        applyCommittedEntries();
    }

    res.json({
        term: currentTerm,
        success: true
    });
});

app.post("/client-write", async (req, res) => {
    if (state !== "leader") {
        return res.status(403).json({
            success: false,
            leaderId,
            leaderUrl: urlForNode(leaderId)
        });
    }

    const stroke = req.body.stroke;

    const entry = {
        index: log.length + 1,
        term: currentTerm,
        stroke
    };

    log.push(entry);

    const committed = await replicateToMajority(entry);

    if (!committed) {
        log.pop();

        return res.status(503).json({
            success: false,
            message: "Majority not available"
        });
    }

    commitIndex = entry.index;
    applyCommittedEntries();
    sendHeartbeats();

    console.log(`${SELF_ID} write acks: majority`);

    res.json({
        success: true,
        leaderId: SELF_ID,
        leaderUrl: urlForNode(SELF_ID),
        stroke
    });
});

app.get("/getState", (req, res) => {
    res.json({
        id: SELF_ID,
        state,
        term: currentTerm,
        leaderId,
        leaderUrl: urlForNode(leaderId),
        commitIndex,
        log: appliedStrokes
    });
});

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        id: SELF_ID,
        state,
        term: currentTerm,
        leaderId,
        logLength: log.length,
        commitIndex
    });
});

app.listen(PORT, "::", () => {
    console.log(`${SELF_ID} running on port ${PORT}`);
    resetElectionTimer();
});

