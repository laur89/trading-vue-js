
// DataCube "private" methods

import Utils from '../stuff/utils.js'
import DCEvents from './dc_events.js'
import Dataset from './dataset.js'

export default class DCCore extends DCEvents {

    constructor() {
        super()
    }

    // Set TV instance (once). Called by TradingVue itself
    init_tvjs($root) {
        if (!this.tv) {
            this.tv = $root
            this.init_data()
            this.update_ids()

            // Listen to all setting changes
            // TODO: works only with merge()
            this.tv.$watch(() => this.get_by_query('.settings'),
                (n, p) => this.on_settings(n, p))

            // Listen to all indices changes
            this.tv.$watch(() => this.get('.')
                .map(x => x.settings.$uuid),
                (n, p) => this.on_ids_changed(n, p))

            // Watch for all 'datasets' changes
            this.tv.$watch(() => this.get('datasets'),
                Dataset.watcher.bind(this))
        }
    }

    // Init Data Structure v1.1
    init_data() {

        if (!this.data.hasOwnProperty('chart')) {
            this.tv.$set(this.data, 'chart', {
                type: 'Candles',
                data: this.data.ohlcv || []  // TODO remove 'this.data.ohlcv' once old data format is fully deprecated
            })
        }

        if (!this.data.hasOwnProperty('onchart')) {
            this.tv.$set(this.data, 'onchart', [])
        }

        if (!this.data.hasOwnProperty('offchart')) {
            this.tv.$set(this.data, 'offchart', [])
        }

        if (!this.data.chart.settings) {
            this.tv.$set(this.data.chart, 'settings', {})
        }

        // Remove ohlcv cuz we have Data v1.1^
        // TODO: remove this line at one point once old data format is fully deprecated:
        delete this.data.ohlcv
        if (!('datasets' in this.data)) {
            this.tv.$set(this.data, 'datasets', [])
        }

        // Init dataset proxies
        for (var ds of this.data.datasets) {
            if (!this.dss) this.dss = {}
            this.dss[ds.id] = new Dataset(this, ds)
        }

    }

    // Range change callback (called by TradingVue event-handler)
    //
    // TODO:
    // a) requests chunks in certain/predictable steps to allow caching server responses;
    // b) we need to re-set isEnd/isBeginning back to false if DC data is truncated;
    // c) where to handle truncating? here?
    // d) (semi-done) where/how to handle snapping to isHead to subscribe to live updates?
    // e) deprecate REST interface and do everything over socket?
    range_changed = async (r, tf) => {

        // keep updating the range & tf we should be pulling data for with next fetch:
        this.dynamicData.rangeToQuery = r;
        this.dynamicData.timeframe = tf;
        if (this.dynamicData.loading || this.dynamicData.loadForRange === null || (this.dynamicData.isBeginning && this.dynamicData.isEnd)) return

        this.dynamicData.loading = true  // avoid simultaneous processing

        //  TODO: not sure sleeping is what we want to do here;
        // consider lodash.debounce instead (w/ options.trailing = true);
        // note there might be some issues w/ debounce considering it's an async fun;
        // eg see https://stackoverflow.com/a/50837389;
        // (perhaps debounce this.dynamicData.loadForRange instead?)
        //
        // maybe https://github.com/szchenghuang/debounce-async#readme instead of lodash?
        // in this case it should be noted that the promises returned by this function
        // would get rejected during debouncing, which _might_ affect vue adversely.

        // Sleep to allow bigger chunks; note the range we're working against is
        // allowed to be updated above, effectively simulating debounce:
        await this._pauseRangeLogic()

        const range = this.dynamicData.rangeToQuery.slice(0)  // take latest range snapshot
        const d = this.data.chart.data

        let head = Infinity, tail = -Infinity;
        if (d.length !== 0) {
            head = d[0][0]
            tail = d[d.length - 1][0]
        }

        range[0] = range[0] < head ? Math.floor(range[0]) : tail
        range[1] = range[1] > tail ? Math.ceil(range[1]) : head

        // make sure 'loading' flag is _always_ reset, otherwise our state goes bad!
        if (this.dynamicData.isHead) {
            // see if we should un-subscribe from live data if we've 'snapped' back far enough from tail:
            if (d.length !== 0 && range[1] < tail - this.dynamicData.timeframe * 5) {
                this.dynamicData.isHead = false  // we're no longer keeping up-to-date w/ live events
                if (this.dynamicData.unsub !== null) this.dynamicData.unsub()
            }

            this.dynamicData.loading = false
        } else if (range[0] < head || range[1] > tail) {
            // TODO: split requests into 2 in case we need to get both tail & head - currently we'd be
            // re-fetching existing data; this would be the case when user zooms out (or maybe resizes window)

            // TODO: handle fetchDirection=0 case where one of the ends might've been reached;
            const fetchDirection = _getFetchDirection(range, head, tail)
            if ((this.dynamicData.isBeginning && fetchDirection === -1) || (this.dynamicData.isEnd && fetchDirection === 1)) {
                this.dynamicData.loading = false
                return
            }

            // TODO: document that loader should return null when using callback.
            // note it's users' responsibility to make sure callback is invoked, no matter what!
            const prom = this.dynamicData.loadForRange(range, this.dynamicData.timeframe, d => {
                // Callback way:
                this.chunk_loaded(d)
            })

            if (prom !== null && typeof prom === 'object' && typeof prom.then === 'function') {
                // Promise way:
                try {
                    this.chunk_loaded(await prom)
                } catch (e) {  // rejected promise, chunk_loaded() never throws
                    this.dynamicData.loading = false
                }
            }
        } else {
            // after pause we were within the existing data range,
            // so nothing needed to be pulled
            this.dynamicData.loading = false
        }
    }

