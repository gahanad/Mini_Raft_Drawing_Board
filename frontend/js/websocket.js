let socket;

function connectSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}`);

    window.socket = socket;

    socket.onopen = () => {
        console.log("Connected to gateway");
        setStatus(true);
    };

    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === "init") {
            window.redrawAll(msg.data || []);
            return;
        }

        if (msg.type === "draw") {
            window.drawLine(msg);
            return;
        }

        if (msg.type === "status") {
            setStatus(Boolean(msg.online));
            return;
        }
    };

    socket.onclose = () => {
        console.log("Disconnected from gateway");
        setStatus(false);

        setTimeout(() => {
            connectSocket();
        }, 1500);
    };

    socket.onerror = () => {
        setStatus(false);
    };
}

function setStatus(online) {
    const statusIndicator = document.getElementById("statusIndicator");
    const statusText = document.getElementById("statusText");
    const connectionOverlay = document.getElementById("connectionOverlay");

    if (online) {
        if (statusIndicator) statusIndicator.style.background = "#2ecc71";
        if (statusText) statusText.textContent = "Online";
        if (connectionOverlay) connectionOverlay.style.display = "none";
    } else {
        if (statusIndicator) statusIndicator.style.background = "#e74c3c";
        if (statusText) statusText.textContent = "Searching Leader";
        if (connectionOverlay) connectionOverlay.style.display = "flex";
    }
}

connectSocket();
