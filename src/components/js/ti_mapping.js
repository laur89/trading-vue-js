// Time-index mapping (for non-linear t-axis)

import Utils from '../../stuff/utils.js'

const MAX_ARR = Math.pow(2, 32)

// 3 MODES of index calculation for overlays/subcharts:
// ::: indexSrc :::
// * "map"      -> use TI mapping functions to detect index
//                 (slowest, for stocks only. DEFAULT)
//
// * "calc"     -> calculate shift between sub & data
//                 (faster, but overlay data should be perfectly
//                  align with the main chart,
//                  1-1 candle/data point. Supports Renko)
//
// * "data"     -> overlay data should come with candle index instead of time
//                 (fastest, supports Renko)

export default class TI {

    constructor() {

        this.ib = false
    }

    init(params, res) {

        let {
            /*sub, interval, meta, $props:$p, */interval_ms, sub_start, ib  // TODO!! unused vars
        } = params

        this.ti_map = []  // time->index
        this.it_map = []  // index->time
        this.sub_i = []  // copy of input data (ie this.sub) but with first index (time) replaced w/ index
        this.ib = ib // TODO!! at nova2 stage we had this line removed, ie whole this file didn't refer to ib
        this.sub = res  // input subset
        this.ss = sub_start
        this.tf = interval_ms
        // let start = meta.sub_start // TODO!! unused var

        // Skip mapping for the regular mode
        if (this.ib) { // TODO!! this.ib vs gap_collapse===3 !!; also - nova2 had removed any if-check here altogether!
            this.map_sub(res)
        }
    }

    // Make maps for the main subset
    /**
     * Map the input data/main subset {@code res} into internal ti_ & it_map
     * @param res
     */
    map_sub(res) {

        for (let i = 0; i < res.length; i++) {
            const r = res[i]
            const t = r[0]  // note time/index always first index!
            const _i = this.ss + i
            this.ti_map[t] = _i
            this.it_map[_i] = t

            // Overwrite time w/ index; note this has important implications elsewhere in the logic!
            const candle_copy = [...r]
            candle_copy[0] = _i
            this.sub_i.push(candle_copy)
        }
    }

    // Map overlay data
    // TODO: parse() called 3 times instead of 2 for 'spx_sample.json'
    parse(data, mode) {

        // note mode === 'data' implies timestamps have already been replaced
        // w/ indices in the input data source;
        if (!this.ib || !this.sub[0] || mode === 'data') return data  // TODO!! nova2 had !this.ib removed!

        const res = []

        if (mode === 'calc') {
            const shift = Utils.index_shift(this.sub, data)
            for (let i = 0; i < data.length; i++) {
                let _i = (this.ss + i)
                let copy = [...data[i]]
                copy[0] = _i + shift
                res.push(copy)
            }
            return res
        }
        // mode === 'map' logid follows, ie the default one

        let k = 0 // Candlestick index
        // If indicator data starts after ohlcv, calc the first index:
        if (data.length) {
            try {
                const nextlo = Utils.fast_nearest(this.sub, data[0][0])[0]
                if (nextlo !== null && nextlo >= 0) k = nextlo
            } catch(e) { }
        }

        const t0 = this.sub[0][0]
        const tN = this.sub[this.sub.length - 1][0]

        for (let i = 0; i < data.length; i++) {
            let copy = [...data[i]]
            let tk = this.sub[k][0]
            let t = data[i][0]
            let index = this.ti_map[t]

            if (index === undefined) {

                // Linear extrapolation
                if (t < t0 || t > tN) {
                    index = this.ss + k - (tk - t) / this.tf
                    t = data[i+1] ? data[i+1][0] : undefined
                } else {
                // Linear interpolation
                    let tk2 = this.sub[k + 1][0]
                    index = tk === tk2 ?  this.ss + k :
                        this.ss + k + (t - tk) / (tk2 - tk)
                    t = data[i+1] ? data[i+1][0] : undefined
                }

            }
            // Race of data points & sub points (ohlcv)
            // (like turn based increments)
            while (k+1 < this.sub.length - 1 && t > this.sub[k+1][0]) {
                k++
                tk = this.sub[k][0]  // TODO!!: useless tk assignment here right?
            }
            copy[0] = index
            res.push(copy)
        }
        return res
    }

