// Time-index mapping (for non-linear t-axis)

import Utils from '../../stuff/utils.js'

const MAX_ARR = Math.pow(2, 32)

export default class TI {

    constructor(params, res) {
        let {
            sub, onchart, interval, meta, $props: $p,
            interval_ms, sub_start,
        } = params

        this.ti_map = []
        this.it_map = []
        this.sub_i = []
        this.sub = res
        this.ss = sub_start
        this.tf = interval_ms
        let start = meta.sub_start

        // Skip mapping for the regular mode
        this.map_sub(res)
    }

    // Make maps for the main subset
    map_sub(res) {

        for (let i = 0; i < res.length; i++) {
            const t = res[i][0]
            const _i = this.ss + i
            this.ti_map[t] = _i
            this.it_map[_i] = t

            // Overwrite time w/ index; note this has important implications elsewhere in the logic!
            const candle_copy = [...res[i]]
            candle_copy[0] = _i
            this.sub_i.push(candle_copy)
        }
    }

    // Map overlay data
    // TODO: parse() called 3 times instead of 2 for 'spx_sample.json'
    parse(data) {
        if (!this.sub[0]) return data
        let res = []
        let k = 0 // Candlestick index

        let t0 = this.sub[0][0]
        let tN = this.sub[this.sub.length - 1][0]

        for (var i = 0; i < data.length; i++) {
            let copy = [...data[i]]
            let _i = (this.ss + i)
            let tk = this.sub[k][0]
            let t = data[i][0]
            let index = this.ti_map[t]

            if (index === undefined) {

                // Linear extrapolation
                if (t < t0 || t > tN) {
                    index = this.ss + k - (tk - t) / this.tf
                }

                // Linear interpolation
                else {
                    let tk2 = this.sub[k + 1][0]
                    index = this.ss + k + (t - tk) / (tk2 - tk)
                }

            }

            if (t > tk && k < this.sub.length - 2) k++
            copy[0] = index
            res.push(copy)
        }

        return res
    }

    // index => time
    i2t(i) {

        if (!this.sub.length) return i // Regular mode

        // Discrete mapping
        let res = this.it_map[i]
        if (res !== undefined) return res

        // Linear extrapolation
        else if (i >= this.ss + this.sub_i.length) {
            let di = i - (this.ss + this.sub_i.length) + 1
            let last = this.sub[this.sub.length - 1]
            return last[0] + di * this.tf
        }
        else if (i < this.ss) {
            let di = i - this.ss
            return this.sub[0][0] + di * this.tf
        }

        // Linear Interpolation
        let i1 = Math.floor(i) - this.ss
        let i2 = i1 + 1
        let len = this.sub.length

        if (i2 >= len) i2 = len - 1

        let sub1 = this.sub[i1]
        let sub2 = this.sub[i2]

        if (sub1 && sub2) {
            let t1 = sub1[0]
            let t2 = sub2[0]
            return t1 + (t2 - t1) * (i - i1 - this.ss)
        }
        return undefined

    }

    // time => index
    // TODO: when switch from IB mode to regular tools
    // disappear (bc there no more mapping)
    t2i(t) {
        if (!this.sub.length) return undefined

        // Discrete mapping
        let res = this.ti_map[t]
        if (res !== undefined) return res

        let t0 = this.sub[0][0]
        let tN = this.sub[this.sub.length - 1][0]

        // Linear extrapolation
        if (t < t0) {
            return this.ss - (t0 - t) / this.tf
        }

        else if (t > tN) {
            let k = this.sub.length - 1
            return this.ss + k - (tN - t) / this.tf
        }

        try {
            const i = Utils.fast_nearest(this.sub, t)
            const tk = this.sub[i[1]][0]
            //console.log('here', i)
            return this.ss + i[1] - (tk - t) / this.tf
        } catch(e) { }


        return undefined
    }

    // Auto detect: is it time or index?
    // Assuming that index-based mode is ON
    smth2i(smth) {
        if (smth > MAX_ARR) {
            return this.t2i(smth) // it was time
        } else {
            return smth // it was an index
        }
    }

}
