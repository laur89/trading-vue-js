
// DataCube private methods

import Utils from '../stuff/utils.js'
import DCEvents from './dc_events.js'
import { mergeWith } from 'lodash-es';

export default class DCCore extends DCEvents {

    constructor() {
        super()
    }

    // Set TV instance (once). Called by TradingVue itself
    init_tvjs($root) {
        if (this.tv === undefined) {
            this.tv = $root
            this.init_data()
            this.update_ids()
        }
    }

    // Init Data Structure v1.1
    init_data() {

        if (!this.data.hasOwnProperty('chart')) {
            this.tv.$set(this.data, 'chart', {
                type: 'Candles',
                data: this.data.ohlcv || [],  // TODO remove 'this.data.ohlcv' once old data format is fully deprecated
                settings: {}
            })
        } else if (!this.data.chart.hasOwnProperty('settings')) {
            this.tv.$set(this.data.chart, 'settings', {})
        }

        if (!this.data.hasOwnProperty('onchart')) {
            this.tv.$set(this.data, 'onchart', [])
        }

        if (!this.data.hasOwnProperty('offchart')) {
            this.tv.$set(this.data, 'offchart', [])
        }

        // Remove ohlcv cuz we have Data v1.1
        // TODO: remove this line at one point once old data format is fully deprecated:
        delete this.data.ohlcv
    }

    /**
     * Provides a debouncing logic over our onRangeChanged function
     * so it doesn't fire downstream logic too rapidly.
     *
     * First we wait for a base delay time, and then continue sleeping
     * while cursor-lock is enabled.
     * @returns {Promise<void>}
     * @private
     */
    _pauseRangeLogic = async () => {
        await Utils.pause(500)
        while (this.dynamicData.cursorLock) {
            await Utils.pause(50)
        }
    }

    // Range change callback (called by TradingVue event-handler)
    //
    // make sure 'loading' flag is _always_ reset, otherwise our state goes bad!
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
        if (this.dynamicData.loading || this.dynamicData.loadForRange === null ||
            (this.dynamicData.isBeginning && this.dynamicData.isEnd)) return

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

        const range = Object.assign({}, this.dynamicData.rangeToQuery)  // take latest range snapshot to work with
        const d = this.data.chart.data

        let head = Infinity, tail = -Infinity;
        if (d.length !== 0) {
            head = d[0][0]
            tail = d[d.length - 1][0]
        }

        if (this.dynamicData.isHead && !this.unsubIfNeeded(range.end, tail)) {
            // we didn't subscribe, bail here - no reason to continue w/ range_changed logic
            this.dynamicData.loading = false
            return
        } else if (!this.tv.$refs.chart.dc_legend_displayed && range.end < tail - this.dynamicData.timeframe * 100) {  // TODO this check same as in unsubIfNeeded()!
            this.tv.$refs.chart.dc_legend_displayed = true;
        } else if (this.tv.$refs.chart.dc_legend_displayed && range.end >= tail) {
            this.tv.$refs.chart.dc_legend_displayed = false;
        }

        const fetchLookAheadMs = this.dynamicData.fetchLookAhead * this.dynamicData.timeframe
        const fetchTriggerMarginMs = this.dynamicData.fetchTriggerMargin * this.dynamicData.timeframe
        range.start = (!this.dynamicData.isBeginning && range.start - fetchTriggerMarginMs < head)
            ? Math.floor(Math.min(range.start, head) - fetchLookAheadMs)
            : tail
        range.end = (!this.dynamicData.isEnd && range.end + fetchTriggerMarginMs > tail)
            ? Math.ceil(Math.max(range.end, tail) + fetchLookAheadMs)
            : head