    /**
     * index => time mapping. note it takes the raw date value in input {@code res}
     * array as the base values, and inter- or extrapolates if needed.
     * @param i input index to gate time value for.
     * @returns {undefined|*}
     */
    i2t(i) {

        // TODO!! nova2 had !this.ib removed
        if (!this.ib || !this.sub.length) return i // Regular mode, ie input must be time anyway I guess?

        // Discrete mapping
        const t = this.it_map[i]
        if (t !== undefined) return t  // time value was cached, return

        // Linear extrapolation
        // TODO: is this for getting time for the empty part of chart where no candles exist?
        else if (i >= this.ss + this.sub_i.length) {
            // i is somewhere on the right-hand empty space (ie future)
            const di = i - (this.ss + this.sub_i.length) + 1  // delta-i; note we could've also used sub.length instead of sub_i.length
            const last_candle = this.sub[this.sub.length - 1]
            return last_candle[0] + di * this.tf
        }
        else if (i < this.ss) {
            // i is somewhere on the left-hand empty space (ie past)
            const di = i - this.ss  // note this delta-i will be negative
            return this.sub[0][0] + di * this.tf
        }

        // Linear Interpolation, ie i is somewhere between existing candles?
        const i1 = Math.floor(i) - this.ss
        let i2 = i1 + 1

        if (i2 >= this.sub.length) i2 = this.sub.length - 1

        const sub1 = this.sub[i1]
        const sub2 = this.sub[i2]

        if (sub1 !== undefined && sub2 !== undefined) {
            const t1 = sub1[0]
            const t2 = sub2[0]
            return t1 + (t2 - t1) * (i - i1 - this.ss)
        }

        return undefined
    }

    // Map or bypass depending on the mode.
    // note we bypass on mode='data'
    //
    // think this again is only used with the overlay datasets in ib mode
    i2t_mode(i, mode) {
        return mode === 'data' ? i : this.i2t(i)
    }

    // time => index
    // TODO: when switch from IB mode to regular tools
    // disappear (bc there is no more mapping)
    // TODO!!: shouldn't this function also bail if !this.ib, same as i2t() does?
        t2i(t, ishead=false) {

        if (this.sub.length === 0) return undefined

        // Discrete mapping
        const i = this.ti_map[t]
        if (i !== undefined) return i

        const t0 = this.sub[0][0]  // first candle's time
        const tN = this.sub[this.sub.length - 1][0]  // last candle's time

        if (ishead) {
            window.console.log(`t2i(): t=${t}, t0=${t0}, tN=${tN}, tf=${this.tf}`)
        }

        // Linear extrapolation
        if (t < t0) {
            if (ishead) {
                window.console.log(`t2i(): t=${t} < t0=${t0}`)
                window.console.log(`t2i():  sub-len: ${this.sub.length}, ss: ${this.ss}`)
            }
            // i is somewhere on the left-hand empty space (ie past)
            return this.ss - (t0 - t) / this.tf
        }
        else if (t > tN) {
            // i is somewhere on the right-hand empty space (ie future)
            const last_candle_index = this.sub.length - 1
            if (ishead) {
                window.console.log(`t2i(): t=${t} > tN=${tN}`)
                window.console.log(`t2i(): last_cand_idx: ${last_candle_index}, sub-len: ${this.sub.length}, ss: ${this.ss}`)
            }
            return this.ss + last_candle_index - (tN - t) / this.tf
        }

        try {
            // Linear Interpolation
            const [nextlo, nexthi] = Utils.fast_nearest(this.sub, t)
            window.console.log(`t2i(): nextlo: ${nextlo}, nexthi: ${nexthi}, ss: ${this.ss}`)
            const tk = this.sub[nextlo][0]
            const tk2 = this.sub[nexthi][0]
            const k = (t - tk) / (tk2 - tk)
            // return this.ss + nextlo + k * (nexthi - nextlo)
            const result =  this.ss + nextlo + k * (nexthi - nextlo)
            window.console.log(`t2i(${t}) result = ${result}`)
            return result
        } catch(e) { }

        return undefined
    }

    // Auto detect: is it time or index?
    // caller needs to make sure that index-based mode is ON
    smth2i(smth) {
        if (smth > MAX_ARR) {  // smth is time
            return this.t2i(smth)
        } else {  // smth is index
            return smth
        }
    }

    smth2t(smth) {
        if (smth < MAX_ARR) {  // smth is index
            return this.i2t(smth)
        } else {  // smth is time
            return smth
        }
    }

    // Global Time => Index (uses all data, approx. method)
    // Used by tv.goto()
    gt2i(smth, ohlcv) {
        if (smth > MAX_ARR) {  // smth is time
            const E = 0.1 // Fixes the arrayslicer bug  // TODO!! what's this bug about?
            const [nextlo, nexthi] = Utils.fast_nearest(ohlcv, smth+E)

            // TODO: node nextlo would be null if smth would be a exact time contained by ohlcv; is that's why we add E/0.1 above???
            if (typeof nextlo === 'number') {
                return nextlo
            } else {
                return this.t2i(smth) // fallback
            }
        } else {  // smth is index
            return smth // it was an index
        }
    }

}
