'use strict';

const ToolId = Object.freeze({
    Pen: 'pen',
    Eraser: 'eraser',
    Fill: 'fill',
    Picker: 'picker',
    Line: 'line',
    Rect: 'rect',
});

const kMinBrushSize = 1;
const kMaxBrushSize = 64;

// 押してから離すまでの1回の描画（ストローク）を、選ばれた道具で処理する
class ToolController
{
    constructor(layers, history, painter, onPick)
    {
        this.layers = layers;
        this.history = history;
        this.painter = painter;
        this.onPick = onPick;
        this.toolId = ToolId.Pen;
        this.brushSize = kMinBrushSize;
        this.brushShapeId = BrushShapeId.Square;
        // 消しゴムで塗る色。エディタは透明、通信モードは白い紙なので白にする
        this.eraserColor = ColorUtil.kTransparent;
        this.isRectFilled = false;
        this.stroke = null;
    }

    get isActive()
    {
        return this.stroke !== null;
    }

    setBrushSize(size)
    {
        const rounded = Math.round(Number(size)) || kMinBrushSize;
        this.brushSize = Math.min(kMaxBrushSize, Math.max(kMinBrushSize, rounded));
    }

    setBrushShape(shapeId)
    {
        this.brushShapeId = shapeId === BrushShapeId.Round ? BrushShapeId.Round : BrushShapeId.Square;
    }

    get brush()
    {
        return BrushShape.get(this.brushShapeId, this.brushSize);
    }

    // スポイトと塗りつぶしは太さに関係なく1マスに効くので、カーソルも1マスにする
    get cursorBrush()
    {
        const isSingleCell = this.toolId === ToolId.Fill || this.toolId === ToolId.Picker;
        return isSingleCell ? BrushShape.get(BrushShapeId.Square, kMinBrushSize) : this.brush;
    }

    // toolOverride は Alt を押している間だけスポイトにする、などの一時的な持ち替え用
    begin(x, y, color, isSecondary, toolOverride)
    {
        const toolId = toolOverride || this.toolId;
        const paintColor = toolId === ToolId.Eraser ? this.eraserColor : color;
        this.stroke = { toolId, color: paintColor, isSecondary, startX: x, startY: y, lastX: x, lastY: y };
        if (toolId === ToolId.Picker) {
            this.pick(x, y);
            return;
        }
        this.history.begin(this.layers.activeCanvas);
        if (toolId === ToolId.Fill) {
            this.painter.floodFill(x, y, paintColor);
            return;
        }
        this.drawTo(x, y);
    }

    move(x, y)
    {
        const stroke = this.stroke;
        if (stroke === null || (x === stroke.lastX && y === stroke.lastY)) return;
        if (stroke.toolId === ToolId.Picker) {
            this.pick(x, y);
        } else if (stroke.toolId !== ToolId.Fill) {
            this.drawTo(x, y);
        }
        stroke.lastX = x;
        stroke.lastY = y;
    }

    // 戻り値は「絵が変わったか」と、使った道具・色（最近使った色に入れるため）
    end()
    {
        const stroke = this.stroke;
        this.stroke = null;
        if (stroke === null || stroke.toolId === ToolId.Picker) {
            return { hasChanged: false };
        }
        const hasChanged = this.history.commit();
        return { hasChanged, toolId: stroke.toolId, color: stroke.color };
    }

    // 描いている途中の線を無かったことにする（スマホで2本目の指が触れて、拡大・移動に切り替わったとき）
    cancel()
    {
        const stroke = this.stroke;
        this.stroke = null;
        if (stroke === null || stroke.toolId === ToolId.Picker) return;
        this.history.revertCurrent();
        this.history.commit();
    }

    drawTo(x, y)
    {
        const stroke = this.stroke;
        const brush = this.brush;
        switch (stroke.toolId) {
            case ToolId.Pen:
            case ToolId.Eraser:
                this.painter.strokeLine(stroke.lastX, stroke.lastY, x, y, brush, stroke.color);
                break;
            case ToolId.Line:
                this.history.revertCurrent();
                this.painter.strokeLine(stroke.startX, stroke.startY, x, y, brush, stroke.color);
                break;
            case ToolId.Rect:
                this.history.revertCurrent();
                this.painter.rect(stroke.startX, stroke.startY, x, y, brush, stroke.color, this.isRectFilled);
                break;
        }
    }

    pick(x, y)
    {
        if (!this.layers.isInside(x, y)) return;
        this.onPick(this.layers.pickVisibleColor(x, y), this.stroke.isSecondary);
    }
}
