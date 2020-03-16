
import IndexedArray from 'arrayslicer'
import Const from './constants';
const { WKD_GAP_DURATION, DAY } = Const

export default {

    /**
     * Makes sure given {@code num} is within the given
     * limits {@code min} <= num <= {@code max}
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
    // and old dataset values)
    data_changed(n, p) {
        n = n.ohlcv || (n.chart ? n.chart.data : []) || []
        p = p.ohlcv || (p.chart ? p.chart.data : []) || []
        return n.length !== p.length && n[0] !== p[0]
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

    // Detects candles interval. (old version, slightly slower)
    /*detect_interval(ohlcv) {
        // Initial value of accumulator
        let a0 = [Infinity, ohlcv[0][0]]
        return ohlcv.slice(1, 99).reduce((a,x) =>
        [Math.min(x[0] - a[1], a[0]), x[0]], a0)[0]
    },*/

    // Gets numberic part of overlay id (e.g 'EMA_1' = > 1)
    get_num_id(id) {
        return parseInt(id.split('_').pop())
    },

    // Fast filter. Really fast, like 10X
    fast_filter(arr, t1, t2) {
        if (arr.length === 0) return arr

        try {
            return new IndexedArray(arr, '0').getRange(t1, t2)
        } catch(e) {
            // Something wrong with fancy slice lib
            // Fast fix: fallback to filter
            return arr.filter(x =>
                x[0] >= t1 && x[0] <= t2
            )
        }
    },

    /**
     * TODO: handle cases where:
     * - we're zoomed out and are spanning more than 1 gap
     */
    fast_f(arr, range, movement, interval) {
        if (arr.length === 0) {
            return {
                ...range,
                data: arr,
            }
        }

        let start, end, gaps, data;
        if (Array.isArray(movement)) {
            [ start, end, gaps, data ] = this.fast_f_for_range(arr, range, movement, interval);
        } else {  // typeof movement should be 'number'
            [ start, end, gaps, data ] = this.fast_f_for_end_timestamp(arr, range, movement, interval);
            // TODO: should we reset the existing gaps here? (as we weren't "panning", but jumping)
            range.gaps = null  // reset, previous gaps mean nothing
        }

        if (range.gaps !== null) {  // ie we were previously (possibly still) spanning a gap
            if (gaps.length !== 0) {
                // this situation should never occur! we were already spanning gap, how come new one was detected? 2 gaps? theoretically possible...
                // ALSO! this could happen if fast_f_for_end_timestamp() path was followed?
                throw new Error(`already were within detected gap ${JSON.stringify(range.gaps)}, and now also identified _new_ one ${JSON.stringify(gaps)}`);
            } else if (!(start < range.gaps[0].start && end > range.gaps[0].end)) {  // TODO currently only supports single gap
                gaps = null  // looks like we've exited gap, reset
            } else {
                gaps = range.gaps  // we're still spanning the gap(s), do not reset
            }
        } else {  // no existing gaps from previous movement
            gaps = gaps.length === 0 ? null : gaps
        }

        let delta = end - start
        if (gaps !== null) {
            for (const gap of gaps) {
                delta -= gap.delta
            }
        }

        return {start, end, gaps, delta, data};
    },

    /**
     * TODO: handle cases where:
     * - we directly jump in the middle of gap (ie both start & end)
     * - we're zoomed out and are spanning more than 1 gap
     *
     * @param arr
     * @param range note this is our _current_, pre-movement range
     * @returns {Array<boolean,object>} [isExactMatch, candle]
     */
    fast_f_for_range(arr, range, movement, interval) {
        const ia = new IndexedArray(arr, '0');
        const gaps = [];  // TODO: detect if both ends go over the gap, ie effectively no more gap!

        // first let's find first/starting candle (or its index?):
        let start = range.start + movement[0];
        ia.fetch(start)
        if (interval <= DAY
                    && ia.cursor === null && ia.nextlow !== null && ia.nexthigh !== null
                    && arr[ia.nexthigh][0] - arr[ia.nextlow][0] > WKD_GAP_DURATION) {
            if (movement[0] > 0) {  // moving fwd
                start = arr[ia.nexthigh][0] + (movement[0] - (arr[ia.nextlow][0] - range.start));
            } else {  // assuming m[0] < 0
                start = arr[ia.nextlow][0] + (movement[0] + (range.start - arr[ia.nexthigh][0]));
                gaps.push({  // right? new gap only when START moving back?
                    start: arr[ia.nextlow][0],
                    end: arr[ia.nexthigh][0],
                    delta: arr[ia.nexthigh][0] - arr[ia.nextlow][0] - interval,
                })
            }
        }

        // ...now to defining the end:
        let end = range.end + movement[1];
        ia.fetch(end)
        if (interval <= DAY
                    && ia.cursor === null && ia.nexthigh !== null && ia.nextlow !== null
                    && arr[ia.nexthigh][0] - arr[ia.nextlow][0] > WKD_GAP_DURATION) {
            if (movement[1] > 0) {  // moving fwd
                end = arr[ia.nexthigh][0] + (movement[1] - (arr[ia.nextlow][0] - range.end));

                if (gaps.length === 0 || arr[ia.nextlow][0] !== gaps[0].start) {  // do not duplicate; TODO: is this check necessary?
                    gaps.push({  // right? new gap only when END moving fwd?
                        start: arr[ia.nextlow][0],
                        end: arr[ia.nexthigh][0],
                        delta: arr[ia.nexthigh][0] - arr[ia.nextlow][0] - interval,
                    })
                }
            } else {  // assuming m[1] < 0
                end = arr[ia.nextlow][0] + (movement[1] + (range.end - arr[ia.nexthigh][0]));
            }
        }

        return [start, end, gaps, ia.getRange(start, end)];
    },

    /**
     * TODO: handle cases where:
     * - we directly jump in the middle of gap (ie both start & end)
     * - we're zoomed out and are spanning more than 1 gap
     *
     * @param arr
     * @param range note this is our _current_, pre-movement range
     * @returns {Array<boolean,object>} [isExactMatch, candle]
     */
    fast_f_for_end_timestamp(arr, range, end, interval) {
        const ia = new IndexedArray(arr, '0');
        const gaps = [];  // TODO: detect if both ends go over the gap, ie effectively no more gap!
        let start = end - range.delta;
        ia.fetch(end);

        if (interval <= DAY
                    && ia.cursor === null && ia.nexthigh !== null && ia.nextlow !== null
                    && arr[ia.nexthigh][0] - arr[ia.nextlow][0] > WKD_GAP_DURATION) {
            if (arr[arr.length - 1][0] >= arr[ia.nexthigh][0] + range.delta) {
                // this means all of our requested view fits _after_ the gap
                start = arr[ia.nexthigh][0]
                end = start + range.delta
            } else {
                // 'start' needs to be somewhere before the gap
                end = arr[arr.length - 1][0]
                start = arr[ia.nextlow][0] - (range.delta - (end - arr[ia.nexthigh][0]));

                gaps.push({
                    start: arr[ia.nextlow][0],
                    end: arr[ia.nexthigh][0],
                    delta: arr[ia.nexthigh][0] - arr[ia.nextlow][0] - interval,
                })
            }
        }

        return [start, end, gaps, ia.getRange(start, end)];
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

    // sanitize function argument;
    // return the given arg if it's function, else null
    get_fun_or_null(f) {
        return typeof f === 'function' ? f : null
    },

    is_promise(prom) {
        return prom !== null && typeof prom === 'object' && typeof prom.then === 'function'
    },

    create_latch(count) {
        return {
            check: () => --count === 0
        };
    },

    /**
     * time to x coord
     * @param t
     * @returns {number}
     */
    t2screen(t, range, spacex) {
        const r = spacex / range.delta  // ms per 1px

        if (range.gaps !== null) {
            // TODO: multiple gaps?
            for (const gap of range.gaps) {
                if (t >= gap.end) {
                    t -= gap.delta
                }
            }
        }

        return Math.floor((t - range.start) * r);
    }

}
