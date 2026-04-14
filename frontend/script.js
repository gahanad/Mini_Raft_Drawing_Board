// ====== COLOR PALETTE ======
const colorBtns = document.querySelectorAll(".color-btn");
colorBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        colorBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        window.currentColor = btn.dataset.color;
        window.isEraser = false;
        eraserBtn.classList.remove("active");
    });
});

// ====== BRUSH SIZE ======
const brushSlider = document.getElementById("brushSize");
const brushLabel = document.getElementById("brushSizeLabel");
brushSlider.addEventListener("input", () => {
    window.brushSize = parseInt(brushSlider.value);
    brushLabel.textContent = brushSlider.value;
});

// ====== ERASER ======
const eraserBtn = document.getElementById("eraserBtn");
eraserBtn.addEventListener("click", () => {
    window.isEraser = !window.isEraser;
    eraserBtn.classList.toggle("active", window.isEraser);
});

// ====== UNDO ======
document.getElementById("undoBtn").addEventListener("click", () => {
    socket.send(JSON.stringify({ type: "undo" }));
});

// ====== REDO ======
document.getElementById("redoBtn").addEventListener("click", () => {
    socket.send(JSON.stringify({ type: "redo" }));
});

// ====== KEYBOARD SHORTCUTS ======
window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "z") {
        socket.send(JSON.stringify({ type: "undo" }));
    }
    if (e.ctrlKey && e.key === "y") {
        socket.send(JSON.stringify({ type: "redo" }));
    }
});

// ====== SAVE PNG ======
document.getElementById("savePngBtn").addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "drawing.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
});

// ====== SAVE JPEG ======
document.getElementById("saveJpgBtn").addEventListener("click", () => {
    // JPEG doesn't support transparency — fill white background first
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.fillStyle = "#ffffff";
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.drawImage(canvas, 0, 0);

    const link = document.createElement("a");
    link.download = "drawing.jpg";
    link.href = tempCanvas.toDataURL("image/jpeg", 0.95);
    link.click();
});

// ====== CLEAR ======
document.getElementById("clearBtn").addEventListener("click", () => {
    socket.send(JSON.stringify({ type: "clear" }));
});