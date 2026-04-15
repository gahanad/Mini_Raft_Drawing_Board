# MINI_RAFT - Real-Time Collaborative Drawing Board

MINI_RAFT is a distributed collaborative drawing board built with WebSockets, Node.js, Docker, and a Raft-style leader election flow. The browser sends drawing strokes to a gateway, and the gateway commits those strokes through a three-node replica cluster before broadcasting them back to connected clients.

## Demo

Add your demo media here before sharing the repository:

- Demo video: `PASTE_YOUR_VIDEO_LINK_HERE`
- Screenshots: add images under `docs/media/` and embed them below

Example:

```md
![Drawing board demo](docs/media/demo-screenshot.png)


Features
Real-time collaborative drawing using WebSockets
Gateway service that accepts browser connections
Three replica services with Raft-style leader election
Majority-based write replication
Automatic failover when one replica goes down
Docker Compose setup for a full local distributed demo
