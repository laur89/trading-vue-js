// Cursor updater: calculates current values for
// OHLCV and all other indicators

import Utils from '../../stuff/utils.js'

class CursorUpdater {

    constructor(chart) {
        this.comp = chart
        this.grids = chart._layout.grids
        this.cursor = chart.cursor
    }

    sync(e) {
        this.cursor.grid_id = e.grid_id
        let once = true

        for (const grid of this.grids) {
            const c = this.cursor_data(grid, e)
            if (!this.cursor.locked) {
                // TODO: find a better fix to invisible cursor prob
                if (once) {
                    this.cursor.t = this.cursor_time(grid, e, c)
                    if (this.cursor.t) once = false
                }

                if (c.values) {
                    this.comp.$set(this.cursor.values, grid.id, c.values)
                }
            }

            if (grid.id !== e.grid_id) continue
            this.cursor.x = c.is_out && Math.abs(e.x - c.x) >= grid.px_step/2
                ? grid.t2screen(this.cursor.t)  // TODO: won't work nice when cursor in left extended area in gap_collapse=2 mode
                : c.x;

            this.cursor.y = c.y
            this.cursor.y$ = c.y$
        }
    }

    overlay_data(grid, e) {

        const s = grid.id === 0 ? 'main_section' : 'sub_section'
        let data = this.comp[s].data

        // Split offchart data between offchart grids
        if (grid.id > 0) data = [data[grid.id - 1]]

        const t = grid.screen2t(e.x)
        const ids = {}, res = {}
        for (const d of data) {
            let ts = d.data.map(x => x[0])
            let i = Utils.nearest_a(t, ts)[0]
            d.type in ids ? ids[d.type]++ : (ids[d.type] = 0)
            res[`${d.type}_${ids[d.type]}`] = d.data[i]
        }

        return res
    }

    // Nearest datapoints
    cursor_data(grid, e) {
        const data = this.comp.main_section.sub

        let xs;
        switch (this.comp.$props.gap_collapse) {
            case 1: {
                xs = data.map(x => grid.t2screen(x[0]) + 0.5)  // TODO: why +0.5?
                break;
            }
            case 2: {
                xs = data.map((_, i) => (grid.startx - grid.px_step * i) + 0.5);  // should we -0.5 instead?
                break;
            }
        }

        const i = Utils.nearest_a(e.x, xs)[0]
        if (!xs[i]) return {}

        return {
            x: Math.floor(xs[i]) - 0.5,
            y: Math.floor(e.y - 2) - 0.5 - grid.offset,
            y$: grid.screen2$(e.y - 2 - grid.offset),
            t: (data[i] || [])[0],
            values: Object.assign({
                ohlcv: grid.id === 0 ? data[i] : undefined
            }, this.overlay_data(grid, e)),
            is_out: i === 0 || i === xs.length-1,  // if our cursor is _possibly_ outside of the data range, ie in extended area
        }
    }

    // Get cursor t-position (extended)
    cursor_time(grid, mouse, candle) {
        const cursor_x_delta_to_nearest = mouse.x - candle.x;
        if (candle.is_out && Math.abs(cursor_x_delta_to_nearest) >= grid.px_step/2) {
            // Outside the data range
            return candle.t + Math.round(cursor_x_delta_to_nearest / grid.px_step) * this.comp.interval
        }

        return candle.t
    }
}

export default CursorUpdater
