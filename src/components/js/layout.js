// Calculates all necessary s*it to build the chart
// Heights, widths, transforms, ... = everything
// Why such a mess you ask? Well, that's because
// one components size can depend on other component
// data formatting (e.g. grid width depends on sidebar precision)
// So it's better to calc all in one place.

import GridMaker from './grid_maker.js'
import Utils from '../../stuff/utils.js'
import math from '../../stuff/math.js'
import log_scale from './log_scale.js'

/**
 *
 * @param _chart  Chart.vue instance
 * @returns {{botbar: {offset: number, width: *, xs: (*|[]), height: number}, grids: []}}
 * @constructor
 */
function Layout(_chart) {

    const {
        chart, sub, interval, range, ctx, layers_meta,
        ti_map, $props: $p,
        y_transforms: y_ts,
    } = _chart

    const mgrid = chart.grid || {}

    const offsub = _chart.offsub.filter((x, i) => {  // offchart subset
        // Skip offchart overlays with custom grid id,
        // because they will be merged with the existing grids
        return !(x.grid && x.grid.id)
    })

    /**
     * Splits/divides the vertical space between main
     * chart & offchart indicator grids.
     *
     * @returns {Number[]} grid heights of actual px,
     *          eg [main_chart_h, offchart_1_h, ..., offchart_n_h]
     */
    function grid_hs() {

        const height = $p.height - $p.config.BOTBAR  // total height minus bottom bar height

        // When at least one height defined (default = 1),
        // Pxs calculated as: (sum of weights) / number
        if (mgrid.height || offsub.some(x => x.grid.height)) {
            return weighted_hs(mgrid, height)
        }

        const offsub_len = offsub.length
        // TODO: 7? just a random value that looks ok?
        let off_h = (2 * Math.sqrt(offsub_len) / 7) / (offsub_len === 0 ? 1 : offsub_len)  // = offchart height coefficient?

        // single offchart grid height:
        off_h = Math.floor(height * off_h)

        // Main grid height
        const m = [height - off_h * offsub_len]
        return m.concat(Array(offsub_len).fill(off_h))
    }

    /**
     * Get weighted heights?   TODO unsure if true;
     * @param {Object} grid main chart grid
     * @param height {Number} total chart height minus bottom bar height;
     * @returns {number[]}
     */
    function weighted_hs(grid, height) {
        let heights = [{grid}, ...offsub].map(x => x.grid.height || 1)  // here it's really list of height coefficients, later on will be assigned list of heights
        let sum = heights.reduce((a, b) => a + b, 0)
        heights = heights.map(x => Math.floor((x / sum) * height))

        // Refine the height if Math.floor decreased px sum
        sum = heights.reduce((a, b) => a + b, 0)  // total heights as sum of partials
        for (let i = 0; i < height - sum; i++) heights[i % heights.length]++  // randomly grow individual grids' height 'til we match the input height param?
        return heights
    }

    /**
     * calculate candles & positions
     *
     * TODO: unsure about the vol-bar clearing logic
     */
    function candles_n_vol() {
        self.candles = []
        self.volume = []

        const max_vol = Math.max(...sub.map(x => x[5]))
        const vs = $p.config.VOLSCALE * $p.height / max_vol
        const vol_splitter = self.px_step > 5 ? 1 : 0

        let hf_px_step = self.px_step * 0.5
        let prev = null

        for (let i = 0; i < sub.length; i++) {
            const p = sub[i]
            let mid_x;
            switch ($p.gap_collapse) {
                case 2:
                case 3:
                    mid_x = self.startx - self.px_step * i;
                    break;
                default:  // including gap_collapse v1
                    mid_x = Utils.t2screen(p[0], range, self.spacex)
// TODO: upstream has above line as:  mid = self.t2screen(p[0]) + 0.5
                    break;
            }

            self.candles.push(mgrid.logScale ?
                log_scale.candle(self, mid_x, p, $p): {
                x: mid_x,
                w: self.px_step * $p.config.CANDLEW,
                o: Math.floor(p[1] * self.A + self.B),
                h: Math.floor(p[2] * self.A + self.B),
                l: Math.floor(p[3] * self.A + self.B),
                c: Math.floor(p[4] * self.A + self.B),
                raw: p,  // raw candle entity
            })

            // resolve volume-bar coords:
            let x1, x2;
            switch ($p.gap_collapse) {
                case 1:
                case 2:
                case 3:
                    x1 = prev || Math.floor(mid_x + self.px_step * 0.5)
                    x2 = Math.floor(mid_x - self.px_step * 0.5) //- 0.5
                    prev = x2 - vol_splitter
                    break;
                default:  // the old, pre-gap collapsing logic; TODO: deprecate?
                    // Clear volume bar if there is a time gap
                    if (sub[i+1] && p[0] - sub[i+1][0] > interval) {
                        prev = null
                    }

                    x1 = prev || Math.floor(mid_x - hf_px_step)
                    x2 = Math.floor(mid_x + hf_px_step) - 0.5
                    prev = x2 + vol_splitter
                    break;
            }

            self.volume.push({
                x1,
                x2,
                h: p[5] * vs,
                green: p[4] >= p[1],  // check if C equal-or-larger than O
                raw: p
            })
        }
    }

    // Main grid
    const heights = grid_hs()  // array of [chart, offchart_1, offchart_n] heights
    const specs = {
        sub, interval, range, ctx, $p, layers_meta,
        ti_map, height: heights[0],  // main chart height
        y_t: y_ts[0], grid: mgrid, timezone: $p.timezone
    }

    const gms = [new GridMaker(0, specs)]  // init w/ master grid_maker

    // Sub grids
    for (let [i, { data, grid }] of offsub.entries()) {
        specs.sub = data
        specs.height = heights[i + 1]
        specs.y_t = y_ts[i + 1]
        specs.grid = grid || {}
        gms.push(new GridMaker(i + 1, specs, gms[0].get_layout()))
    }

    const sb = Math.max(...gms.map(grid_maker => grid_maker.get_sidebar()))  // effective sidebar width
    const grids = []
    let offset = 0

    for (let i = 0; i < gms.length; i++) {
        gms[i].set_sidebar(sb)
        grids.push(gms[i].create())
        grids[i].id = i
        grids[i].offset = offset
        offset += grids[i].height
    }

    const self = grids[0]  // master grid

    candles_n_vol()

    return {
        grids,
        botbar: {
            width: $p.width,
            height: $p.config.BOTBAR,
            offset,
            xs: grids[0] ? grids[0].xs : []
        }
    }
}

export default Layout
