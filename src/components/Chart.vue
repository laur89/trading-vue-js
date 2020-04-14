<template>
    <!-- Chart components combined together -->
    <div class="trading-vue-chart" :style="styles">
        <keyboard ref="keyboard"></keyboard>
        <grid-section v-for="(grid, i) in this._layout.grids"
                      :key="grid.id"
                      :common="section_props(i)"
                      :dc_legend_displayed="dc_legend_displayed"
                      :grid_id="i"
                      @register-kb-listener="register_kb"
                      @remove-kb-listener="remove_kb"
                      @movement="movement_changed"
                      @cursor-changed="cursor_changed"
                      @cursor-locked="cursor_locked"
                      @sidebar-transform="set_ytransform"
                      @layer-meta-props="layer_meta_props"
                      @custom-event="emit_custom_event"
                      @legend-button-click="legend_button_click"
                      @dc-legend-button-click="on_dc_legend_button_click"
        >
        </grid-section>
        <botbar v-bind="botbar_props" :shaders="shaders">
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

export default {
    name: 'Chart',
    components: {
        GridSection,
        Botbar,
        Keyboard,
    },
    mixins: [Shaders],
    props: [
        'title_txt', 'data', 'width', 'height', 'font', 'colors',
        'overlays', 'tv_id', 'config', 'buttons', 'toolbar', 'gap_collapse',
    ],
    created() {

        // Context for text measurements
        this.ctx = new Context(this.$props)

        // Initial layout (All measurements for the chart)
        this.sub = this.subset(this.init_range())
        this.init_secondary_series_tf();
        this._layout = new Layout(this)

        // Updates current cursor values
        this.updater = new CursorUpdater(this)
        this.update_last_candle()

    },
    methods: {
        range_changed(r) {
            // Overwite & keep the original references
            Object.assign(this.range, r)
            //this.range = r;  //  TODO can we use?

            this.update_layout()
            this.$emit('range-changed', r)
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
            this.updater.sync(e)
        },
        cursor_locked(state) {
            if (this.cursor.scroll_lock && state) return
            this.cursor.locked = state
            this.$emit('cursor-locked', state)
        },

        /**
         * Derive interval based on our data
         */
        calc_interval() {
            if (this.ohlcv.length < 2) return
            this.interval = Utils.detect_interval(this.ohlcv)
        },

        /**
         * Define & store timeframes for our onchart&offchart series,
         * if already not defined.
         * The reason we're doing this is that their timeframes may
         * be longer than the main chart data's.
         */
        init_secondary_series_tf() {
            const define_tf = d => {
                if (!d.hasOwnProperty('tf') && d.data.length >= 2) {
                    d.tf = Utils.detect_interval(d.data)
                }
            };

            for (const d of this.offchart) {
                define_tf(d);
            }

            for (const d of this.onchart) {
                define_tf(d);
            }
        },

        set_ytransform(s) {
            const obj = this.y_transforms[s.grid_id] || {}
            Object.assign(obj, s)
            this.$set(this.y_transforms, s.grid_id, obj)
            this.update_layout()
            Object.assign(this.range, this.range)  // TODO: is this really needed?
            //this.range = Object.assign({}, this.range);   //  TODO can we use?
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

            const start = data[start_idx][0] - this.interval * d;  // note the last subtraction is to fit the leftmost candle nicely/as a whole on our view
            const end = data[last_idx][0]  // + this.interval * min_len; <-- right-hand buffer set... elsewhere?

            Object.assign(this.range, {
                delta: end - start,
            });

            switch (this.$props.gap_collapse) {
                case 2:
                    return {
                        e: end,
                        c: 2.5,  // leave bit more empty buffer space to the right
                    };
                default:
                    return end;
            }
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

                    const gaps = Utils.resolve_gaps(data, this.interval, this.$props.gap_collapse);
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

        /**
         * Get excerpt from given {@code source} (eg onchart/offchart)
         * candles for current {@code this.range}
         */
        overlay_subset(source) {
            return source.map(d => ({
                type: d.type,
                name: d.name,
                data: Utils.fast_filter(
                    d.data,
                    this.range.start - (d.tf || this.interval),
                    this.range.end + (d.tf || this.interval)
                ),
                settings: d.settings || this.settings_ov,
                grid: d.grid || {}
            }))
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
                gap_collapse: this.$props.gap_collapse,
            }
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
        update_last_candle() {
            // TODO: add last values for all overlays
            const d = this.ohlcv
            this.last_candle = d ? d[d.length - 1] : []
        },
        on_dc_legend_button_click(event) {
            this.$emit('dc-legend-button-click', event)
        },
    },
    computed: {
        // Component-specific props subsets:
        main_section() {
            const p = Object.assign({}, this.common_props())
            p.data = this.overlay_subset(this.onchart)
            p.data.push({
                type: this.chart.type || 'Candles',
                main: true,
                data: this.sub,
                settings: this.chart.settings || this.settings_ohlcv,
                grid: this.chart.grid || {}
            })
            p.overlays = this.$props.overlays
            return p
        },
        sub_section() {
            const p = Object.assign({}, this.common_props())
            p.data = this.overlay_subset(this.offchart)
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
            return this.overlay_subset(this.offchart)
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
        styles() {
            const w = this.$props.toolbar ? this.$props.config.TOOLBAR : 0
            return { 'margin-left': `${w}px` }
        },
        meta() {
            return {
                last: this.last_candle
            }
        },
    },
    data() {
        return {
            // Current data slice; main chart candles corresponding to this.range;
            sub: [],

            // Time range in our current view (ie in visible range)
            range: {
                start: -1,  // what time is at our current view's leftmost edge;
                end: -1,  // what time is at our current view's rightmost edge;
                delta: -1,  // end - start - (sum of gaps' ranges)
                gaps: null,  // null if we're currently spanning no gaps, otherwise non-empty array of gaps;
                end_remainder: 0,  // how many ms from rightmost candle to right edge; >= 0; only used if $props.gap_collapse=2
            },

            gaps: [],  // data gaps for our _entire_ available main chart data range; only used if $props.gap_collapse=1

            // _main_ chart's candlestick interval/tf, millis
            interval: 0,

            // Crosshair states
            cursor: {
                x: null, y: null, t: null, y$: null,
                grid_id: null, locked: false, values: {},
                scroll_lock: false
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

            last_candle: [],

            dc_legend_displayed: false,  // whether DC legend should be shown
        }
    },
    watch: {
        width() {
            this.update_layout()
        },
        height() {
            this.update_layout()
        },
        colors() {
            Object.assign(this.range, this.range)  // TODO: is this really necessary?
            //this.range = Object.assign({}, this.range);  //  TODO can we use?
        },
        data: {
            handler: function(n, p) {
                const endTimestamp = this.sub.length === 0 ? this.init_range() : undefined  // init_range() should be called first thing here!
                this.init_secondary_series_tf();

                // TODO: find a better solution thatn ohlcv.slice().reverse()!:
                if (this.$props.gap_collapse === 1) {
                    Utils.overwrite(this.gaps, Utils.resolve_gaps(this.ohlcv.slice(0).reverse(), this.interval, this.$props.gap_collapse))
                }
                if (endTimestamp !== undefined) this.subset(endTimestamp)  // only call subset() if endTimestamp !== undefined, ie it's our first init

                // TODO: data changed detection not working?:
                //window.console.log(`d changed?: ${Utils.data_changed(n, p)}`)

                this.update_layout(Utils.data_changed(n, p))
                this.cursor.scroll_lock = !!n.scrollLock
                if (n.scrollLock && this.cursor.locked) {
                    this.cursor.locked = false
                }
                this.update_last_candle()
                // TODO: update legend values for overlays
                this.rerender++
            },
            deep: true
        }
    }
}

</script>
