
import IndexedArray from 'arrayslicer'
import Const from './constants';
const { WKD_GAP_DURATION } = Const

export default {

    /**
     * Makes sure given {@code num} is within the given
     * limits: {@code min} <= num <= {@code max}
     */
    clamp(num, min, max) {
        return num <= min ? min : (num >= max ? max : num)
    },

    add_zero(i) {
        if (i < 10) {
            i = '0' + i;
        }
        return i
    },

    // Start of the day (zero millisecond)
    day_start(t) {
        const start = new Date(t)
        start.setHours(0,0,0,0)
        return start.getTime()
    },

    // Start of the month
    month_start(t) {
        const date = new Date(t)
        const start = new Date(
            date.getFullYear(),
            date.getMonth(), 1
        )
        return start.getTime()
    },

    // Start of the year
    year_start(t) {
        return new Date(new Date(t).getFullYear(), 0, 1).getTime()
    },

    /**
     * Nearest in array
     *
     * @param {Number} x
     * @param {Number[]} array
     * @returns {number[]}
     */
    nearest_a(x, array) {
        let dist = Infinity
        let val = null
        let index = -1

        for (let i = 0; i < array.length; i++) {
            const xi = array[i]
            const abs_dist = Math.abs(xi - x)

            if (abs_dist < dist) {
                dist = abs_dist
                val = xi
                index = i
            }
        }

        return [index, val]
    },

    round(num, decimals = 8) {
        return parseFloat(num.toFixed(decimals))
    },

    // Strip? No, it's ugly floats in js
    strip(number) {
        return parseFloat(
            parseFloat(number).toPrecision(12)
        )
    },

    get_day(t) {
        return t ? new Date(t).getDate() : null
    },

    // Update array keeping the same reference
    overwrite(arr, new_arr) {
        arr.splice(0, arr.length, ...new_arr)
    },

    // Copy layout in reactive way
    copy_layout(obj, new_obj) {
        for (const k in obj) {
            const o = obj[k];

            if (Array.isArray(o)) {
                // (some offchart indicators are added/removed)
                // we need to update layout in a reactive way
                if (o.length !== new_obj[k].length) {
                    this.overwrite(o, new_obj[k])
                    continue
                }

                for (const m in o) {
                    Object.assign(o[m], new_obj[k][m])
                }
            } else {
                Object.assign(o, new_obj[k])
            }
        }
    },

    // Checks if the ohlcv data is changed (given the new
    // and old/previous dataset values)
    // TODO: remove old datatype support once old format is deprecated!
    // TODO: always returns false??
    data_changed(n, p) {
        n = n.ohlcv || (n.chart ? n.chart.data : []) || []
        p = p.ohlcv || (p.chart ? p.chart.data : []) || []
        return n.length !== p.length && n[0] !== p[0]  // TODO: array reference comparison is ok here?

        //return (n.length !== p.length) || (n[0][0] !== p[0][0])
    },

    // Detects candles interval.
    // Note this algorithm allows missing data-points, as those
    // would cause interval to be larger than expected, and would
    // be ignored; it's duplicate datapoints & negative deltas
    // that cause issues.
    detect_interval(ohlcv) {
        const len = Math.min(ohlcv.length - 1, 99)
        let min = Infinity
        ohlcv.slice(0, len).forEach((x, i) => {
            const diff = ohlcv[i+1][0] - x[0]
            if (diff < min) min = diff
        })
        return min
    },

    // Gets numberic part of overlay id (e.g 'EMA_1' = > 1)
    get_num_id(id) {
        return parseInt(id.split('_').pop())
    },

    // Fast filter. Really fast, like 10X
    fast_filter(arr, t1, t2) {
        if (arr.length === 0) return arr
        return new IndexedArray(arr, '0').getRange(t1, t2).reverse();
    },

    // Fast filter (index-based)
    fast_filter_i(arr, range, movement) {
        if (arr.length === 0) {
            return {
                ...range,
                data: [],
            }
        }

        let i1, i2, start, end;
        if (Array.isArray(movement)) {
            [i1, i2] = movement;
            start = range.start + i1;
            end = range.end + i2;
            i1 = Math.floor(start - 1);  // note -1 here is "-this.interval" upstream (@Chart.vue)
            if (i1 < 0) i1 = 0;
            i2 = Math.floor(end + 1);  // TODO: always add 1?
        } else {  // typeof movement == number|object // TODO: object usage not supported, not yet anyway!
            end = range.end + movement;
            start = end - range.delta;
            i2 = Math.floor(end + 1);  // TODO: always add 1?
            i1 = Math.floor(i2 - range.delta);
            if (i1 < 0) i1 = 0;
        }

        return {
            start_index: i1,
            start,  // for range
            end,  // for range
            delta: end - start,  // for range
            data: arr.slice(i1, i2),
        };
    },

    // Nearest indexes (left and right)
    fast_nearest(arr, t1) {
        const ia = new IndexedArray(arr, '0').fetch(t1)
        return [ia.nextlow, ia.nexthigh]
    },


    /**
     * Define & return {
     *     start: timestamp,
     *     end: timestamp,
     *     gaps: null | [gaps],  // null if no gaps, otherwise chronologically ordered array
     *     delta: full timespan from start to end minus gaps,
     *     data: array of candles from {@code arr} that fall into start-end range
     * }
     *
     * @param arr raw candle array to grab a subset from
     * @param range our range object defining _current_ range (that will be modified after we're called)
     * @param {number|array<number>} movement  either a number stating the timestamp where our end (ie
     *                               right-hand side) should be placed, or array of two elements:
     *                               [start-delta-in-ms, end-delta-in-ms], ie array defining how much
     *                               and in which direction our start & end points should be shifted.
     * @param interval
     * @param data_gaps full weekend gaps for the given {@code arr}
     * @returns {data: *, start: *, delta: number, end: *, gaps: *}
     */
    fast_f(arr, range, movement, interval, data_gaps) {
        if (arr.length === 0) {
            return {
                ...range,
                data: arr,
            }
        }

        let start, end, data, gaps;
        if (Array.isArray(movement)) {
            [ start, end, gaps, data ] = this.fast_f_for_range(arr, range, movement, interval, data_gaps);
        } else {  // typeof movement == 'number'
            [ start, end, gaps, data ] = this.fast_f_for_end_timestamp(arr, range, movement, interval, data_gaps);
            range.gaps = null  // reset, previous gaps mean nothing
        }

        // if we were previously (possibly still) spanning gap(s),
        // merge those existing ones with the newly defined:
        if (range.gaps !== null) {
            const rg = range.gaps.slice(0)  // TODO: unsure if taking a snapshot here is necessary

            // clean up gaps we've passed, ie remove gaps that are no longer in our view:
            for (let i = rg.length-1; i >= 0; i--) {
                if (!(start < rg[i].start && end > rg[i].end)) {
                    rg.splice(i, 1);
                }
            }

            gaps.forEach(g => this.push_gap_if_unique(rg, g))
            gaps = rg
        }

        gaps = gaps.length === 0 ? null : gaps

        let delta = end - start
        if (gaps !== null) {
            for (const gap of gaps) delta -= gap.delta
            gaps.sort((a, b) => a.start - b.start)
        }

        return {start, end, gaps, delta, data};
    },

    _is_gap(gap_delta, interval, gap_collapse_mode) {
        if (gap_collapse_mode === 2) {
            return gap_delta > interval;  // in gap_collapse=2 mode we collapse _all_ gaps
        } else {
            return gap_delta > WKD_GAP_DURATION;  // in gap_collapse=1 mode, we explicitly define what duration qualifies as a collapsable gap
        }
    },

    /**
     * Resolve all existing weekend gaps in given {@code data}
     * and return them.
     * Note the returned array of gaps will be chronologically ordered.
     *
     * TODO: as per C451's recommendation, gaps for the entirety of main data
     * should be resolved in subset() on-demand, and for the _estimated_
     * range only; if it's done for the full data-set as now,
     * then 1mil+ datapoint sets will likely start slowing things down.
     *
     * @param data our main chart dataset (full)
     * @param interval
     * @returns {[gaps]}
     */
    resolve_gaps(data, interval, gap_collapse_mode) {
        const gaps = [];
        let start = data.length !== 0 ? data[data.length-1][0] : -1;

        //for (let i = 1; i < data.length; i++) {
        for (let i = data.length-2; i >= 0; i--) {
            const end = data[i][0];
            if (this._is_gap(end - start, interval, gap_collapse_mode)) {
                gaps.push({
                    start,
                    end,
                    delta: end - start - interval,
                })
            }

            start = end
        }

        return gaps;
    },

    is_in_gap(gap, t) {
        return t > gap.start && t < gap.end;
    },

    /**
     * Add given {@code gap} in {@code gaps} array if latter
     * doesn't contain it already.
     * @param gaps
     * @param gap
     */
    push_gap_if_unique(gaps, gap) {
        if (!gaps.some(g => g.start === gap.start /*&& g.end === gap.end*/)) {
            gaps.push(gap);
        }
    },

    /**
     * Define & return {
     *     start: timestamp,
     *     end: timestamp,
     *     gaps: null | [gaps],
     *     data: array of candles from {@code arr} that fall into start-end range
     * }
     *
     * @param arr raw candle array to grab a subset from
     * @param range our range object defining _current_ range (that will be modified after we're called)
     * @param {array<number>} movement
     *                               [start-delta-in-ms, end-delta-in-ms], ie array defining how much
     *                               and in which direction our start & end points should be shifted.
     * @param interval
     * @param data_gaps full weekend gaps for the given {@code arr}
     * @returns {[start: *, end: *, gaps: *, data: *]}
     */
    fast_f_for_range(arr, range, movement, interval, data_gaps) {

        const define_start = (prev_start, start_delta) => {
            let start = prev_start + start_delta;

            if (data_gaps.length !== 0) {
                const sign = Math.sign(start_delta);

                if (start_delta < 0) {  // moving backwards
                    for (let i = data_gaps.length-1; i >= 0; i--) {
                        const gap = data_gaps[i];

                        if (start <= gap.start && prev_start >= gap.end) {  // if gap fits entirely within our view
                            start += gap.delta * sign
                            prev_start += gap.delta * sign
                            this.push_gap_if_unique(gaps, gap)
                        } else if (this.is_in_gap(gap, start)) {  // if our target landed _in_ the gap
                            start = gap.start + (start_delta + (prev_start - gap.end));
                            this.push_gap_if_unique(gaps, gap)
                            //break
                        }
                    }
                } else {  // moving fwd
                    for (const gap of data_gaps) {
                        if (start >= gap.end && prev_start <= gap.start) {  // if gap fits entirely within our view
                            start += gap.delta * sign
                            prev_start += gap.delta * sign
                        } else if (this.is_in_gap(gap, start)) {  // if our target landed _in_ the gap
                            start = gap.end + (start_delta - (gap.start - prev_start));
                            //break
                        }
                    }
                }
            }

            return start;
        };

        const define_end = (prev_end, end_delta) => {
            let end = prev_end + end_delta;

            if (data_gaps.length !== 0) {
                const sign = Math.sign(end_delta);

                if (end_delta < 0) {  // moving backwards
                    for (let i = data_gaps.length-1; i >= 0; i--) {
                        const gap = data_gaps[i];

                        if (end <= gap.start && prev_end >= gap.end) {  // if gap fits entirely within our view
                            end += gap.delta * sign
                            prev_end += gap.delta * sign
                        } else if (this.is_in_gap(gap, end)) {  // if our target landed _in_ the gap
                            end = gap.start + (end_delta + (prev_end - gap.end));
                            //break;
                        }
                    }
                } else {  // moving fwd
                    for (const gap of data_gaps) {
                        if (end >= gap.end && prev_end <= gap.start) {  // if gap fits entirely within our view
                            end += gap.delta * sign
                            prev_end += gap.delta * sign
                            this.push_gap_if_unique(gaps, gap)
                        } else if (this.is_in_gap(gap, end)) {  // if our target landed _in_ the gap
                            end = gap.end + (end_delta - (gap.start - prev_end));
                            this.push_gap_if_unique(gaps, gap)
                            //break;
                        }
                    }
                }
            }

            return end;
        };

        const gaps = [];
        const start = define_start(range.start, movement[0]);
        const end = define_end(range.end, movement[1]);

        return [start, end, gaps, new IndexedArray(arr, '0').getRange(start, end).reverse()];
    },

    fast_f_for_range2(arr, range, movement, interval) {
        const ia = new IndexedArray(arr, '0');
        ia.fetch(range.end - range.end_remainder);  // move cursor to current, pre-move end
        if (ia.cursor === null) throw new Error(`no datapoint found for current/previous endpoint @ [${range.end - range.end_remainder}]`);

        // first define end; find where end cursor is to be moved:
        const end_movement = range.end_remainder + movement[1];  // effective movement of right-hand-side in ms
        let candle_count_delta = Math.floor(end_movement / interval);  // negative if end_movement < 0 (ie moving back), else positive

        let end_idx = ia.cursor + candle_count_delta;
        if (end_idx < 2) end_idx = 2;
        else if (end_idx > arr.length-1) {
            candle_count_delta -= (end_idx - (arr.length - 1));
            end_idx = arr.length-1;
        }

        const end_remainder = end_movement - candle_count_delta * interval;

        const delta = range.delta + movement[1] - movement[0];
        const start_idx_minus_one = end_idx - Math.floor(delta / interval);  // ie end_idx - number_of_visible_candles

        const data = [];
        for (let i = end_idx; i > start_idx_minus_one && i >= 0; i--) {
            data.push(arr[i]);
        }

        return [
            data[0][0] + end_remainder,  // end, ie rightmost edge
            end_remainder,  // end - last_candle_timestamp; >= 0
            delta,
            data,
        ]
    },

    /**
     * Define & return {
     *     start: timestamp,
     *     end: timestamp,
     *     gaps: null | [gaps],
     *     data: array of candles from {@code arr} that fall into start-end range
     * }
     *
     * @param arr raw candle array to grab a subset from
     * @param range our range object defining _current_ range (that will be modified after we're called)
     * @param {number} movement  timestamp where our end (ie right-hand side) should be placed at.
     * @param interval
     * @param data_gaps full weekend gaps for the given {@code arr}
     * @returns [start: *, end: *, gaps: *, data: *]
     */
    fast_f_for_end_timestamp(arr, range, end, interval, data_gaps) {
        const gaps = [];
        let start = end - range.delta;

        if (data_gaps.length !== 0) {
            // first set/define end timestamp:
            let end_gap_index = data_gaps.length - 1;
            for (let i = end_gap_index; i >= 0; i--) {
                const gap = data_gaps[i]

                if (this.is_in_gap(gap, end)) {
                    end = gap.end  // let's place end at the gap endpoint
                    start = end - range.delta;  // need to re-define start

                    gaps.push(gap)
                    end_gap_index = i - 1;  // position pointer for next loop for finding start timestamp
                    break;
                }
            }

            // ...and then define start timestamp (note we carry on from the previous gaps pointer if end was in a gap)
            let prev_start = end;

            for (let i = end_gap_index; i >= 0; i--) {
                const gap = data_gaps[i]

                if (start <= gap.start && prev_start >= gap.end) {  // if gap fits entirely within our view
                    start -= gap.delta
                    prev_start -= gap.delta
                    this.push_gap_if_unique(gaps, gap)
                } else if (this.is_in_gap(gap, start)) {  // if our target landed _in_ the gap
                    // TODO: this start def needs work:
                    //start = gap.start - (range.delta - (end - prev_start));
                    start = gap.start // - (range.delta - (end - prev_start));
                    this.push_gap_if_unique(gaps, gap)
                    //break
                }
            }
        }

        return [start, end, gaps, new IndexedArray(arr, '0').getRange(start, end).reverse()];
    },

    fast_f_for_end_timestamp2(arr, range, end, interval) {
        let end_remainder;
        if (typeof end === 'object') {
            end_remainder = (end.c || 0) * interval;
            end = end.e;
        } else {  // typeof end == 'number'
            end_remainder = 0.5 * interval;  // leave a little empty buffer to the right
        }

        const ia = new IndexedArray(arr, '0');
        ia.fetch(end);

        let end_idx;
        if (ia.cursor !== null) {
            end_idx = ia.cursor;
        } else {
            end_idx = ia.nexthigh !== null ? ia.nexthigh : ia.nextlow;  // note we have affinity for looking forward/into future;
        }

        //const start_idx = Math.max(0, end_idx - range.candlesToShow + 1);
        //const start_remainder = (end_idx - start_idx) * interval - range.delta;

        const candles = []
        //for (let i = Math.max(0, end_idx - range.candlesToShow + 1); i <= end_idx && i < arr.length; i++) {
        //    candles.push(arr[i]);
        //}
        //        const candles = arr.slice(Math.max(0, end_idx - range.candlesToShow + 1), end_idx + 1);

        const visible_candles = Math.floor(range.delta / interval);
        for (let i = end_idx; i >= 0 && i > end_idx - visible_candles; i--) {
            candles.push(arr[i]);
        }
        // TODO: shouldn't we return decreased delta if start_idx had to be decreased?

        return [arr[end_idx][0] + end_remainder, end_remainder, candles];
    },

    now() { return new Date().getTime() },

    pause(delayMs) {
        return new Promise((rs/*, rj*/) => setTimeout(rs, delayMs))
    },

    // Limit crazy wheel delta values
    smart_wheel(delta) {
        const abs = Math.abs(delta)
        if (abs > 500) {
            return (200 + Math.log(abs)) * Math.sign(delta)
        }
        return delta
    },

    // Parse the original mouse event to find deltaX
    get_deltaX(event) {
        return event.originalEvent.deltaX / 12
    },

    // Parse the original mouse event to find deltaY
    get_deltaY(event) {
        return event.originalEvent.deltaY / 12
    },

    // Apply opacity to a hex color
    apply_opacity(c, op) {
        if (c.length === 7) {
            let n = Math.floor(op * 255)
            n = this.clamp(n, 0, 255)
            c += n.toString(16)
        }
        return c
    },

    // Parse timeframe or return value in ms
    parse_tf(smth) {
        if (typeof smth === 'string') {
            return Const.map_unit[smth]
        } else {
            return smth
        }
    },


    // sanitize function argument;
    // return the given arg if it's function, else null
    get_fun_or_null(f) {
        return typeof f === 'function' ? f : null
    },

    is_promise(prom) {
        return prom !== null && typeof prom === 'object' && typeof prom.then === 'function'
    },

    /**
     * Create & return a countdown latch.
     * @param count
     */
    create_latch(count) {
        return {
            check: () => --count === 0
        };
    },

    /**
     * Map given timestamp {@code t} to x-coordinate in our current view.
     * @param t
     * @param range
     * @param spacex  full width (px) of our current view where candles can be drawn.
     * @returns {number} x coord corresponding to input time.
     */
    t2screen(t, range, spacex) {
        if (range.gaps !== null) {
            for (let i = range.gaps.length-1; i >= 0; i--) {
                const gap = range.gaps[i]
                if (t >= gap.end) t -= gap.delta
            }
        }

        return (t - range.start) * spacex / range.delta;
    },

    /**
     * Calculate how many datapoints/candles fit in our current
     * view based on given params.
     * @param start
     * @param end
     * @param interval
     * @returns {number}
     */
    candles_in_view(start, end, interval) {
        return Math.floor((end - start) / interval);
    },

    /**
     * TODO: fast_f nova
     * @param arr
     * @param range
     * @param movement
     * @param interval
     * @returns {{data: *}|{data: [], start: *, delta: number, end: *, gaps: *}}
     */
    fast_f2(arr, range, movement, interval) {
        if (arr.length === 0) {
            return {
                ...range,
                data: [],
            }
        }

        let data, end, end_remainder = 0, delta = range.delta;
        if (Array.isArray(movement)) {
            [ end, end_remainder, delta, data ] = this.fast_f_for_range2(arr, range, movement, interval);
        } else {  // typeof movement == number|object
            [end, end_remainder, data] = this.fast_f_for_end_timestamp2(arr, range, movement, interval);
        }

        return {
            end,
            end_remainder,
            delta,
            data,
        };
    },
}