        if (range.start < head || range.end > tail) {  // _at least_ one end needs more data
            this.fetchAndProcess(range, head, tail)
        } else {
            // after pause we were within the existing data range,
            // so nothing needed to be pulled
            this.dynamicData.loading = false
        }
    }

    // see if we should un-subscribe from live data if we've 'snapped' back far enough from tail:
    unsubIfNeeded = (rangeTail, tail) => {
        if (this.dynamicData.unsub !== null && rangeTail < tail - this.dynamicData.timeframe * 100) {
            this.dynamicData.isHead = false  // we're no longer keeping up-to-date w/ live events
            this.dynamicData.unsub()
            return true
        }

        return false  // false, ie we did _not_ unsub
    }

    fetchAndProcess = async (range, head, tail) => {
        const fetchDirection = _getFetchDirection(range, head, tail)
        let latch = null
        const cb = data => {
            // Callback way:
            this.chunk_loaded(data, fetchDirection, latch)
        }
        let promises  // 1 or 2 promises, depending on whether we're pulling data for one end or both

        if (fetchDirection === 0) {
            // fetchDirection = 0 means we need to pull data for both ends, ie 2 requests

            latch = Utils.create_latch(2)
            promises = [
                this.dynamicData.loadForRange(head, Math.ceil((head - range.start) / this.dynamicData.timeframe), -1, this.dynamicData.timeframe, cb),
                this.dynamicData.loadForRange(tail, Math.ceil((range.end - tail) / this.dynamicData.timeframe), 1, this.dynamicData.timeframe, cb),
            ]
        } else {  // need to pull data only for either end
            const anchorTime = fetchDirection === 1 ? range.start : range.end;
            const numberOfDataPoints = Math.ceil((range.end - range.start) / this.dynamicData.timeframe)
            promises = [
                this.dynamicData.loadForRange(anchorTime, numberOfDataPoints, fetchDirection, this.dynamicData.timeframe, cb)
            ]
        }

        if (Utils.is_promise(promises[0])) {  // note we're testing promise by only the first element
            // Promise way:
            try {
                for (const data of await Promise.all(promises)) {
                    this.chunk_loaded(data, fetchDirection, latch)
                }
            } catch (e) {  // rejected promise(s), chunk_loaded() never throws
                this.dynamicData.loading = false
            }
        }
    }

    goto_current_tail() {
        const d = this.data.chart.data;
        if (d.length === 0) return;

        //this.tv.goto(d[d.length - 1][0]);
        this.tv.goto({
            e: d[d.length - 1][0],
            c: 2.5,  // leave bit more empty buffer space to the right
        });
    }

    // A new chunk of data is loaded
    chunk_loaded = (data, fetchDirection, latch = null) => {
        try {
            if (Array.isArray(data)) {
                // array means only the main chart is updated
                this.merge('chart.data', data)
            } else if (data !== null && typeof data === 'object') {
                // Bunch of overlays, including chart.data
                this._extract_metadata(data)
                for (const k in data) {
                    this.merge(k, data[k])
                }

                if (this.dynamicData.isHead) {
                    const d = this.data.chart.data
                    const tail = d.length === 0 ? -1 : d[d.length - 1][0]

                    // if the tail of last/latest pulled data is close enough to our visible tail OR
                    // we just pulled the tail (1st req), subscribe to live data feed:
                    if (this.dynamicData.sub !== null && (this.dynamicData.hasOwnProperty('isTail') ||
                            this.dynamicData.rangeToQuery.end >= tail - this.dynamicData.timeframe * 100)) {
                        delete this.dynamicData.isTail

                        // TODO: possibly need invoking via setTimeout/$nextTick only with isTail (ie during very first init), as chart range hasn't been init'd yet
                        this.tv.$nextTick(() => {
                            this.tv.goto(tail)
                            this.dynamicData.sub(tail);  // call sub w/ the latest timestamp we have
                        })
                    } else {
                        this.dynamicData.isHead = false  // reset the just-assigned 'true' value, as we didn't end up subbing for live data
                    }
                }
            }
        } finally {
            if (latch === null || latch.check()) {
                this.truncate_data(fetchDirection)  // truncate before releasing 'loading' lock!
                this.dynamicData.loading = false
            }
        }
    }

    _clear_data = () => {
        this.data.chart.data = [];
        this.data.onchart = [];
        this.data.offchart = [];
    }

    _trunc = (data, fetchDirection) => {
        const unsubIfNeeded = () => {
            if (this.dynamicData.isHead) {
                this.dynamicData.isHead = false  // TODO: set to false only if unsub !== null? (like we do somewhere above)
                if (this.dynamicData.unsub !== null) this.dynamicData.unsub()
            }
        }

        if (data.length > this.dynamicData.maxDatapoints) {
            switch (fetchDirection) {
                case 1:  // truncate from the beginning
                    data.splice(0, data.length - this.dynamicData.maxDatapoints)
                    this.dynamicData.isBeginning = false
                    break;
                case -1:  // truncate from the end
                    data.length = this.dynamicData.maxDatapoints
                    this.dynamicData.isEnd = false
                    unsubIfNeeded()
                    break;
                default: {  // fetchDirection = 0, ie truncate from both ends
                    const trimLen = Math.ceil((data.length - this.dynamicData.maxDatapoints) / 2)
                    data.length = data.length - trimLen
                    data.splice(0, trimLen)

                    this.dynamicData.isBeginning = false
                    this.dynamicData.isEnd = false
                    unsubIfNeeded()
                    break;
                }
            }
        }
    }

    truncate_data = fetchDirection => {
        const f = c => this._trunc(c.data, fetchDirection)

        this._trunc(this.data.chart.data, fetchDirection)
        this.data.onchart.forEach(f)
        this.data.offchart.forEach(f)
    }

    _extract_metadata = chartData => {

        if (chartData.hasOwnProperty('meta')) {
            chartData.meta.markers.forEach(prop => this.dynamicData[prop] = true)  // isEnd, isHead, isBeginning, isTail
            delete chartData.meta  // clean up the metadata as it's not part of the chart payload
        }
    }

    // TODO: do not goto if scroll-lock is enabled! (different from cursor lock)
    // TODO: also pass additional meta-flag indicating when feed has finished, so we know to unsub()?
    received_live_data = data => {

        let d = this.data.chart.data
        const oldTail = d.length === 0 ? -1 : d[d.length-1][0]  // TODO extract into getTail() or something; note tv's chart.vue keeps track of last cnadle as well
        //const trunc = i => Math.ceil(i/this.dynamicData.timeframe) * this.dynamicData.timeframe

        if (Array.isArray(data)) {
            this.merge('chart.data', data)
        } else if (data !== null && typeof data === 'object') {
            for (const k in data) {
                this.merge(k, data[k]);
            }
        } else {
            return
        }

        d = this.data.chart.data
        if (!this.dynamicData.cursorLock && d.length !== 0 && this.dynamicData.rangeToQuery.end >= oldTail) {  // TODO: perhaps (oldTail - couple_of_candles) to allow sliiight scrollback w/o losing goto()?
            this.tv.goto(d[d.length-1][0])
        } else {
            if (this.unsubIfNeeded(this.dynamicData.rangeToQuery.end, d.length === 0 ? -1 : d[d.length-1][0])) {
                this.tv.$refs.chart.dc_legend_displayed = true;
            }
        }

        this.truncate_data(1)
    }

    // TODO: also react to scroll-lock event?
    onCursorLockChanged = isLocked => {
        if (isLocked && !this.dynamicData.cursorLock) {
            this.dynamicData.cursorLock = true
        } else if (!isLocked && this.dynamicData.cursorLock) {
            this.dynamicData.cursorLock = false
            // we don't want to blindly scroll to tail on mouse release, right?:
            //if (this.dynamicData.isHead) {
            //    // move cursor to latest datapoint - we might've
            //    // scrolled slightly away from it:
            //    // TODO: perhaps only scroll back if we had scrolled into the past, and leave future as-is?
            //    const d = this.data.chart.data
            //    if (d.length !== 0) this.tv.goto(d[d.length-1][0]);
            //}
        }
    }

    // Update ids for all overlays
    update_ids() {
        this.data.chart.id = `chart.${this.data.chart.type}`

        for (const on_off of ['onchart', 'offchart']) {
            const type_counts = {}
            for (const ov of this.data[on_off]) {
                if (!type_counts.hasOwnProperty(ov.type)) {
                    type_counts[ov.type] = 0
                }
                const index = type_counts[ov.type]++
                ov.id = `${on_off}.${ov.type}${index}`
                if (!ov.name) ov.name = `${ov.type} ${index}`
                if (!ov.settings) ov.settings = {}
            }
        }
    }

    // Updates all overlays with given values.
    update_overlays(data, t) {
        for (let k in data) {
            if (k === 'price' || k === 'volume' || k === 'candle') {
                continue
            }

            const i = data[k]
            const val = Array.isArray(i) ? i : [i]
            if (!k.includes('.data')) k += '.data'  // TODO: can we replace !includes() w/ !endsWith()?
            this.merge(k, [[t, ...val]])
        }
    }

    on_or_off_chart = side => side === 'onchart' || side === 'offchart';

    // Returns array of objects matching query.
    // Object contains { parent, index, value }
    // TODO: query caching
    get_by_query(query, chuck = false) {

        const tuple = query.split('.')
        let result;

        switch (tuple[0]) {
            case 'chart':
                result = this.chart_as_piv(tuple)
                break
            case 'onchart':
            case 'offchart':
                result = this.query_search(query, tuple)
                break
            default: {
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
        }

        return chuck ? result : result.filter(x => !x.v.locked)
    }

    chart_as_piv([_, field]) {
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

    query_search(query, [side, path = '', field]) {

        return this.data[side].filter(
            x => x.id && x.name && (
                x.id === query ||
                x.id.includes(path) ||
                x.name === query ||
                x.name.includes(path)
            )).map( (x, idx) => {
                if (field) {
                    return {
                        p: x,
                        i: field,  // TODO: index should be field like this?
                        v: x[field]
                    };
                } else {
                    return {
                        p: this.data[side],
                        i: idx,
                        v: x
                    };
                }
            })
    }

    _merge_customizer = (objValue, srcValue, key) => {
        if (Array.isArray(objValue) && Array.isArray(objValue[0]) && objValue[0].length >= 2 && isFinite(objValue[0][0])) {
            return this.merge_ts(objValue, srcValue)
        } else if (this.on_or_off_chart(key)) {  // TODO: deprecate this check? think it's dead code
        // TODO: depends now whether srcVal is arr or obj right?
        }
    }

    merge_objects(obj, data) {
        //window.console.log(` -> 11111 mergin: [${JSON.stringify(obj)}] and [${JSON.stringify(data)}]`)
        const new_obj = Array.isArray(obj.v) ? [] : {}
        this.tv.$set(obj.p, obj.i, mergeWith(new_obj, obj.v, data, this._merge_customizer))
        //window.console.log(` -> 11111 postmrg: [${JSON.stringify(new_obj)}]`)
    }

    // Merge (possibly overlapping) time series;
    // Assume that both input arrays are pre-sorted
    merge_ts(obj, data) {

        if (!data.length) {
            return obj
        } else if (!obj.length) {
            return data
        }

        const r1 = [obj[0][0], obj[obj.length - 1][0]]
        const r2 = [data[0][0], data[data.length - 1][0]]

        const o = [  // Overlap
            Math.max(r1[0], r2[0]),
            Math.min(r1[1], r2[1])
        ]

        if (o[1] >= o[0]) {  // data overlaps

            const { od, d1, d2 } = this.ts_overlap(obj, data, o)

            obj.splice(...d1)
            data.splice(...d2)

            // Dst === Overlap === Src
            if (!obj.length && !data.length) {
                return od
            }

            // If src is totally contained in dst
            if (!data.length) { data = obj.splice(d1[0]) }

            // If dst is totally contained in src
            if (!obj.length) { obj = data.splice(d2[0]) }

            return this.combine(obj, od, data)

        } else {  // no overlap

            return this.combine(obj, [], data)
        }
    }

    // TODO: review performance, move to worker
    ts_overlap(arr1, arr2, [t1, t2]) {

        const filter_mutual_overlap = x => x[0] >= t1 && x[0] <= t2

        const arr1_overlap = arr1.filter(filter_mutual_overlap)
        const arr2_overlap = arr2.filter(filter_mutual_overlap)

        const ts = {}  // overlap range timestamp-to-datapoint map; note arr2 overrides timestamps of arr1

        for (const data_point of arr1_overlap) {
            ts[data_point[0]] = data_point
        }

        for (const data_point of arr2_overlap) {
            ts[data_point[0]] = data_point
        }

        const ts_sorted = Object.keys(ts).sort()

        // Indices of segments
        const arr1_overlap_start_index = arr1.indexOf(arr1_overlap[0])
        const arr1_overlap_end_index = arr1.indexOf(arr1_overlap[arr1_overlap.length - 1])
        const arr2_overlap_start_index = arr2.indexOf(arr2_overlap[0])
        const arr2_overlap_end_index = arr2.indexOf(arr2_overlap[arr2_overlap.length - 1])

        return {
            od: ts_sorted.map(x => ts[x]),  // normalized overlap range of full datapoints
            d1: [arr1_overlap_start_index, arr1_overlap_end_index - arr1_overlap_start_index + 1],
            d2: [arr2_overlap_start_index, arr2_overlap_end_index - arr2_overlap_start_index + 1]
        }
    }

    // Combine parts together:
    // (destination, overlap, source)
    combine(dst, o, src) {

        const last = arr => arr[arr.length - 1][0]
        const max_len_for_push = 100000

        if (!dst.length) { dst = o; o = [] }
        if (!src.length) { src = o; o = [] }

        // TODO: first if-block unreachable?
        if (src[0][0] >= dst[0][0] && last(src) <= last(dst)) {

            return Object.assign(dst, o)

        } else if (last(src) > last(dst)) {

            // Psh(...) is faster but can overflow the stack
            if (o.length < max_len_for_push && src.length < max_len_for_push) {
                dst.push(...o, ...src)
                return dst
            } else {
                return dst.concat(o, src)
            }

        } else if (src[0][0] < dst[0][0]) {

            // Push(...) is faster but can overflow the stack
            if (o.length < max_len_for_push && src.length < max_len_for_push) {
                src.push(...o, ...dst)
                return src
            } else {
                return src.concat(o, dst)
            }
        } else {
            return []
        }
    }
}


// when this function is called, it must've been verified
// by this moment that we need to be fetching data at least in one direction.
const _getFetchDirection = (range, head, tail) => {
    if (range.start === tail) {
        return 1  // we're fetching from future, ie from right hand side
    } else if (range.end === head) {
        return -1  // we're fetching from the past, ie from left hand side
    }

    return 0  // we're fetching for both ends
}
