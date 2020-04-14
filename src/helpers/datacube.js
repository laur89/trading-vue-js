
// Main DataHelper class. A container for data,
// which works as a proxy and CRUD interface

import Utils from '../stuff/utils.js'
import DCCore from './dc_core.js'

// Interface methods. Private methods in dc_core.js
export default class DataCube extends DCCore {

    constructor(data = {}) {
        super()
        this.dynamicData = {
            loadForRange: null,  // can be either null or function
            sub: null,  // can be either null or function
            unsub: null,  // can be either null or function
            initData: null,  // pull the very last available data; TODO: rename to fetchTail

            rangeToQuery: {},
            timeframe: 0,  // millisec

            loading: true,  // whether we're currently in process of fetching data for a range; TODO: rename as 'fetching'
            // note loading is initialized as 'true', as we want to wait 'til first batch of data is fetched;
            jumpToHeadPending: false,  // whether we're currently processing jump-to-head clickhandler;


            cursorLock: false,
            scrollLock: false,  // TODO: unused atm

            isBeginning: false,  // whether we've reached the beginning of chart - no earlier data is avail
            isEnd: false,  // whether we've reached the end of chart - no later data is or will be avail
            isHead: false,  // whether we've subscribed to automatically receive chart updates

            maxDatapoints: 10000,  // max number of datapoints allowed in memory; when exceeded, we start truncating; eg 48h is 2880min
            fetchLookAhead: 1000,  // how many datapoints should we fetch ahead as a buffer
            fetchTriggerMargin: 400  // how many datapoints before the in-memory limit should fetch be triggered; keep it smaller than fetchLookAhead
        }

        this.data = data
    }

    // Add new overlay
    add(side, overlay) {

        if (!this.on_or_off_chart(side)) return

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
        return this.get_by_query(query)[0].v
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

        if (Array.isArray(data) && this.on_or_off_chart(query)) {
            this._merge_on_off(query, objects, data)
        } else {
            for (const obj of objects) {
                this.merge_objects(obj, data)
            }
        }

        this.update_ids()
    }

    _merge_on_off(side, objects, data) {
        const overlays_to_add = []

        for (const d of data) {
            const existing_onoff_overlay = objects.find(o => o.v.name === d.name)

            if (existing_onoff_overlay === undefined) {
                // couldn't find existing overlay with same name;
                // assuming it's new one that needs to be added;
                overlays_to_add.push(d)
            } else {
                this.merge_objects(existing_onoff_overlay, d)
            }
        }

        // make sure to add new ones as last step in order
        // not to mess up indices of already existing ones:
        overlays_to_add.forEach(ov => this.add(side, ov))
    }

    // Remove an overlay by query (id/type/name/...)
    del(query) {

        const objects = this.get_by_query(query)

        for (const obj of objects) {

            // Find current index of the field (if not defined)
            const i = obj.i !== undefined ?
                obj.i : obj.p.indexOf(obj.v)

            if (i !== -1) {
                this.tv.$delete(obj.p, i)
            }
        }

        this.update_ids()
    }

    // Update/append data point, depending on timestamp
    update(data) {

        const ohlcv = this.data.chart.data
        const last = ohlcv[ohlcv.length - 1]
        const tick = data['price']
        const volume = data['volume'] || 0
        const candle = data['candle']
        const tf = Utils.detect_interval(ohlcv)
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
        if (this.on_or_off_chart(query)) {
            query += '.'
        } else if (query === '.') {
            query = ''
        }

        this.merge(query + '.settings', { display: true })
    }

    // Hide indicator
    hide(query) {
        if (this.on_or_off_chart(query)) {
            query += '.'
        } else if (query === '.') {
            query = ''
        }

        this.merge(query + '.settings', { display: false })
    }

    /**
     *
     * @param loadForRange
     * @param initData
     * @param onRangeChanged
     * @param onCursorLockChanged
     * @param onLiveData
     * @param subscribe
     * @param unsubscribe
     */
    setDataHandlers({
                        loadForRange,  // needs to return either Promise, or null when using the callback way
                        initData,  // needs to return Promise!
                        onRangeChanged = this.range_changed,
                        onCursorLockChanged = this.onCursorLockChanged,
                        onLiveData = this.received_live_data,
                        subscribe,
                        unsubscribe,
                    } = {}) {
        this.dynamicData.loadForRange = Utils.get_fun_or_null(loadForRange)
        subscribe = Utils.get_fun_or_null(subscribe)
        this.dynamicData.sub = subscribe === null ? null : subscribe.bind(null, Utils.get_fun_or_null(onLiveData))
        this.dynamicData.unsub = Utils.get_fun_or_null(unsubscribe)

        // allow vue to init, register listeners at next tick: (use setTimeout if not pulling data here)
        initData = Utils.get_fun_or_null(initData)
        if (initData !== null) {
            this.dynamicData.initData = initData;

            initData().then(data => {
                this.tv.register_range_changed_listener(Utils.get_fun_or_null(onRangeChanged))
                this.tv.register_cursor_lock_listener(Utils.get_fun_or_null(onCursorLockChanged))

                this.chunk_loaded(data, 1)
            })
        }

        this.tv.$refs.chart.$on('dc-legend-button-click', async e => {

            if (this.dynamicData.jumpToHeadPending) {
                return;  // another call to clickhander pending, bail
            } else if (this.dynamicData.isHead || this.dynamicData.isEnd) {  // we're currently already subbed OR we already have end of chart
                this.goto_current_tail();
            } else if (this.dynamicData.initData !== null) {
                this.dynamicData.jumpToHeadPending = true;

                // if some loading process going on, wait 'til it's done:
                while (this.dynamicData.loading) {
                    await Utils.pause(50);
                }

                this.dynamicData.loading = true;  // acquire lock
                this.dynamicData.initData(Math.ceil(this.dynamicData.rangeToQuery.delta * 1.5)).then(data => {
                    this._clear_data();  // otherwise we're likely to get a gap between our current tail & head of getTail() call response, that could be interpreted as a wkd-gap!
                    this.chunk_loaded(data, 1);
                    this.goto_current_tail();
                }).finally(() => {
                    this.dynamicData.jumpToHeadPending = false;
                    //this.dynamicData.loading = false;  // redundant, but no harm in keeping
                });
            }

            this.tv.$refs.chart.dc_legend_displayed = false;  // hide dc buttons
        });
    }
}
