// Layout functional interface

import Utils from '../../stuff/utils.js'

export default function(self, range) {

    Object.assign(self, {
        // Time to screen coordinates
        t2screen: t => {
            return Utils.t2screen(t, range, self.spacex) - 0.5  // TODO: why -0.5?
        },
        // $ to screen coordinates
        $2screen: y => {
            return Math.floor(y * self.A + self.B) - 0.5
        },
        // Time-axis nearest step
        t_magnet: t => {
            const cn = self.candles || self.master_grid.candles
            const arr = cn.map(x => x.raw[0])
            const i = Utils.nearest_a(t, arr)[0]
            if (!cn[i]) return
            return Math.floor(cn[i].x) - 0.5
        },
        // Screen-Y to dollar value (or whatever)
        screen2$: y => {
            const range = self.height
            const range$ = self.$_hi - self.$_lo
            const y$ = (range - y) * (range$ / range)
            return self.$_lo + y$
        },
        // Screen-X to timestamp
        screen2t: x => {
            const r = self.spacex / range.delta
            let t = Math.floor(range.start + x / r)

            if (range.gaps !== null) {
                for (const gap of range.gaps) {
                    if (t > gap.start) t += gap.delta  // t>start, _not_ t>= right?
                }
            }

            return t
        },
        // $-axis nearest step
        $_magnet: price => { },
        // Nearest candlestick
        c_magnet: t => {
            const cn = self.candles || self.master_grid.candles
            const arr = cn.map(x => x.raw[0])
            const i = Utils.nearest_a(t, arr)[0]
            return cn[i]
        },
        // Nearest data points
        data_magnet: t => {  /* TODO: implement */ }
    })

    return self
}