    // A new chunk of data is loaded
    chunk_loaded = data => {
        try {
            if (Array.isArray(data)) {
                // array means only the main chart is updated
                this.merge('chart.data', data)
            } else if (data !== null && typeof data === 'object') {
                // Bunch of overlays, including chart.data
                this._updateLastFetchedRange(data)
                for (const k in data) {
                    this.merge(k, data[k])
                }

                if (this.dynamicData.isHead) {
                    if (this.dynamicData.sub !== null) {
                        let d = this.data.chart.data
                        d = d.length === 0 ? -1 : d[d.length - 1][0]
                        this.dynamicData.sub(d);  // call sub w/ the latest timestamp we have
                    } else {
                        this.dynamicData.isHead = false  // reset the just-assigned 'true' value, as we're not subscribed for live data
                    }
                }
            }
        } finally {
            this.dynamicData.loading = false
        }
    }

    _updateLastFetchedRange = chartData => {

        ['isBeginning', 'isEnd', 'isHead'].forEach(prop => {
            if (chartData.hasOwnProperty(prop)) {
                this.dynamicData[prop] = chartData[prop]
                delete chartData[prop]  // clean up the metadata as it's not part of the chart
            }
        })
    }

    // TODO: does not need be async, right?
    received_live_data = data => {

        if (Array.isArray(data)) {
            this.merge('chart.data', data)
        } else if (data !== null && typeof data === 'object') {
            for (const k in data) {
                this.merge(k, data[k]);
            }
        } else {
            return
        }

        const d = this.data.chart.data
        if (!this.dynamicData.scrollLock && d.length !== 0) {
            this.tv.goto(d[d.length-1][0]);
        }
    }

    // TODO: debounce? or do we need to handle those click&pan double events?
    onCursorLockChanged = isLocked => {
        if (isLocked && !this.dynamicData.scrollLock) {
            this.dynamicData.scrollLock = true
        } else if (!isLocked && this.dynamicData.scrollLock) {
            this.dynamicData.scrollLock = false
            if (this.dynamicData.isHead) {
                // move cursor to latest datapoint - we might've
                // scrolled slightly away from it:
                // TODO: perhaps only scroll back if we had scrolled into the past, and leave future as-is?
                const d = this.data.chart.data
                if (d.length !== 0) this.tv.goto(d[d.length-1][0]);
            }
        }
    }

    // Update ids for all overlays
    update_ids() {
        const process = (ov, onOrOffChart) => {
            if (!typeCounts.hasOwnProperty(ov.type)) {
                typeCounts[ov.type] = 0
            }
            const i = typeCounts[ov.type]++
            ov.id = `${onOrOffChart}.${ov.type}${i}`
            if (!ov.name) ov.name = ov.type + ` ${i}`
            if (!ov.settings) this.tv.$set(ov, 'settings', {})
        }

        this.data.chart.id = `chart.${this.data.chart.type}`

        let typeCounts = {}
        for (const ov of this.data.onchart) {
            process(ov, 'onchart')
        }

        typeCounts = {}  // reset
        let grids = [{}]
        let gid = 0
        for (const ov of this.data.offchart) {
            process(ov, 'offchart')
            // grid_id,layer_id => DC id mapping
            gid++
            let rgid = (ov.grid || {}).id || gid // real grid_id
            // When we merge grid, skip ++
            if ((ov.grid || {}).id) gid--
            if (!grids[rgid]) grids[rgid] = {}
            if (grids[rgid][ov.type] === undefined) {
                grids[rgid][ov.type] = 0
            }
            let ri = grids[rgid][ov.type]++
            this.gldc[`g${rgid}_${ov.type}_${ri}`] = ov.id
            this.dcgl[ov.id] = `g${rgid}_${ov.type}_${ri}`
        }
    }

