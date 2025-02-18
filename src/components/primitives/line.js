
// Draws a line, adds corresponding collision f-n

import Math2 from '../../stuff/math.js'

export default class Line {

    // Overlay ref, canvas ctx
    constructor(overlay, ctx) {
        this.ctx = ctx
        this.comp = overlay
        this.T = overlay.$props.config.TOOL_COLL
    }

    // p1[t, $], p2[t, $] (time-price coordinates)
    draw(p1, p2) {

        const layout = this.comp.$props.layout

        const x1 = layout.t2screen(p1[0])
        const y1 = layout.$2screen(p1[1])
        const x2 = layout.t2screen(p2[0])
        const y2 = layout.$2screen(p2[1])

        this.ctx.moveTo(x1, y1)
        this.ctx.lineTo(x2, y2)

        const w = layout.width
        const h = layout.height
        // TODO: transform k (angle) to screen ratio
        // (this requires a new a2screen function)
        const k = (y2 - y1) / (x2 - x1)
        const s = Math.sign(x2 - x1 || y2 - y1)
        let dx = w * s * 2
        let dy = w * k * s * 2

        if (dy === Infinity) {
            dx = 0
            dy = h * s
        }

        this.ctx.moveTo(x2, y2)
        this.ctx.lineTo(x2 + dx, y2 + dy)
        this.ctx.moveTo(x1, y1)
        this.ctx.lineTo(x1 - dx, y1 - dy)

        this.comp.collisions.push(
            this.make([x1, y1], [x2, y2])
        )
    }

    // Collision function. x, y - mouse coord.
    make(p1, p2) {
        return (x, y) => Math2.point2line([x, y], p1, p2) < this.T
    }
}
