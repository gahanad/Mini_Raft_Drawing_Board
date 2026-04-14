const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // restore styles after resize
    ctx.lineWidth = window.brushSize || 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = window.currentColor || "black";
}

window.addEventListener("load", resizeCanvas);
window.addEventListener("resize", resizeCanvas);

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

window.canvas = canvas;
window.ctx = ctx;
window.getMousePos = getMousePos;
window.resizeCanvas = resizeCanvas;