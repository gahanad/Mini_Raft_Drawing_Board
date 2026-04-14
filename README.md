# MINI_RAFT - Real-Time Collaborative Drawing Board

A real-time collaborative drawing board using WebSocket, Docker, and Raft-style leader election.

## Live Demo

[Open Live Project](PASTE_RAILWAY_URL_HERE)

## Features

- Real-time collaborative drawing
- WebSocket gateway
- Three Raft-style replica nodes
- Leader election using terms and votes
- Majority write replication
- Continues working when one node fails
- Gateway write queue to prevent request flooding during failover

## Architecture

Browser -> Gateway -> Raft Leader -> Followers -> Gateway -> Browsers

## How It Works

1. Browser connects to the gateway using WebSocket.
2. User draws on the canvas.
3. `draw.js` creates a stroke object and sends it through WebSocket.
4. Gateway queues strokes one by one.
5. Gateway sends each stroke to the current Raft leader.
6. Leader writes the stroke into its log.
7. Leader replicates the stroke to followers using AppendEntries.
8. When majority accepts, the stroke is committed.
9. Gateway broadcasts the committed stroke to all connected browsers.

## Raft Failover

The system has 3 replicas, so majority is 2.

If one node fails:

- The remaining nodes detect missing heartbeat.
- One node becomes candidate.
- It asks for votes using RequestVote.
- If it gets 2 votes, it becomes leader.
- Drawing continues with 2/3 majority.

## Run Locally

```bash
docker compose up --build


To open:
http://localhost:8080

Failure Test
Stop the current leader:

docker stop replica2
Expected behavior:

replica1 started election
replica3 voted for replica1
replica1 became LEADER
replica1 write acks: majority

Tech Stack
HTML, CSS, JavaScript
WebSocket
Node.js
Express.js
Axios
Docker
Railway