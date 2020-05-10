
import Const from '../../stuff/constants.js'
import Utils from '../../stuff/utils.js'

const { MINUTE15, MINUTE, HOUR, DAY, WEEK, MONTH, YEAR, MONTHMAP } = Const

export default class Botbar {

    constructor(canvas, comp) {

        this.canvas = canvas
        this.ctx = canvas.getContext('2d')
        this.comp = comp
        this.$p = comp.$props
        this.data = this.$p.sub
        this.range = this.$p.range
        this.layout = this.$p.layout
    }

    update() {
        this.grid_0 = this.layout.grids[0]  // master grid

        const width = this.layout.botbar.width
        const height = this.layout.botbar.height

        const sb = this.layout.grids[0].sb

        //this.ctx.fillStyle = this.$p.colors.back
        this.ctx.font = this.$p.font
        //this.ctx.fillRect(0, 0, width, height)
        this.ctx.clearRect(0, 0, width, height)

        this.ctx.strokeStyle = this.$p.colors.scale

        this.ctx.beginPath()
        this.ctx.moveTo(0, 0.5)
        this.ctx.lineTo(Math.floor(width + 1), 0.5)
        this.ctx.stroke()

        this.ctx.fillStyle = this.$p.colors.text
        this.ctx.beginPath()

        for (let i = 0; i < this.layout.botbar.xs.length; i++) {
            const p = this.layout.botbar.xs[i]
            const lbl = this.format_date(p[1][0], this.layout.botbar.xs[i+1])

            if (p[0] > width - sb) continue

            this.ctx.moveTo(p[0] - 0.5, 0)
            this.ctx.lineTo(p[0] - 0.5, 4.5)

            if (!this.lbl_highlight(p[1][0])) {
                this.ctx.globalAlpha = 0.85
            }
            this.ctx.textAlign = 'center'
            this.ctx.fillText(lbl, p[0], 18)
            this.ctx.globalAlpha = 1
        }

        this.ctx.stroke()
        this.apply_shaders()
        if (this.$p.cursor.x && this.$p.cursor.t !== undefined)
            this.panel()
    }

    apply_shaders() {
        let layout = this.layout.grids[0]
        let props = {
            layout: layout,
            cursor: this.$p.cursor
        }
        for (var s of this.comp.bot_shaders) {
            this.ctx.save()
            s.draw(this.ctx, props)
            this.ctx.restore()
        }
    }

    /**
     * cursor on botbar label
     */
    panel() {
        const lbl = this.format_cursor_x()
        this.ctx.fillStyle = this.$p.colors.panel

        const measure = this.ctx.measureText(lbl + '    ')
        const panwidth = Math.floor(measure.width)
        const cursor = this.$p.cursor.x
        const x = Math.floor(cursor - panwidth * 0.5)
        const y = -0.5
        const panheight = this.comp.config.PANHEIGHT

        this.ctx.fillRect(x, y, panwidth, panheight + 0.5)

        this.ctx.fillStyle = this.$p.colors.textHL
        this.ctx.textAlign = 'center'
        this.ctx.fillText(lbl, cursor, y + 16)
    }

    // TODO: implement time zones
    // TODO2: this function is called way too often! ie when no scrolling/paning is happening!
    /**
     * Bottom bar labels for the grid-lines
     * @param t
     * @returns {string|number|*}
     */
    format_date(t, next_candle) {
        if (this.$p.gap_collapse === 3) t = this.grid_0.ti_map.i2t(t)
        let ti = this.$p.layout.grids[0].ti_map.tf
        // Enable timezones only for tf < 1D
        let k = ti < DAY ? 1 : 0
        let tZ = t + k * this.$p.timezone * HOUR

        //t += new Date(t).getTimezoneOffset() * MINUTE
        let d = new Date(tZ)

        if (p[2] === YEAR || Utils.year_start(t) === t) {
            return d.getUTCFullYear()
        }
        if (p[2] === MONTH || Utils.month_start(t) === t) {
            return MONTHMAP[d.getUTCMonth()]
        }
        // TODO(*) see grid_maker.js
        if (Utils.day_start(tZ) === tZ) return d.getUTCDate()

        // change label if we're followed by gap: TODO: following if-block is hacky and should be remvoved or reworked! from here
        if (this.range.gaps !== null && next_candle !== undefined) {
            for (const gap of this.range.gaps) {
                if (t <= gap.start && next_candle[1][0] >= gap.end) {
                    t = next_candle[1][0]
                    t += new Date(t).getTimezoneOffset() * MINUTE
                    return new Date(t).getDate()  // TODO: need to solve actual return format here
                }
            }
        }

        let h = Utils.add_zero(d.getUTCHours())
        let m = Utils.add_zero(d.getUTCMinutes())
        return h + ":" + m

    }

    format_cursor_x() {
        let t = this.$p.cursor.t
        if (this.$p.gap_collapse === 3) t = this.grid_0.ti_map.i2t(t)
        //let ti = this.$p.interval
        let ti = this.$p.layout.grids[0].ti_map.tf
        // Enable timezones only for tf < 1D
        let k = ti < DAY ? 1 : 0

        //t += new Date(t).getTimezoneOffset() * MINUTE
        let d = new Date(t + k * this.$p.timezone * HOUR)
        const ti = this.$p.interval

        if (ti === YEAR) {
            return d.getUTCFullYear()
        }

        if (ti < YEAR) {
            var yr = '`' + `${d.getUTCFullYear()}`.slice(-2)
            var mo = MONTHMAP[d.getUTCMonth()]
            var dd = '01'
        }

        if (ti <= WEEK) dd = d.getUTCDate()
        let date = `${dd} ${mo} ${yr}`
        let time = ''
        // TODO: these 3 commented lines are from merge... delete?
        //let time = '', date = ''
        //if (dd !== undefined) date += dd;
        //if (mo_yr !== undefined) date += date.length === 0 ? mo_yr : ' ' + mo_yr

        if (ti < DAY) {
            let h = Utils.add_zero(d.getUTCHours())
            let m = Utils.add_zero(d.getUTCMinutes())
            time = h + ":" + m
        }

        return `${date}  ${time}`

    }

    // Highlights the begining of a time interval
    // TODO: improve. Problem: let's say we have a new month,
    // but if there is no grid line in place, there
    // will be no month name on t-axis. Sad.
    // Solution: manipulate the grid, skew it, you know
    lbl_highlight(t) {

        const ti = this.$p.interval

        if (t === 0) return true
        if (Utils.month_start(t) === t) return true
        if (Utils.day_start(t) === t) return true

        return ti <= MINUTE15 && t % HOUR === 0;
    }

    mousemove() { }
    mouseout() { }
    mouseup() { }
    mousedown() { }

}
