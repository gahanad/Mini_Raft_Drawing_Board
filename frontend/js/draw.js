// ====== STATE ======
window.currentColor = "#000000";
window.brushSize = 3;
window.isEraser = false;

// ====== DRAW LINE ======
window.drawLine = function (data) {
    ctx.beginPath();
    ctx.moveTo(data.x1, data.y1);
    ctx.lineTo(data.x2, data.y2);
    ctx.strokeStyle = data.color || "#000000";
    ctx.lineWidth = data.size || 3;
    ctx.lineCap = "round";
    ctx.stroke();
};

// ====== REDRAW ENTIRE LOG ======
window.redrawAll = function (log) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    log.forEach(entry => {
        if (entry.type === "draw") {
            window.drawLine(entry);
        }
    });
};

// ====== MOUSE DRAWING ======
let drawing = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener("mousedown", (e) => {
    drawing = true;
    const pos = getMousePos(e);
    lastX = pos.x;
    lastY = pos.y;
});
let lastSendTime = 0;

canvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;

    const now = Date.now();
    if (now - lastSendTime < 16) return;
    lastSendTime = now;
    const pos = getMousePos(e);
    const currentX = pos.x;
    const currentY = pos.y;

    const color = window.isEraser ? "#ffffff" : window.currentColor;
    const size = window.isEraser ? window.brushSize * 4 : window.brushSize;

    const data = {
        type: "draw",
        x1: lastX, y1: lastY,
        x2: currentX, y2: currentY,
        color,
        size
    };

    // draw locally
    window.drawLine(data);

    // send to server with a check
    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify(data));
    }
    else {
        console.warn("Socket not open. Stroke not sent.");
        setStatus(false); // Trigger the overlay if we try to draw while disconnected
    }

    lastX = currentX;
    lastY = currentY;
});

canvas.addEventListener("mouseup", () => { drawing = false; });
canvas.addEventListener("mouseleave", () => { drawing = false; });