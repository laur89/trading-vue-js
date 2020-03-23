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
        // TODO: values not displaying if a custom grid id is set:
        // grid: { id: N }
        this.cursor.grid_id = e.grid_id
        let once = true

        for (const grid of this.grids) {
            const c = this.cursor_data(grid, e)
            if (!this.cursor.locked) {
                // TODO: find a better fix to invisible cursor prob
                if (once) {
                    this.cursor.t = this.cursor_time(grid, e, c)
                    //this.cursor.t = c.t  // TODO: should be the commented out line above, but cursor is jumpy! possibly screen2t() is still buggy?

                    if (this.cursor.t) once = false
                }

                if (c.values) {
                    this.comp.$set(this.cursor.values, grid.id, c.values)
                }
            }

            if (grid.id !== e.grid_id) continue
            this.cursor.x = grid.t2screen(this.cursor.t)
            this.cursor.y = c.y
            this.cursor.y$ = c.y$
        }
    }

    overlay_data(grid, e) {

        const s = grid.id === 0 ? 'main_section' : 'sub_section'
        let data = this.comp[s].data

        // Split offchart data between offchart grids
        if (grid.id > 0) {
            // Sequential grids
            let d = data.filter(x => x.grid.id === undefined)
            // grids with custom ids (for merging)
            let m = data.filter(x => x.grid.id === grid.id)
            data = [d[grid.id - 1], ...m]
        }

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

        const xs = data.map(x => grid.t2screen(x[0]) + 0.5)
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
        }
    }

    // Get cursor t-position (extended)
    cursor_time(grid, mouse, candle) {
        switch (this.comp.$props.gap_collapse) {
            case 1: {
                const t = grid.screen2t(mouse.x)
                const r = Math.abs((t - candle.t) / this.comp.interval)

                if (r >= 0.5) {
                    // Outside the data range
                    const sign = Math.sign(t - candle.t)
                    return candle.t + Math.round(r) * this.comp.interval * sign
                }

                // Inside the data range
                return candle.t
            }
            case 2: {
                // TODO
                return candle.t;
            }
        }

    }
}

export default CursorUpdater
