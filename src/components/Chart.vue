<template>
    <!-- Chart components combined together -->
    <div class="trading-vue-chart" :style="styles">
        <keyboard ref="keyboard"></keyboard>
        <grid-section v-for="(grid, i) in this._layout.grids"
                      :key="grid.id"
                      :common="section_props(i)"
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
        Keyboard
    },
    mixins: [Shaders],
    props: [
        'title_txt', 'data', 'width', 'height', 'font', 'colors',
        'overlays', 'tv_id', 'config', 'buttons', 'toolbar'
    ],
    created() {

        // Context for text measurements
        this.ctx = new Context(this.$props)

        // Initial layout (All measurements for the chart)
        this.sub = this.subset(this.init_range())
        this._layout = new Layout(this)

        // Updates current cursor values
        this.updater = new CursorUpdater(this)
        this.update_last_candle()

    },
    methods: {
        range_changed(r) {
            // Overwite & keep the original references
            Object.assign(this.range, r)
            //Utils.overwrite(this.range, r)  // needs to be done first! (other steps after my be dependent on it)

            // TODO: we shouldn't call subset() here again!
            //Utils.overwrite(this.sub, this.subset())
            this.update_layout()
            this.$emit('range-changed', r)
        },
        movement_changed(m) {
            this.subset(m)
        },

        /**
         * TODO: shouldn't call range_changed here, we need to define movement somehow and call subset()
         */
        goto(t) {
            this.subset(t)
        },
        /**
         * TODO: shouldn't call range_changed here, we need to define movement somehow and call subset()
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
        set_ytransform(s) {
            const obj = this.y_transforms[s.grid_id] || {}
            Object.assign(obj, s)
            this.$set(this.y_transforms, s.grid_id, obj)
            this.update_layout()
            Object.assign(this.range, this.range)
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

            const start = data[start_idx][0] - this.interval * d;
            const end = data[last_idx][0] + this.interval * min_len;
            Object.assign(this.range, {
                //start: start,
                //end: end,  // TODO: no need to set start&end here right?
                delta: end - start,
            })

            return end;
        },

        // fetch subset of candles based on our current this.range:
        // also done in overlay_subset()
        // TODO: we need to make sure we have enough candles to fill out gaps as well!!
        // note we can't really calculate this _prior_ to knowing how many units we need
        // (ie all the width/step_x calculations done in layout should have been done?)
        // note layout.candles_n_vol() would already know it; unsure if grid_maker can be left as-is;
        // NOPE! grid_maker needs full to-be candles for scale calculation!

        // maybe pull some logic out from grid_maker to first decide how many _sequential_
        // candles we need to include (regardless of gaps whatsoever)?

        // TODO: need to update the range here?

        // by the time this is called, at least range.delta should've been initialised!
        subset(movement = [0, 0]) {
            if (Array.isArray(movement) && movement[0] === 0
                      && movement[1] === 0 && this.sub.length !== 0) {
                // no movement, return previously stored sub:
                return this.sub
            }

            const { start, end, gaps, delta, data } = Utils.fast_f(  // TODO: start time should have this.interval deducted?
                this.ohlcv,
                this.range,
                movement,
                this.interval,
            );

            if (this.range.start !== start || this.range.end !== end) {
                // TODO: overwrite this.sub here?
                Utils.overwrite(this.sub, data)

                this.range_changed({
                    start, end, gaps, delta
                })
            }

            return data;
        },

        /**
         * Get excerpt from given {@link source} (eg onchart/offchart)
         * candles for current {@lik range}
         */
        overlay_subset(source) {
            return source.map(d => ({
                type: d.type,
                name: d.name,
                data: Utils.fast_filter(
                    d.data,
                    this.range.start - this.interval,
                    this.range.end
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
                meta: this.meta
            }
        },
        section_props(i) {
            return i === 0 ?
                this.main_section : this.sub_section
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
        update_layout(clac_tf) {
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
            this.last_candle = this.ohlcv ?
                this.ohlcv[this.ohlcv.length - 1] : undefined
        }
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
        }
    },
    data() {
        return {
            // Current data slice; main chart candles corresponding to this.range;
            sub: [],

            // Time range, [startEpoch, endEpoch]
            range: {
                start: -1,
                end: -1,
                delta: -1,
                gaps: null,  // null if we're currently spanning no gaps, otherwise Array
            },

            // Candlestick interval, millis
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

            last_candle: []
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
            Object.assign(this.range, this.range)
        },
        data: {
            handler: function(n, p) {
                const m = this.sub.length === 0 ? this.init_range() : undefined;
                const sub = this.subset(m)

                // Fix Infinite loop warn, when the subset is empty
                // TODO: Consider removing 'sub' from data entirely
                if (this.sub.length || sub.length) {
                    Utils.overwrite(this.sub, sub)
                }
                this.update_layout(Utils.data_changed(n, p))
                //Object.assign(this.range, this.range)  // TODO: pointless operation?
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
