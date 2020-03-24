<template>
    <!-- Chart components combined together -->
    <div class="trading-vue-chart" :style="styles">
        <keyboard ref="keyboard"></keyboard>
        <grid-section v-for="(grid, i) in this._layout.grids"
            :key="grid.id" ref="sec"
            :common="section_props(i)"
            :grid_id="i"
            @register-kb-listener="register_kb"
            @remove-kb-listener="remove_kb"
            @range-changed="range_changed"
            @cursor-changed="cursor_changed"
            @cursor-locked="cursor_locked"
            @sidebar-transform="set_ytransform"
            @layer-meta-props="layer_meta_props"
            @custom-event="emit_custom_event"
            @legend-button-click="legend_button_click"
            @movement="movement_changed"
            >
        </grid-section>
        <botbar v-bind="botbar_props"
            :shaders="shaders" :timezone="timezone">
        </botbar>
    </div>
</template>

<script>

import Context from '../stuff/context.js'
import Layout from './js/layout.js'
import Utils from '../stuff/utils.js'
import CursorUpdater from './js/updater.js'
import GridSection from './Section.vue'
import Botbar from './Botbar.vue'
import Keyboard from './Keyboard.vue'
import Shaders from '../mixins/shaders.js'
import DataTrack from '../mixins/datatrack.js'
import TI from './js/ti_mapping.js'
import Const from '../stuff/constants.js'