    // TODO: chart refine (from the exchange chart)
    update_candle(data) {
        let ohlcv = this.data.chart.data
        let last = ohlcv[ohlcv.length - 1]
        let candle = data['candle']
        let tf = this.tv.$refs.chart.interval_ms
        let t_next = last[0] + tf
        let now = data.t || Utils.now()
        let t = now >= t_next ? (now - now % tf) : last[0]

        // Update the entire candle
        if (candle.length >= 6) {
            t = candle[0]
        } else {
            candle = [t, ...candle]
        }

        this.agg.push('ohlcv', candle)
        this.update_overlays(data, t, tf)
        return t >= t_next

    }

    update_tick(data) {
        let ohlcv = this.data.chart.data
        let last = ohlcv[ohlcv.length - 1]
        let tick = data['price']
        let volume = data['volume'] || 0
        let tf = this.tv.$refs.chart.interval_ms
        if (!tf) {
            return console.warn('Define the main timeframe')
        }
        let now = data.t || Utils.now()
        if (!last) last = [now - now % tf]
        let t_next = last[0] + tf

        let t = now >= t_next ? (now - now % tf) : last[0]

        if ((t >= t_next || !ohlcv.length) && tick !== undefined) {
            // And new zero-height candle
            let nc = [t, tick, tick, tick, tick, volume]
            this.agg.push('ohlcv', nc, tf)
            ohlcv.push(nc)
            this.scroll_to(t)

        } else if (tick !== undefined) {
            // Update an existing one
            // TODO: make a separate class Sampler
            last[2] = Math.max(tick, last[2])
            last[3] = Math.min(tick, last[3])
            last[4] = tick
            last[5] += volume
            this.agg.push('ohlcv', last, tf)
        }
        this.update_overlays(data, t, tf)
        return t >= t_next
    }

    // Updates all overlays with given values.
    update_overlays(data, t, tf) {
        for (var k in data) {
            if (k === 'price' || k === 'volume' ||
                k === 'candle' || k === 't') {
                continue
            }

            const i = data[k]
            const val = Array.isArray(i) ? i : [i]
            if (!k.includes('.data')) k += '.data'
            this.agg.push(k, [t, ...val], tf)
        }
    }

    // Returns array of objects matching query.
    // Object contains { parent, index, value }
    // TODO: query caching
    get_by_query(query, chuck) {

        let tuple = query.split('.')
        let result;

        switch (tuple[0]) {
            case 'chart':
                result = this.chart_as_piv(tuple)
                break
            case 'onchart':
            case 'offchart':
                result = this.query_search(query, tuple)
                break
            case 'datasets':
                result = this.query_search(query, tuple)
                for (var r of result) {
                    if (r.i === 'data') {
                        r.v = this.dss[r.p.id].data()
                    }
                }
                break
            default:
                /* TODO: Should get('.') return also the chart? */
                /*let ch = this.chart_as_query([
                    'chart',
                    tuple[1]
                ])*/
                const onChart = this.query_search(query, [
                    'onchart',
                    tuple[0],
                    tuple[1]
                ])
                const offChart = this.query_search(query, [
                    'offchart',
                    tuple[0],
                    tuple[1]
                ])
                result = [/*ch[0],*/ ...onChart, ...offChart]
                break
        }
        return result.filter(
            x => !(x.v || {}).locked || chuck)
    }

    chart_as_piv(tuple) {
        const field = tuple[1]
        if (field) {
            return [{
                p: this.data.chart,
                i: field,
                v: this.data.chart[field]
            }]
        }

        return [{
            p: this.data,
            i: 'chart',
            v: this.data.chart
        }]
    }

    query_search(query, tuple) {

        const side = tuple[0]
        const path = tuple[1] || ''
        const field = tuple[2]

        let arr = this.data[side].filter(x => (
            x.id === query ||
            (x.id && x.id.includes(path)) ||
            x.name === query ||
            (x.name && x.name.includes(path)) ||
            query.includes((x.settings || {}).$uuid)
        ))

        if (field) {
            return arr.map(x => ({
                p: x,
                i: field,
                v: x[field]
            }))
        }

        return arr.map((x, i) => ({
            p: this.data[side],
            i: this.data[side].indexOf(x),
            v: x
        }))
    }

