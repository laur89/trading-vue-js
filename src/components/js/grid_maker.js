import Const from '../../stuff/constants.js'
import Utils from '../../stuff/utils.js'

import layout_fn from './layout_fn.js'

const { TIMESCALES, $SCALES, WEEK } = Const

// master_grid - ref to the master grid
function GridMaker(id, params, master_grid = null) {

    let {
        sub, interval, range, ctx, $p, layers_meta, height, y_t
    } = params

    const self = {}
    const lm = layers_meta[id]
    let y_range_fn = null

    if (lm && Object.keys(lm).length !== 0) {
        // Gets last y_range fn()
        const yrs = Object.values(lm).filter(x => x.y_range)
        if (yrs.length !== 0) y_range_fn = yrs[yrs.length - 1].y_range
    }

    // Calc vertical ($/₿) range
    function calc_$range() {
        let hi, lo;

        if (!master_grid) {
            // $ candlestick range
            hi = Math.max(...sub.map(x => x[2]))
            lo = Math.min(...sub.map(x => x[3]))

        } else {
            // Offchart indicator range
            const dim = sub[0] ? sub[0].length : 0
            const arr = []
            for (let i = 1; i < dim; i++) {
                arr.push(...sub.map(x => x[i])
                    .filter(x => typeof x !== 'string'))
            }
            hi = Math.max(...arr)
            lo = Math.min(...arr)

            if (typeof y_range_fn === 'function') {
                [hi, lo] = y_range_fn(hi, lo)
            }
        }

        // Fixed y-range in non-auto mode
        if (y_t && !y_t.auto && y_t.range) {
            self.$_hi = y_t.range[0]
            self.$_lo = y_t.range[1]
        } else {
            self.$_hi = hi + (hi - lo) * $p.config.EXPAND
            self.$_lo = lo - (hi - lo) * $p.config.EXPAND

            if (self.$_hi === self.$_lo) {
                self.$_hi *= 1.05  // Expand if height range === 0
                self.$_lo *= 0.95
            }
        }
    }

    function calc_sidebar() {

        if (sub.length < 2) {
            self.prec = 0
            self.sb = $p.config.SBMIN
            return
        }

        // TODO: improve sidebar width calculation
        // at transition point, when one precision is
        // replaced with another

        // Gets formated levels (their lengths),
        // calculates max and measures the sidebar length
        // from it:

        self.prec = calc_precision(sub)
        const subn = sub.filter(x => typeof x[1] === 'number')
        const lens = subn.map(x => x[1].toFixed(self.prec).length)
        const str = '0'.repeat(Math.max(...lens)) + '    '

        self.sb = ctx.measureText(str).width
        self.sb = Math.max(Math.floor(self.sb), $p.config.SBMIN)

    }

    // Calculate $ precision for the Y-axis
    function calc_precision(data) {

        let max_r = 0, max_l = 0

        // Get max lengths of integer and fractional parts
        let l, r;
        data.forEach(x => {
            const str = x[1].toString()
            if (x[1] < 0.000001) {
                // Parsing the exponential form. Gosh this
                // smells trickily
                const [ls, rs] = str.split('e-')
                [l, r] = ls.split('.')
                if (!r) r = ''
                r = { length: r.length + parseInt(rs) || 0 }
            } else {
                [l, r] = str.split('.')
            }

            if (r && r.length > max_r) {
                max_r = r.length
            }
            if (l && l.length > max_l) {
                max_l = l.length
            }
        })

        // Select precision scheme depending
        // on the left and right part lengths
        //
        const even = max_r - max_r % 2 + 2

        if (max_l === 1) {
            return Math.min(8, Math.max(2, even))
        } else if (max_l <= 2) {
            return Math.min(4, Math.max(2, even))
        }

        return 2
    }

    function calc_positions() {

        if (sub.length < 2) return

        const dt = range[1] - range[0]

        // A pixel space available to draw on (x-axis)
        self.spacex = $p.width - self.sb

        // Candle capacity
        const capacity = dt / interval
        self.px_step = self.spacex / capacity

        // px / time ratio
        const r = self.spacex / dt
        self.startx = (sub[0][0] - range[0]) * r

        // Candle Y-transform: (A = scale, B = shift)
        self.A = -height / (self.$_hi - self.$_lo)
        self.B = -self.$_hi * self.A
    }

    // Select nearest good-loking t step (m is target scale)
    function time_step() {
        const xrange = range[1] - range[0]
        const m = xrange * ($p.config.GRIDX / $p.width)

        return Utils.nearest_a(m, TIMESCALES)[1]
    }

    // Select nearest good-loking $ step (m is target scale)
    function dollar_step() {
        const yrange = self.$_hi - self.$_lo
        const m = yrange * ($p.config.GRIDY / height)
        const p = parseInt(yrange.toExponential().split('e')[1])
        const d = Math.pow(10, p)
        const s = $SCALES.map(x => x * d)

        // TODO: center the range (look at RSI for eaxmple,
        // it looks ugly when "80" is near the top)
        return Utils.strip(Utils.nearest_a(m, s)[1])
    }

    function grid_x() {

        // If this is a subgrid, no need to calc a timeline,
        // we just borrow it from the master_grid
        if (!master_grid) {

            self.t_step = time_step()
            self.xs = []
            const dt = range[1] - range[0]
            const r = self.spacex / dt

            for (let i = 0; i < sub.length; i++) {
                const p = sub[i]
                if (p[0] % self.t_step === 0) {
                    const x = Math.floor((p[0] - range[0]) * r)
                    self.xs.push([x, p])
                }
            }

            // TODO: fix grid extention for bigger timeframes
            if (interval < WEEK) {
                extend_left(dt, r)
                extend_right(dt, r)
            }
        } else {

            self.t_step = master_grid.t_step
            self.px_step = master_grid.px_step
            self.startx = master_grid.startx
            self.xs = master_grid.xs
        }
    }

    function extend_left(dt, r) {

        if (self.xs.length === 0 || !isFinite(r)) return

        let t = self.xs[0][1][0]
        while (true) {
            t -= self.t_step
            const x = Math.floor((t - range[0]) * r)
            if (x < 0) break
            if (t % interval === 0) {
                self.xs.unshift([x, [t]])
            }
        }
    }

    function extend_right(dt, r) {

        if (self.xs.length === 0 || !isFinite(r)) return

        let t = self.xs[self.xs.length - 1][1][0]
        while (true) {
            t += self.t_step
            const x = Math.floor((t - range[0]) * r)
            if (x > self.spacex) break
            if (t % interval === 0) {
                self.xs.push([x, [t]])
            }
        }
    }

    function grid_y() {

        // Prevent duplicate levels
        const m = Math.pow(10, -self.prec)
        self.$_step = Math.max(m, dollar_step())
        self.ys = []

        const y1 = self.$_lo - self.$_lo % self.$_step
        for (let y$ = y1; y$ <= self.$_hi; y$ += self.$_step) {
            const y = Math.floor(y$ * self.A + self.B)
            if (y > height) continue
            self.ys.push([y, Utils.strip(y$)])
        }
    }

    function apply_sizes() {
        self.width = $p.width - self.sb
        self.height = height
    }

    // TODO: calc_sidebar() already declared in this file
    calc_sidebar()

    return {
        // First we need to calculate max sidebar width
        // (among all grids). Then we can actually make
        // them
        create: () => {
            calc_$range()
            calc_positions()
            grid_x()
            grid_y()
            apply_sizes()

            // Link to the master grid (candlesticks)
            if (master_grid) {
                self.master_grid = master_grid
            }

            // Here we add some helpful functions for
            // plugin creators
            return layout_fn(self, range)

        },
        get_layout: () => self,
        set_sidebar: v => self.sb = v,
        get_sidebar: () => self.sb,
    }
}

export default GridMaker
