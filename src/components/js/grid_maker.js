import Const from '../../stuff/constants.js'
import Utils from '../../stuff/utils.js'
import math from '../../stuff/math.js'

import layout_fn from './layout_fn.js'
import log_scale from './log_scale.js'

const { TIMESCALES, $SCALES, WEEK, MONTH, YEAR, HOUR, DAY } = Const
const MAX_INT = Number.MAX_SAFE_INTEGER


// master_grid - ref to the master grid
function GridMaker(id, params, master_grid = null) {

    const {
        sub, interval, range, ctx, $p, layers_meta, height, y_t, ti_map,
        grid, timezone
    } = params

    const self = {  // layout object? what's the semantics between 'layout' and 'grid'?
        grid,
        ti_map,
        height,
        master_grid,  // link to master grid entity;
        prec: -1,  // (sidebar?) precision
        sb: -1,  // sidebar width
        spacex: -1,  // horizontal space (px) to draw on
        startx: -1,  // x coordinate (px) for first/starting candle; note we start rendering from right-hand side
        A: -1,  // TODO what is this?
        B: -1,  // TODO what is this?
        t_step: -1,  // time step at which to draw vertical grid lines at
        px_step: -1,  // candle step in px
        xs: null,   // array of [x_coord, candle]
        ys: null,   // TODO
        $_step: null,  // grid lines' vertical/y step in px;
        $_hi: -1,  // max vertical range w/ the buffer, ie absolute
        $_lo: -1,  // min vertical range w/ the buffer, ie absolute
        //volume: []  // list of volbar definitions, created in layout.js for master grid
        //candles: [],  // list of candle definitions, created in layout.js for master grid
        gap_collapse: $p.gap_collapse,
    }

    const lm = layers_meta[id]
    let y_range_fn = undefined
    const ls = !!grid.logScale

    if (lm !== null && typeof lm === 'object' && Object.keys(lm).length !== 0) {
        // The first y_range() determines the range
        y_range_fn = Object.values(lm)
            .find(x => x.hasOwnProperty('y_range') && typeof x.y_range === 'function')
        y_range_fn = y_range_fn === undefined ? null : y_range_fn.y_range
        // TODO: what is y_range for? to customize the range for our offchart?
    }

    // Calc vertical ($/₿) range
    function calc_$range() {
        let hi, lo;

        if (!master_grid) {
            // $ candlestick range
            if (typeof y_range_fn === 'function') {
                var [hi, lo] = y_range_fn(hi, lo)
            } else {
                hi = -Infinity, lo = Infinity
                for (var i = 0, n = sub.length; i < n; i++) {
                    let x = sub[i]
                    if (x[2] > hi) hi = x[2]
                    if (x[3] < lo) lo = x[3]
                }
            }
        } else {
            // Offchart indicator range
            hi = -Infinity, lo = Infinity
            for (var i = 0; i < sub.length; i++) {
                for (var j = 1; j < sub[i].length; j++) {
                    let v = sub[i][j]
                    if (v > hi) hi = v
                    if (v < lo) lo = v
                }
            }
            if (typeof y_range_fn === 'function') { var [hi, lo, exp] = y_range_fn(hi, lo) }
        }

        // Fixed y-range in non-auto mode
        //   TODO: what range is referenced here? should it be changed to support object instead of array?
        //   TODO: range is likely object here right?
        if (y_t && !y_t.auto && y_t.range) {
            self.$_hi = y_t.range[0]
            self.$_lo = y_t.range[1]
        } else {
            if (!ls) {
                exp = exp === false ? 0 : 1
                self.$_hi = hi + (hi - lo) * $p.config.EXPAND * exp
                self.$_lo = lo - (hi - lo) * $p.config.EXPAND * exp
            } else {
                self.$_hi = hi
                self.$_lo = lo
                log_scale.expand(self, height)
            }

            if (self.$_hi === self.$_lo) {
                if (!ls) {
                    self.$_hi *= 1.05  // Expand if height range === 0
                    self.$_lo *= 0.95
                } else {
                    log_scale.expand(self, height)
                }
            }
        }
    }

    /**
     * Sidebar is on the right, stacking the prices et al;
     * We calculate some necessary properties and store 'em
     * under {@code self} object.
     */
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

        // TODO: add custom formatter f()
        lens.push(self.$_hi.toFixed(self.prec).length)
        lens.push(self.$_lo.toFixed(self.prec).length)
        self.prec = calc_precision(sub)
        let lens = []
        lens.push(self.$_hi.toFixed(self.prec).length)
        lens.push(self.$_lo.toFixed(self.prec).length)
        let str = '0'.repeat(Math.max(...lens)) + '    '
        self.sb = ctx.measureText(str).width
        self.sb = Math.max(Math.floor(self.sb), $p.config.SBMIN)
        self.sb = Math.min(self.sb, $p.config.SBMAX)
    }

    // Calculate $ precision for the Y-axis
    // TODO: what does the return value really signify?
    function calc_precision(data) {

        let max_r = 0, max_l = 0  // max_{right,left} part (decimal being the separator); note they're not absolute values but length of digits

        let min = Infinity
        let max = -Infinity

        // Speed UP
        for (var i = 0, n = data.length; i < n; i++) {
            let x = data[i]
            if (x[1] > max) max = x[1]
            else if (x[1] < min) min = x[1]
        }
        // Get max lengths of integer and fractional parts
        let l, r;
        [min, max].forEach(x => {
            // Fix undefined bug
            var open_as_str = x != null ? x.toString() : ''
            if (x < 0.000001) {
                // Parsing the exponential form. Gosh this
                // smells trickily
                const [ls, rs] = open_as_str.split('e-')
                [l, r] = ls.split('.') // TODO note to laur: check what's r value if not enough values? (instead of checking !r in following line)
                if (!r) r = ''
                r = { length: r.length + parseInt(rs) || 0 }  // we simulate string type here - we need the 'length' field;
            } else {
                [l, r] = open_as_str.split('.')
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
        } else if (max_l <= 2) {  // TODO: shouldn't this be if max_l === 2? no other values less than that are possible
            return Math.min(4, Math.max(2, even))
        }

        return 2
    }

    /**
     * Calculates some properties, such as
     * {@code px_step},
     * {@code startx},
     * {@code A},
     * {@code B}
     */
    function calc_positions() {

        if (sub.length < 2) return  // less than 2 data-points

        // A pixel space available to draw on (x-axis)
        self.spacex = $p.width - self.sb

        // Candle capacity
        const capacity = range.delta / interval  // number of candles
        self.px_step = self.spacex / capacity  // candle step in px

        // px / time ratio
        const r = self.spacex / range.delta  // ms per 1px

        switch ($p.gap_collapse) {
            case 2:
                self.startx = self.spacex - range.end_remainder * r;
                break;
            default:
                self.startx = self.spacex - (range.end - sub[0][0]) * r;
                break;
        }
        //console.log(`spacex: ${self.spacex},startx: ${self.startx}, range.end_remainder: ${range.end_remainder}, r: ${r}, cap: ${capacity}, interval: ${interval}`);

        // Candle Y-transform: (A = scale, B = shift)
        if (!grid.logScale) {
            self.A = - height / (self.$_hi - self.$_lo)
            self.B = - self.$_hi * self.A
        } else {
            self.A = - height / (math.log(self.$_hi) -
                       math.log(self.$_lo))
            self.B = - math.log(self.$_hi) * self.A
        }

    }

    // Select nearest good-looking t step (m is target scale)
    function time_step(delta_range) {
        const k = $p.gap_collapse === 3 ? 60000 : 1
        const m = delta_range * k * ($p.config.GRIDX / $p.width)

        return Utils.nearest_a(m, TIMESCALES)[1] / k
    }

    // Select nearest good-looking $ step (m is target scale)
    function dollar_step() {
        const yrange = self.$_hi - self.$_lo
        const m = yrange * ($p.config.GRIDY / height)
        const p = parseInt(yrange.toExponential().split('e')[1])
        const d = Math.pow(10, p)
        const s = $SCALES.map(x => x * d)

        // TODO: center the range (look at RSI for example,
        // it looks ugly when "80" is near the top)
        return Utils.strip(Utils.nearest_a(m, s)[1])
    }

    function dollar_mult() {
        let mult_hi = dollar_mult_hi()
        let mult_lo = dollar_mult_lo()
        return Math.max(mult_hi, mult_lo)
    }

    // Price step multiplier (for the log-scale mode)
    function dollar_mult_hi() {

        let h = Math.min(self.B, height)
        if (h < $p.config.GRIDY) return 1
        let n = h / $p.config.GRIDY // target grid N
        let yrange = self.$_hi
        if (self.$_lo > 0) {
            var yratio = self.$_hi / self.$_lo
        } else {
            yratio = self.$_hi / 1 // TODO: small values
        }
        let m = yrange * ($p.config.GRIDY / h)
        let p = parseInt(yrange.toExponential().split('e')[1])
        return Math.pow(yratio, 1/n)
    }

    function dollar_mult_lo() {

        let h = Math.min(height - self.B, height)
        if (h < $p.config.GRIDY) return 1
        let n = h / $p.config.GRIDY // target grid N
        let yrange = Math.abs(self.$_lo)
        if (self.$_hi < 0 && self.$_lo < 0) {
            var yratio = Math.abs(self.$_lo / self.$_hi)
        } else {
            yratio = Math.abs(self.$_lo) / 1
        }
        let m = yrange * ($p.config.GRIDY / h)
        let p = parseInt(yrange.toExponential().split('e')[1])
        return Math.pow(yratio, 1/n)
    }

    function grid_x() {

        // If this is a subgrid, no need to calc a timeline,
        // we just borrow it from the master_grid:
        if (master_grid === null) {

            self.t_step = time_step(range.delta)
            self.xs = []
            const r = self.spacex / range.delta  // ms per 1px

            /* TODO: remove the left-side glitch

            let year_0 = Utils.get_year(sub[0][0])
            for (var t0 = year_0; t0 < range.start; t0 += self.t_step) {}

            let m0 = Utils.get_month(t0)*/

            for (var i = 0; i < sub.length; i++) {
                const p = sub[i]
                let prev = sub[i-1] || []
                let prev_xs = self.xs[self.xs.length - 1] || [0,[]]
                let x = Math.floor((p[0] - range.start) * r)

                insert_line(prev, p, x)

                // Filtering lines that are too near
                let xs = self.xs[self.xs.length - 1] || [0, []]

                if (prev_xs === xs) continue

                if (xs[1][0] - prev_xs[1][0] < self.t_step * 0.8) {

                    // prev_xs is a higher "rank" label
                    if (xs[2] <= prev_xs[2]) {
                        self.xs.pop()
                    } else {
                        // Otherwise
                        self.xs.splice(self.xs.length - 2, 1)
                    }
                }
            }

            // TODO: fix grid extension for bigger timeframes
            if (interval < WEEK && r > 0) {
                extend_left(range.delta, r)
                extend_right(range.delta, r)
            }
        } else {

            self.t_step = master_grid.t_step
            self.px_step = master_grid.px_step
            self.startx = master_grid.startx
            self.xs = master_grid.xs
        }
    }

    function insert_line(prev, p, x, m0) {

        let prev_t = ti_map.ib ? ti_map.i2t(prev[0]) : prev[0]
        let p_t = ti_map.ib ? ti_map.i2t(p[0]) : p[0]

        if (ti_map.tf < DAY) {
            prev_t += timezone * HOUR
            p_t += timezone * HOUR
        }
        let d = timezone * HOUR

        // TODO: take this block =========> (see below)
        if ((prev[0] || interval === YEAR) &&
            Utils.get_year(p_t) !== Utils.get_year(prev_t)) {
            self.xs.push([x, p, YEAR]) // [px, [...], rank]
        }
        else if (prev[0] &&
            Utils.get_month(p_t) !== Utils.get_month(prev_t)) {
            self.xs.push([x, p, MONTH])
        }
        // TODO: should be added if this day !== prev day
        // And the same for 'botbar.js', TODO(*)
        else if (Utils.day_start(p_t) === p_t) {
            self.xs.push([x, p, DAY])
        }
        else if (p[0] % self.t_step === 0) {
// TODO: earlier _we_ had something like this; do we need Utils.t2screen() somewher??
//                if (p[0] % self.t_step === 0) {  // TODO: this check is to make sure candle fits nicely or what?
//                    const x = Utils.t2screen(p[0], range, self.spacex)
//                    self.xs.push([x, p])
            self.xs.push([x, p, interval])
        }
    }

    /**
     * Create bogus filler elements to the left so all space 'til left edge is filled w/ grid
     */
    function extend_left(delta_range, r) {

        if (self.xs.length === 0) return

        let t = self.xs[0][1][0]  // first candle's time
        while (true) {
            t -= self.t_step
            const x = Utils.t2screen(t, range, self.spacex)
// TODO: upstream has for above line:   let x = Math.floor((t  - range[0]) * r)
            if (x < 0) break
            // TODO: ==========> And insert it here somehow
            if (t % interval === 0) {
                self.xs.unshift([x, [t], interval])  // TODO: adding bogus candle to the front?
            }
        }
    }

    /**
     * Create bogus filler elements to the right so all space 'til right edge is filled w/ grid
     */
    function extend_right(delta_range, r) {

        if (self.xs.length === 0 || !isFinite(r)) return

        let t = self.xs[self.xs.length - 1][1][0]
        while (true) {
            t += self.t_step
            const x = Utils.t2screen(t, range, self.spacex)
// TODO: upstream has this for above line:              let x = Math.floor((t  - range[0]) * r)
            if (x > self.spacex) break
            if (t % interval === 0) {
                self.xs.push([x, [t], interval])
            }
        }
    }

    /**
     * calculate grid y coords
     */
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

    function grid_y_log() {

        // TODO: Prevent duplicate levels, is this even
        // a problem here ?
        self.$_mult = dollar_mult()
        self.ys = []

        if (!sub.length) return

        let v = Math.abs(sub[sub.length - 1][1] || 1)
        let y1 = search_start_pos(v)
        let y2 = search_start_neg(-v)
        let yp = -Infinity // Previous y value
        let n = height / $p.config.GRIDY // target grid N

        let q = 1 + (self.$_mult - 1) / 2

        // Over 0
        for (var y$ = y1; y$ > 0; y$ /= self.$_mult) {
            y$ = log_rounder(y$, q)
            let y = Math.floor(math.log(y$) * self.A + self.B)
            self.ys.push([y, Utils.strip(y$)])
            if (y > height) break
            if (y - yp < $p.config.GRIDY * 0.7) break
            if (self.ys.length > n + 1) break
            yp = y
        }

        // Under 0
        yp = Infinity
        for (var y$ = y2; y$ < 0; y$ /= self.$_mult) {
            y$ = log_rounder(y$, q)
            let y = Math.floor(math.log(y$) * self.A + self.B)
            if (yp - y < $p.config.GRIDY * 0.7) break
            self.ys.push([y, Utils.strip(y$)])
            if (y < 0) break
            if (self.ys.length > n * 3 + 1) break
            yp = y
        }

        // TODO: remove lines near to 0

    }

    // Search a start for the top grid so that
    // the fixed value always included
    function search_start_pos(value) {
        let N = height / $p.config.GRIDY // target grid N
        var y = Infinity, y$ = value, count = 0
        while (y > 0) {
            y = Math.floor(math.log(y$) * self.A + self.B)
            y$ *= self.$_mult
            if (count++ > N * 3) return 0 // Prevents deadloops
        }
        return y$
    }

    function search_start_neg(value) {
        let N = height / $p.config.GRIDY // target grid N
        var y = -Infinity, y$ = value, count = 0
        while (y < height) {
            y = Math.floor(math.log(y$) * self.A + self.B)
            y$ *= self.$_mult
            if (count++ > N * 3) break // Prevents deadloops
        }
        return y$
    }

    // Make log scale levels look great again
    function log_rounder(x, quality) {
        let s = Math.sign(x)
        x = Math.abs(x)
        if (x > 10) {
            for (var div = 10; div < MAX_INT; div *= 10) {
                let nice = Math.floor(x / div) * div
                if (x / nice > quality) {  // More than 10% off
                    break
                }
            }
            div /= 10
            return s * Math.floor(x / div) * div
        } else if (x < 1) {
            for (var ro = 10; ro >= 1; ro--) {
                let nice = Utils.round(x, ro)
                if (x / nice > quality) {  // More than 10% off
                    break
                }
            }
            return s * Utils.round(x, ro + 1)
        } else {
            return s * Math.floor(x)
        }
    }

    function apply_sizes() {
        self.width = $p.width - self.sb  // TODO: try to deprecate, same as self.spacex
        //self.height = height  // note this was also commented out, now assigning height prop above where self is declared
    }

    calc_$range()
    calc_sidebar()

    return {
        // First we need to calculate max sidebar width
        // (among all grids). Then we can actually make
        // them
        create: () => {
            calc_positions()
            grid_x()
            if (grid.logScale) {
                grid_y_log()
            } else {
                grid_y()
            }
            apply_sizes()

            // Here we add some helpful functions for
            // plugin creators
            return layout_fn(self, range)
        },

        get_layout: () => self,

        /**
         * override sidebar width
         */
        set_sidebar: v => self.sb = v,

        get_sidebar: () => self.sb,
    }
}

export default GridMaker