    merge_objects(obj, data, new_obj = {}) {

        // The only way to get Vue to update all stuff
        // reactively is to create a brand new object.
        // TODO: Is there a simpler approach?
        Object.assign(new_obj, obj.v)
        Object.assign(new_obj, data)
        this.tv.$set(obj.p, obj.i, new_obj)
    }

    // Merge overlapping time series
    merge_ts(obj, data) {

        // Assume that both arrays are pre-sorted

        if (!data.length) return obj.v

        const r1 = [obj.v[0][0], obj.v[obj.v.length - 1][0]]
        const r2 = [data[0][0],  data[data.length - 1][0]]

        // Overlap
        const o = [Math.max(r1[0], r2[0]), Math.min(r1[1], r2[1])]

        if (o[1] >= o[0]) {

            const { od, d1, d2 } = this.ts_overlap(obj.v, data, o)

            obj.v.splice(...d1)
            data.splice(...d2)

            // Dst === Overlap === Src
            if (!obj.v.length && !data.length) {
                this.tv.$set(obj.p, obj.i, od)
                return obj.v
            }

            // If src is totally contained in dst
            if (!data.length) { data = obj.v.splice(d1[0]) }

            // If dst is totally contained in src
            if (!obj.v.length) { obj.v = data.splice(d2[0]) }

            this.tv.$set(
                obj.p, obj.i, this.combine(obj.v, od, data)
            )

        } else {

            this.tv.$set(
                obj.p, obj.i, this.combine(obj.v, [], data)
            )
        }

        return obj.v
    }

    // TODO: review performance, move to worker
    ts_overlap(arr1, arr2, range) {

        const t1 = range[0]
        const t2 = range[1]

        const ts = {}  // timestamp map
        const filter = x => x[0] >= t1 && x[0] <= t2

        const a1 = arr1.filter(filter)
        const a2 = arr2.filter(filter)

        // Indices of segments
        const id11 = arr1.indexOf(a1[0])
        const id12 = arr1.indexOf(a1[a1.length - 1])
        const id21 = arr2.indexOf(a2[0])
        const id22 = arr2.indexOf(a2[a2.length - 1])

        for (let i = 0; i < a1.length; i++) {
            ts[a1[i][0]] = a1[i]
        }

        for (let i = 0; i < a2.length; i++) {
            ts[a2[i][0]] = a2[i]
        }

        const ts_sorted = Object.keys(ts).sort()

        return {
            od: ts_sorted.map(x => ts[x]),
            d1: [id11, id12 - id11 + 1],
            d2: [id21, id22 - id21 + 1]
        }
    }

    // Combine parts together:
    // (destination, overlap, source)
    combine(dst, o, src) {

        const last = arr => arr[arr.length - 1][0]

        if (!dst.length) { dst = o; o = [] }
        if (!src.length) { src = o; o = [] }

        // The overlap right in the middle
        if (src[0][0] >= dst[0][0] && last(src) <= last(dst)) {

            return Object.assign(dst, o)

        // The overlap is on the right
        } else if (last(src) > last(dst)) {

            // Psh(...) is faster but can overflow the stack
            if (o.length < 100000 && src.length < 100000) {
                dst.push(...o, ...src)
                return dst
            } else {
                return dst.concat(o, src)
            }

        // The overlap is on the left
        } else if (src[0][0] < dst[0][0]) {

            // Push(...) is faster but can overflow the stack
            if (o.length < 100000 && src.length < 100000) {
                src.push(...o, ...dst)
                return src
            } else {
                return src.concat(o, dst)
            }
        } else {
            return []
        }
    }

    // Simple data-point merge (faster)
    fast_merge(data, point, main = true) {

        if (!data) return

        let last_t = (data[data.length - 1] || [])[0]
        let upd_t = point[0]

        if (!data.length || upd_t > last_t) {
            data.push(point)
            if (main && this.sett.auto_scroll) {
                this.scroll_to(upd_t)
            }
        } else if (upd_t === last_t) {
            if (main) {
                this.tv.$set(data, data.length - 1, point)
            } else {
                data[data.length - 1] = point
            }
        }

    }

    scroll_to(t) {
        if (this.tv.$refs.chart.cursor.locked) return
        let last = this.tv.$refs.chart.last_candle
        if (!last) return
        let tl = last[0]
        let d = this.tv.getRange()[1] - tl
        if (d > 0) this.tv.goto(t + d)
    }
}


// when this function is called, it must've been verified
// by this moment that we need to be fetching data at least in one direction
const _getFetchDirection = (range, head, tail) => {
    if (range[0] === tail) {
        return 1  // we're fetching from future
    } else if (range[1] === head) {
        return -1  // we're fetching from the past
    }

    return 0  // we're fetching for both ends
}
