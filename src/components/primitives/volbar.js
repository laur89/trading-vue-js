
export default class VolbarExt {

    constructor(overlay, ctx, data) {
        this.ctx = ctx
        this.$p = overlay.$props
        this.self = overlay
        this.style = typeof data.raw[6] === 'object' ? data.raw[6] : this.self;
        this.draw(data)
    }

    // TODO!! do not all the primitive types drawing logic have issues
    // because our data being reversed, and eg here having "data.x2 - data.x1" - is x2 always > x1?
    draw(data) {
        const y0 = this.$p.layout.height
        const w = data.x2 - data.x1
        const h = Math.floor(data.h)

        this.ctx.fillStyle = data.green ?
            this.style.colorVolUp :
            this.style.colorVolDw

        this.ctx.fillRect(
            Math.floor(data.x1),
            Math.floor(y0 - h - 0.5),
            Math.floor(w),
            Math.floor(h + 1)
        )
    }
}