export default {
    name: 'Chart',
    props: [
        'title_txt', 'data', 'width', 'height', 'font', 'colors',
        'overlays', 'tv_id', 'config', 'buttons', 'toolbar', 'ib',
        'skin', 'timezone', 'gap_collapse'
    ],
    mixins: [Shaders, DataTrack],
    components: {
        GridSection,
        Botbar,
        Keyboard
    },
    created() {

        // Context for text measurements
        this.ctx = new Context(this.$props)

        // Initial layout (All measurements for the chart)
        this.sub = this.subset(this.init_range())
        Utils.overwrite(this.range, this.range) // Fix for IB mode
        this._layout = new Layout(this)

        // Updates current cursor values
        this.updater = new CursorUpdater(this)

        this.update_last_values()
        this.init_shaders(this.skin)
    },
    methods: {
        range_changed(r) {
            // Overwite & keep the original references
            // Quick fix for IB mode (switch 2 next lines)
            // TODO: wtf?
            Object.assign(this.range, r)
            //Utils.overwrite(this.sub, this.subset(r))  // TODO: fishy... is sthis call needed? also, r is type object!!

            this.update_layout()
            this.$emit('range-changed', r)
            if (this.$props.ib) this.save_data_t()
        },
        movement_changed(m) {
            this.subset(m)
        },

        goto(t) {
            this.subset(t)
        },
        /**
         * TODO: shouldn't call range_changed here, we need to
         * define movement somehow and call subset() with it instead!
         */
        setRange(t1, t2) {
            this.range_changed([t1, t2])
        },
        cursor_changed(e) {
            if (e.mode) this.cursor.mode = e.mode
            if (this.cursor.mode !== 'explore') {
                this.updater.sync(e)
            }
            if (this._hook_xchanged) this.ce('?x-changed', e)
        },
        cursor_locked(state) {
            if (this.cursor.scroll_lock && state) return
            this.cursor.locked = state
            if (this._hook_xlocked) this.ce('?x-locked', state)
        },

        /**
         * Derive interval based on our data
         */
        calc_interval() {
            let tf = Utils.parse_tf(this.forced_tf)
            if (this.ohlcv.length < 2 && !tf) return
            this.interval_ms = tf || Utils.detect_interval(this.ohlcv)
            this.interval = this.$props.ib ? 1 : this.interval_ms
            Utils.warn(
                () => this.$props.ib && !this.chart.tf,
                Const.IB_TF_WARN, Const.SECOND
            )
        },
        set_ytransform(s) {
            const obj = this.y_transforms[s.grid_id] || {}
            Object.assign(obj, s)
            this.$set(this.y_transforms, s.grid_id, obj)
            this.update_layout()
            Object.assign(this.range, this.range)  // TODO: is this really needed?
        },

        /**
         * Define initial range based on amount of bars available
         * and some constants.
         */
        default_range() {
            const data = this.ohlcv
            if (data.length < 2) return

            const def_len = this.$props.config.DEFAULT_LEN
            const min_len = this.$props.config.MINIMUM_LEN + 0.5
            const last_idx = data.length - 1

            let start_idx, d  // TODO: d is some coefficient?
            if (data.length < def_len) {
                start_idx = 0
                d = min_len
            } else {
                start_idx = last_idx - def_len
                d = 0.5
            }

// TODO: upstream has if-else here: if (!this.$props.ib) {
            const start = data[start_idx][0] - this.interval * d;
            const end = data[last_idx][0] + this.interval * min_len;

            switch (this.$props.gap_collapse) {
                case 1:
                    Object.assign(this.range, {
                        delta: end - start,
                    });
                    break;
                case 2:
                    // TODO: should we define something like a reminder, if our target doesn't exactly provide us w/ a candle? but should later still go toward a 'movement'?
                    Object.assign(this.range, {
                        //start,  // TODO: do we want/need to pass&store this? 'delta' prop should cover this no?
                        //end,
                        delta: end - start,
                    })
                    break;
                default:
                    throw new Error(`unsupported gap_collapse option ${this.$props.gap_collapse}`)
            }

            return end;
        },

        /**
         * Define new start & end timestamps based on given {@code movement}.
         * Note this function also defines & returns subset of main chart candles
         * that fit within our new range, and calls {@code range_changed()} function
         * with redefined range parameters.
         *
         * @param {number|array<number>} movement  either a number stating the timestamp where our end (ie
         *                               right-hand side) should be placed, or array of two elements:
         *                               [start-delta-in-ms, end-delta-in-ms], ie array defining how much
         *                               and in which direction our start & end points should be shifted.
         * @returns {array<candle>} array of main chart candles that fit within our newly defined range.
         */
        subset(movement = [0, 0]) {
            // TODO: this check seems logical, but causes dynamically-pulled data to be rendered only on next 'movement':
            //if (Array.isArray(movement) && movement[0] === 0
            //          && movement[1] === 0 && this.sub.length !== 0) {
            //    // no movement, return previously stored sub:
            //    return this.sub
            ///}

            switch (this.$props.gap_collapse) {
                case 1: {
                    const { start, end, gaps, delta, data } = Utils.fast_f(  // TODO: previously start time had this.interval deducted; is that needed?
                        this.ohlcv,
                        this.range,
                        movement,
                        this.interval,
                        this.gaps,
                    );

                    const range_changed = this.range.start !== start || this.range.end !== end;

                    if (range_changed || this.sub.length !== data.length) {
                        Utils.overwrite(this.sub, data)
                    }

                    if (range_changed) {
                        this.range_changed({
                            start, end, gaps, delta
                        })
                    }

                    return data;
                }
                case 2: {
                    const { end, end_remainder, delta, data } = Utils.fast_f2(
                        this.ohlcv,
                        this.range,
                        movement,
                        this.interval,
                    );

                    //console.log(JSON.stringify({
                    //    movement, start, end, end_remainder, delta,
                    //}))

                    const gaps = Utils.resolve_gaps(data, this.interval);
                    let start = end - delta
                    for (const g of gaps) start -= g.delta

                    const range_changed = this.range.start !== start || this.range.end !== end;

                    if (range_changed || this.sub.length !== data.length) {
                        Utils.overwrite(this.sub, data)
                    }

                    if (range_changed) {
                        this.range_changed({
                            start, end, end_remainder, delta,
                            gaps: gaps.length === 0 ? null : gaps,
                        })
                    }

                    //console.log(`start: ${new Date(start)}, end: ${new Date(end)}`)

                    return data;
                }
                default:
                    throw new Error(`unsupported gap_collapse option ${this.$props.gap_collapse}`)
            }
        },
        common_props() {
            return {
                title_txt: this.chart.name || this.$props.title_txt,
                layout: this._layout,
                sub: this.sub,
                range: this.range,
                interval: this.interval,
                cursor: this.cursor,
                colors: this.$props.colors,
                font: this.$props.font,
                y_ts: this.y_transforms,
                tv_id: this.$props.tv_id,
                config: this.$props.config,
                buttons: this.$props.buttons,
                meta: this.meta,
                skin: this.$props.skin
            }
        },
        overlay_subset(source, side) {
            return source.map((d, i) => {
                let res = Utils.fast_filter(
                    d.data, this.ti_map.i2t_mode(
                        this.range[0] - this.interval,
                        d.indexSrc
                    ),
                    this.ti_map.i2t_mode(this.range[1], d.indexSrc)
                )
                return {
                    type: d.type,
                    name: Utils.format_name(d),
                    data: this.ti_map.parse(res[0] || [], d.indexSrc || 'map'),
                    settings: d.settings || this.settings_ov,
                    grid: d.grid || {},
                    tf: Utils.parse_tf(d.tf),
                    i0: res[1],
                    loading: d.loading,
                    last: (this.last_values[side] || [])[i]
                }

            })
        },

        /**
         * TODO this is our overlay_subset()... no idea how to marry this
         * with the one above
         *
         * Get excerpt from given {@code source} (eg onchart/offchart)
         * candles for current {@code this.range}
         */
        overlay_subset(source) {
            return source.map(d => ({
                type: d.type,
                name: d.name,
                data: this.ti_map.parse(Utils.fast_filter(
                    d.data,
// TODO: following 2 lines should be these:
//                    this.range.start - this.interval,
//                    this.range.end
                    this.ti_map.i2t(this.range[0] - this.interval),
                    this.ti_map.i2t(this.range[1])
                )[0] || []),
                settings: d.settings || this.settings_ov,
                grid: d.grid || {},
                tf: Utils.parse_tf(d.tf)
            }))
        },

        section_props(i) {
            return i === 0 ? this.main_section : this.sub_section
        },
        init_range() {
            this.calc_interval()
            return this.default_range()
        },
        layer_meta_props(d) {
            // TODO: check reactivity when layout is changed
            if (!(d.grid_id in this.layers_meta)) {
                this.$set(this.layers_meta, d.grid_id, {})
            }
            this.$set(this.layers_meta[d.grid_id],
                d.layer_id, d)

            // Rerender
            this.update_layout()
        },
        remove_meta_props(grid_id, layer_id) {
            if (grid_id in this.layers_meta) {
                this.$delete(this.layers_meta[grid_id],layer_id)
            }
        },
        emit_custom_event(d) {
            this.on_shader_event(d, 'botbar')
            this.$emit('custom-event', d)
            if (d.event === 'remove-layer-meta') {
                this.remove_meta_props(...d.args)
            }
        },
        update_layout(clac_tf = false) {
            if (clac_tf) this.calc_interval()
            Utils.copy_layout(this._layout, new Layout(this))
            if (this._hook_update) this.ce('?chart-update', lay)
        },
        legend_button_click(event) {
            this.$emit('legend-button-click', event)
        },
        register_kb(event) {
            if (!this.$refs.keyboard) return
            this.$refs.keyboard.register(event)
        },
        remove_kb(event) {
            if (!this.$refs.keyboard) return
            this.$refs.keyboard.remove(event)
        },
        update_last_values() {
            const d = this.ohlcv
            this.last_candle = d ? d[d.length - 1] : []
            this.last_values = { onchart: [], offchart: [] }
            this.onchart.forEach((x, i) => {
                let d = x.data || []
                this.last_values.onchart[i] = d[d.length - 1]
            })
            this.offchart.forEach((x, i) => {
                let d = x.data || []
                this.last_values.offchart[i] = d[d.length - 1]
            })
        },
        // Hook events for extensions
        ce(event, ...args) {
            this.emit_custom_event({ event, args })
        },
        // Set hooks list (called from an extension)
        hooks(...list) {
            list.forEach(x => this[`_hook_${x}`] = true)
        }
    },
    computed: {
        // Component-specific props subsets:
        main_section() {
            const p = Object.assign({}, this.common_props())
            p.data = this.overlay_subset(this.onchart, 'onchart')
            p.data.push({
                type: this.chart.type || 'Candles',
                main: true,
                data: this.sub,
                i0: this.sub_start,
                settings: this.chart.settings || this.settings_ohlcv,
                grid: this.chart.grid || {},
                last: this.last_candle
            })
            p.overlays = this.$props.overlays
            return p
        },
        sub_section() {
            const p = Object.assign({}, this.common_props())
            p.data = this.overlay_subset(this.offchart, 'offchart')
            p.overlays = this.$props.overlays
            return p
        },
        botbar_props() {
            const p = Object.assign({}, this.common_props())
            p.width = p.layout.botbar.width
            p.height = p.layout.botbar.height
            p.rerender = this.rerender
            return p
        },
        offsub() {
             return this.overlay_subset(this.offchart, 'offchart')
        },
        // Datasets: candles, onchart, offchart indicators
        ohlcv() {
            return this.$props.data.ohlcv || this.chart.data || []
            // TODO: change to this once ohlcv (old data format) has been deprecated:
            //return this.chart.data || []
        },
        chart() {
            return this.$props.data.chart || { grid: {}, data: [] }
        },
        onchart() {
            return this.$props.data.onchart || []
        },
        offchart() {
            return this.$props.data.offchart || []
        },
        filter() {
            return this.$props.ib ?
                Utils.fast_filter_i : Utils.fast_filter
        },
        styles() {
            const w = this.$props.toolbar ? this.$props.config.TOOLBAR : 0
            return { 'margin-left': `${w}px` }
        },
        meta() {
            return {
                last: this.last_candle,
                sub_start: this.sub_start,
                activated: this.activated
            }
        },
        forced_tf() {
            return this.chart.tf
        }
    },
    data() {
        return {
            // Current data slice; main chart candles corresponding to this.range;
            sub: [],

            // Time range in our current view (ie in visible range)
            range: {
                start: -1,  // only used w/ v1 collapse
                end: -1,  // what time is at our current view's rightmost edge;
                delta: -1,  // end - start - (sum of gaps' ranges)
                gaps: null,  // null if we're currently spanning no gaps, otherwise non-empty array of gaps; only used if $props.gap_collapse=1
                end_remainder: 0,  // how many ms from rightmost candle to right edge; >= 0; only used if $props.gap_collapse=2
            },

            gaps: [],  // data gaps for our _entire_ available main chart data range

            // Candlestick interval, millis
            interval: 0,

            // Crosshair states
            cursor: {
                x: null, y: null, t: null, y$: null,
                grid_id: null, locked: false, values: {},
                scroll_lock: false, mode: Utils.xmode()
            },

            // A trick to re-render botbar
            rerender: 0,

            // Layers meta-props (changing behaviour)
            layers_meta: {},

            // Y-transforms (for y-zoom and -shift)
            y_transforms: {},

            // Default OHLCV settings (when using DataStructure v1.0)
            settings_ohlcv: {},

            // Default overlay settings
            settings_ov: {},

            // Meta data
            last_candle: [],
            last_values: {},
            sub_start: undefined,
            activated: false

        }
    },
    watch: {
        width() {
            this.update_layout()
            if (this._hook_resize) this.ce('?chart-resize')
        },
        height() {
            this.update_layout()
            if (this._hook_resize) this.ce('?chart-resize')
        },
        ib(nw) {
            if (!nw) {
                // Change range index => time
                let t1 = this.ti_map.i2t(this.range[0])
                let t2 = this.ti_map.i2t(this.range[1])
                Utils.overwrite(this.range, [t1, t2])
                this.interval = this.interval_ms
            } else {
                this.init_range() // TODO: calc index range instead
                Utils.overwrite(this.range, this.range)
                this.interval = 1
            }
            let sub = this.subset()
            Utils.overwrite(this.sub, sub)
            this.update_layout()
        },
        timezone() {
            this.update_layout()
        },
        colors() {
            Object.assign(this.range, this.range)  // TODO: is this really necessary?
        },
        forced_tf(n, p) {
            this.update_layout(true)
            this.ce('exec-all-scripts')
        },
        data: {
            handler: function(n, p) {
                const endTimestamp = this.sub.length === 0 ? this.init_range() : undefined  // init_range() should be called first thing here!
                // TODO: find a better solution thatn ohlcv.slice().reverse()!:
                Utils.overwrite(this.gaps, Utils.resolve_gaps(this.ohlcv.slice(0).reverse(), this.interval))
                this.subset(endTimestamp)

                // Fixes Infinite loop warn, when the subset is empty
                // TODO: Consider removing 'sub' from data entirely
                if (this.sub.length || sub.length) {
                    Utils.overwrite(this.sub, sub)
                }

                // TODO: data changed detection not working?:
                //window.console.log(`d changed?: ${Utils.data_changed(n, p)}`)

                this.update_layout(Utils.data_changed(n, p))
                this.cursor.scroll_lock = !!n.scrollLock
                if (n.scrollLock && this.cursor.locked) {
                    this.cursor.locked = false
                }
                if (this._hook_data) this.ce('?chart-data', nw)
                this.update_last_values()
                // TODO: update legend values for overlays
                this.rerender++
            },
            deep: true
        }
    }
}

</script>
