import Const from '../../stuff/constants.js'
import Utils from '../../stuff/utils.js'

import layout_fn from './layout_fn.js'

const { TIMESCALES, $SCALES, WEEK } = Const

// master_grid - ref to the master grid
function GridMaker(id, params, master_grid = null) {

    const {
        sub, interval, range, ctx, $p, layers_meta, height, y_t
    } = params

    const self = {  // layout object? what's the semantics between 'layout' and 'grid'?
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
    }

    const lm = layers_meta[id]
    let y_range_fn = undefined

    if (lm !== null && typeof lm === 'object' && Object.keys(lm).length !== 0) {
        // Gets last y_range fn()
        y_range_fn = Object.values(lm)
            .reverse()
            .find(x => x.hasOwnProperty('y_range') && typeof x.y_range === 'function')
        // TODO: what is y_rnage for? to customize the range for our offchart?
    }

    // Calc vertical ($/₿) range
    function calc_$range() {
        // Fixed y-range in non-auto mode
        if (y_t && !y_t.auto && y_t.range) {
            self.$_hi = y_t.range[0]
            self.$_lo = y_t.range[1]
        } else {
            let hi, lo;  // H & L price extremes

            if (master_grid === null) {  // ie we _are_ the master grid
                // $ candlestick range
                hi = Math.max(...sub.map(x => x[2]))  // high
                lo = Math.min(...sub.map(x => x[3]))  // low

            } else {  // Offchart indicator range
                const dim = sub.length !== 0 ? sub[0].length : 0  // # of elements in a candle/data structure?
                const arr = []
                for (let i = 1; i < dim; i++) {  // we start at index 1 to avoid time values as those time is not related to price?
                    arr.push(...sub.map(x => x[i])
                        .filter(x => typeof x === 'number')  // TODO: is this typeof check necessary?
                    )
                }

                hi = Math.max(...arr)
                lo = Math.min(...arr)

                if (y_range_fn !== undefined) {
                    [hi, lo] = y_range_fn.y_range(hi, lo)
                }
            }

            self.$_hi = hi + (hi - lo) * $p.config.EXPAND
            self.$_lo = lo - (hi - lo) * $p.config.EXPAND

            if (self.$_hi === self.$_lo) {
                self.$_hi *= 1.05  // Expand if height range === 0
                self.$_lo *= 0.95
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

        self.prec = calc_precision()
        const lens = sub.filter(x => typeof x[1] === 'number')
                        .map(x => x[1].toFixed(self.prec).length)

        const str = '0'.repeat(Math.max(...lens)) + '    '

        self.sb = ctx.measureText(str).width
        self.sb = Math.max(Math.floor(self.sb), $p.config.SBMIN)
    }

    // Calculate $ precision for the Y-axis
    // TODO: what does the return value really signify?
    function calc_precision() {

        let max_r = 0, max_l = 0  // max_{right,left} part (decimal being the separator); note they're not absolute values but length of digits

        // Get max lengths of integer and fractional parts
        sub.forEach(x => {
            const open_as_str = x[1].toString()  // index 1 = open price;
            let l, r;

            if (x[1] < 0.000001) {
                // Parsing the exponential form. Gosh this smells trickily
                const [ls, rs] = open_as_str.split('e-');
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
        self.A = -height / (self.$_hi - self.$_lo)
        self.B = -self.$_hi * self.A
    }

    // Select nearest good-looking t step (m is target scale)
    function time_step(delta_range) {
        const m = delta_range * ($p.config.GRIDX / $p.width)

        return Utils.nearest_a(m, TIMESCALES)[1]
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

    /**
     * calculate grid x-coords
     */
    function grid_x() {

        // If this is a subgrid, no need to calc a timeline,
        // we just borrow it from the master_grid:
        if (master_grid === null) {

            self.t_step = time_step(range.delta)
            self.xs = []

            for (let i = 0; i < sub.length; i++) {
                const p = sub[i]
                if (p[0] % self.t_step === 0) {  // TODO: this check is to make sure candle fits nicely or what?
                    const x = Utils.t2screen(p[0], range, self.spacex)
                    self.xs.push([x, p])
                }
            }

            // TODO: fix grid extension for bigger timeframes
            const r = self.spacex / range.delta  // ms per 1px
            if (interval < WEEK && isFinite(r)) {
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

    /**
     * Create bogus filler elements to the left so all space 'til left edge is filled w/ grid
     */
    function extend_left() {

        if (self.xs.length === 0) return

        let t = self.xs[0][1][0]  // first candle's time
        while (true) {
            t -= self.t_step
            const x = Utils.t2screen(t, range, self.spacex)
            if (x < 0) break
            if (t % interval === 0) {
                self.xs.unshift([x, [t]])  // TODO: adding bogus datapoint to the front?
            }
        }
    }

    /**
     * Create bogus filler elements to the right so all space 'til right edge is filled w/ grid
     */
    function extend_right() {

        if (self.xs.length === 0) return

        let t = self.xs[self.xs.length - 1][1][0]
        while (true) {
            t += self.t_step
            const x = Utils.t2screen(t, range, self.spacex)
            if (x > self.spacex) break
            if (t % interval === 0) {
                self.xs.push([x, [t]])
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

    // TODO: why's this needed? just so vue would pick something up?
    function apply_sizes() {
        self.width = $p.width - self.sb  // TODO: try to deprecate, same as self.spacex
        //self.height = height  // note this was also commented out, now assigning height prop above where self is declared
    }

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
