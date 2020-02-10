
// Main DataHelper class. A container for data,
// which works as a proxy and CRUD interface

import Utils from '../stuff/utils.js'
import DCCore from './dc_core.js'
import SettProxy from './sett_proxy.js'
import AggTool from './agg_tool.js'


// Interface methods. Private methods in dc_core.js
export default class DataCube extends DCCore {

    constructor(data = {}, sett = {}) {

        this.dynamicData = {
            loadForRange: null,  // can be either null or function
            sub: null,  // can be either null or function
            unsub: null,  // can be either null or function

            rangeToQuery: [],
            timeframe: 0,  // millisec

            loading: false,  // whether we're currently in process of fetching data for a range; TODO: rename as 'fetching'
            scrollLock: false,

            isBeginning: false,  // whether we've reached the beginning of chart - no earlier data is avail
            isEnd: false,  // whether we've reached the end of chart - no later data is or will be avail
            isHead: false,  // whether we've subscribed to automatically receive chart updates

            maxDatapoints: 10000,  // max number of datapoints allowed in memory; when exceeded, we start truncating
            fetchLookAhead: 1000  // how many datapoints should we fetch ahead as a buffer
        }

        let def_sett = {
            aggregation: 100,       // Update aggregation interval
            script_depth: 0,        // 0 === Exec on all data
            auto_scroll: true,      // Auto scroll to a new candle
            scripts: true,          // Enable overlays scripts,
            ww_ram_limit: 0,        // WebWorker RAM limit (MB)
            node_url: null,         // Use node.js instead of WW
            shift_measure: true     // Draw measurment shift+click
        }
        sett = Object.assign(def_sett, sett)

        super()
        this.sett = sett
        this.data = data
        this.sett = SettProxy(sett, this.ww)
        this.agg = new AggTool(this, sett.aggregation)
        this.se_state = {}

        //this.agg.update = this.agg_update.bind(this)
    }

    // Add new overlay
    add(side, overlay) {

        if (side !== 'onchart' && side !== 'offchart' &&
            side !== 'datasets') {
            return
        }

        this.data[side].push(overlay)
        this.update_ids()

        return overlay.id
    }

    // Get all objects matching the query
    get(query) {
        return this.get_by_query(query).map(x => x.v)
    }

    // Get first object matching the query
    get_one(query) {
        return this.get_by_query(query).map(x => x.v)[0]
    }

    // Set data (reactively)
    set(query, data) {
        const objects = this.get_by_query(query)

        for (const obj of objects) {

            const i = obj.i !== undefined ?
                obj.i :
                obj.p.indexOf(obj.v)

            if (i !== -1) {
                this.tv.$set(obj.p, i, data)
            }
        }

        this.update_ids()
    }

    // Merge object or array (reactively)
    merge(query, data) {

        const objects = this.get_by_query(query)

        for (const obj of objects) {
            if (Array.isArray(obj.v)) {
                if (!Array.isArray(data)) continue
                // If array is a timeseries, merge it by timestamp,
                // else merge by item index:
                if (obj.v[0] && obj.v[0].length >= 2) {
                    this.merge_ts(obj, data)
                } else {
                    this.merge_objects(obj, data, [])
                }
            } else if (obj.v !== null && typeof obj.v === 'object') {
                this.merge_objects(obj, data)
            }
        }

        this.update_ids()
    }

    // Remove an overlay by query (id/type/name/...)
    del(query) {

        const objects = this.get_by_query(query)

        for (const obj of objects) {

            // Find current index of the field (if not defined)
            let i = typeof obj.i !== 'number' ?
                obj.i : obj.p.indexOf(obj.v)

            if (i !== -1) {
                this.tv.$delete(obj.p, i)
            }
        }

        this.update_ids()
    }

    // Update/append data point, depending on timestamp
    update(data) {
        if(data['candle']) {
            return this.update_candle(data)
        } else {
            return this.update_tick(data)
        }
    }



/// TODO: old update() def; delete after post-merge state is verified:
    // Update/append data point, depending on timestamp
    update_OLD_DELETEME(data) {

        const ohlcv = this.data.chart.data
        const last = ohlcv[ohlcv.length - 1]
        const tick = data['price']
        const volume = data['volume'] || 0
        const candle = data['candle']
        const tfx = Utils.parse_tf(this.data.chart.tf)
        const tf = tfx || Utils.detect_interval(ohlcv)
        const t_next = last[0] + tf
        const now = Utils.now()
        let t = now >= t_next ? (now - now % tf) : last[0]

        if (candle) {
            // Update the entire candle
            if (candle.length >= 6) {
                t = candle[0]
                this.merge('chart.data', [candle])
            } else {
                this.merge('chart.data', [[t, ...candle]])
            }
        } else if (tick !== undefined && t >= t_next) {
            // And new zero-height candle
            this.merge('chart.data', [[
                t, tick, tick, tick, tick, volume
            ]])
        } else if (tick !== undefined) {
            // Update an existing one
            last[2] = Math.max(tick, last[2])
            last[3] = Math.min(tick, last[3])
            last[4] = tick
            last[5] += volume
            this.merge('chart.data', [last])
        }

        this.update_overlays(data, t)
        return t >= t_next
    }





    // Lock overlays from being pulled by query_search
    // TODO: subject to review
    lock(query) {
        const objects = this.get_by_query(query)
        objects.forEach(x => {
            if (x.v && x.v.id && x.v.type) {
                x.v.locked = true
            }
        })
    }

    // Unlock overlays from being pulled by query_search
    //
    unlock(query) {
        const objects = this.get_by_query(query, true)
        objects.forEach(x => {
            if (x.v && x.v.id && x.v.type) {
                x.v.locked = false
            }
        })
    }

    // Show indicator
    show(query) {
        if (query === 'offchart' || query === 'onchart') {
             query += '.'
        } else if (query === '.') {
            query = ''
        }

        this.merge(query + '.settings', { display: true })
    }

    // Hide indicator
    hide(query) {
        if (query === 'offchart' || query === 'onchart') {
             query += '.'
        } else if (query === '.') {
             query = ''
        }

        this.merge(query + '.settings', { display: false })
    }



    // TODO: onrange() I had deleted... is this needed or not???
    // Set data loader callback
    onrange(callback) {
        this.loader = callback
        setTimeout(() =>
            this.tv.set_loader(callback ? this : null), 0
        )
    }




    setDataHandlers({
                        loadForRange = null,
                        onRangeChanged = this.range_changed,
                        onCursorLockChanged = this.onCursorLockChanged,
                        onLiveData = this.received_live_data,
                        subscribe = this.subscribe,
                        unsubscribe = this.unsubscribe,
                    } = {}) {
        this.dynamicData.loadForRange = Utils.get_fun_or_null(loadForRange)
        subscribe = Utils.get_fun_or_null(subscribe)
        this.dynamicData.sub = subscribe === null ? null : subscribe.bind(null, Utils.get_fun_or_null(onLiveData))
        this.dynamicData.unsub = Utils.get_fun_or_null(unsubscribe)

        // allow vue to init, register listeners at next tick:
        setTimeout(() => {
                this.tv.register_range_changed_listener(Utils.get_fun_or_null(onRangeChanged))
                this.tv.register_cursor_lock_listener(Utils.get_fun_or_null(onCursorLockChanged))
            }, 0
        )
    }

}
