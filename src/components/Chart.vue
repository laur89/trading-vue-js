<template>
    <!-- Chart components combined together -->
    <div class="trading-vue-chart" :style="styles">
        <keyboard ref="keyboard"></keyboard>
      <!--            @range-changed="range_changed"  // TODO: is it ok to have this guy replaced by @movement below? -->
        <grid-section v-for="(grid, i) in this._layout.grids"
            :key="grid.id" ref="sec"
            :common="section_props(i)"
            :grid_id="i"
            :dc_legend_displayed="dc_legend_displayed"
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
import IndexedArray from 'arrayslicer';


const define_tf = d => {
    if (d.hasOwnProperty('tf')) {
        d.tf = Utils.parse_tf(d.tf)
    } else if (d.data.length >= 2) {
        d.tf = Utils.detect_interval(d.data);
    }
};

export default {
    name: 'Chart',
    // TODO!!: nova2 had 'ib' removed from props!:
    props: [
        'title_txt', 'data', 'width', 'height', 'font', 'colors',
        'overlays', 'tv_id', 'config', 'buttons', 'toolbar', 'ib',
        'skin', 'timezone', 'gap_collapse'
    ],
    mixins: [Shaders, DataTrack],
    components: {
        GridSection,
        Botbar,
        Keyboard,
    },
    created() {

        // Context for text measurements
        this.ctx = new Context(this.$props)

        // Initial layout (All measurements for the chart)
        this.sub = this.subset(this.init_range())
        this.init_secondary_series_tf();
        //Utils.overwrite(this.range, this.range) // Fix for IB mode  // note this line is uncommented in upstream
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
            //this.range = r;  //  TODO can we use instead of assigning r?

            this.update_layout()
            this.$emit('range-changed', r)
            if (this.$props.ib) this.save_data_t()
        },
        movement_changed(m) {
            this.subset(m)
        },

        goto(t) {
            this.subset(t)
            // upstream has this instread:
            //const dt = this.range[1] - this.range[0]
            //this.range_changed([t - dt, t])
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
            this.$emit('cursor-locked', state)  // TODO!! added by laur, but the above line ('?x-locked'..) wasn't earlier... maybe our stuff is no more needed?
        },

        /**
         * Derive interval based on our data
         */
        calc_interval() {
            const tf = Utils.parse_tf(this.forced_tf)
            if (this.ohlcv.length < 2 && !tf) return
            this.interval_ms = tf || Utils.detect_interval(this.ohlcv)
            this.interval = this.$props.gap_collapse === 3 ? 1 : this.interval_ms  // TODO!! good 'ol this.$props.ib vs gaps_collapse===3

            Utils.warn(
                () => this.$props.ib && !this.chart.tf,  // TODO!! good 'ol this.$props.ib vs gaps_collapse===3
                Const.IB_TF_WARN, Const.SECOND
            )
        },

        /**
         * Define & store timeframes for our onchart&offchart series,
         * if already not defined.
         * The reason we're doing this is that their timeframes may
         * be longer than the main chart data's.
         * TODO!! after latest changes, is this method perhaps deprecated/not needed now?
         */
        init_secondary_series_tf() {
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
            //this.range = Object.assign({}, this.range);   //  TODO maybe use this instead above line if it's really needed?
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

            Object.assign(this.range, {  // TODO: wrong in IB mode! gap_collapse=3; but it should get overwritten anyway, so doesn't matter?
                delta: end - start,
            });

            switch (this.$props.gap_collapse) {
                case 2:
                    return {
                        e: end,
                        c: 2.5,  // leave bit more empty buffer space to the right-hand side
                    };
                case 3: {
                    const start = start_idx - this.interval * d
                    const end = last_idx + this.interval * min_len

                    return [start, end];
                }
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
         * @param {number|array<number>|object} movement  either a number stating the timestamp where our end (ie
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
                    // in this mode, only weekend gaps are collapsed; rest are left as-is
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
                    // in this mode all gaps are collapsed; note we still go through the data and detect where the gaps are located
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
                case 3: {  // == IB mode, ie index-based mode; TODO: is this used _only_ with renko data?
                    let { start_index, start, end, delta, data } = Utils.fast_filter_i(
                        this.ohlcv,
                        this.range,
                        movement
                    );

                    if (Array.isArray(data) && data.length !== 0) {
                        this.sub_start = start_index;
                        this.sub_start_i = data[0][6];  // TODO: '6' needs to be parametrized; actually should already be under incoming data settings, under... a key
                        this.ti_map = new TI(this, data);
                        data = this.ti_map.sub_i.reverse();  // note here's where we reverse the dataset in gap_collapse=3 mode!
                    } else {
                        return [];
                    }

                    // ! note no gaps in IB / gap_collapse=3 mode !
                    const range_changed = this.range.start !== start || this.range.end !== end;

                    if (range_changed || this.sub.length !== data.length) {
                        Utils.overwrite(this.sub, data)
                    }

                    if (range_changed) {
                        this.range_changed({
                            start, end, delta,
                        })
                    }

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
                skin: this.$props.skin,
                gap_collapse: this.$props.gap_collapse,
            }
        },
        overlay_subset_ORIG_UPSTREAM_premerge(source, side) {
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
         * TODO!! unconfirmed... upstream had load of changes we don't quite understand.
         *        more likely than not will need thinking and rework
         * -------------
         * Get excerpt from given {@code source} (eg onchart/offchart)
         * candles for current {@code this.range}
         */
        overlay_subset(source, side) {
            return source.map((d, i) => {
                let data;
                if (this.$props.gap_collapse === 3) {  // TODO!! good ol ib vs gap_collapse!
                    // data = this.ti_map.parse(Utils.fast_filter(
                    //     d.data,
                    //     this.ti_map.i2t(this.range.start - this.interval),
                    //     this.ti_map.i2t(this.range.end)
                    //     //this.ti_map.i2t(this.range.start - (d.tf || this.interval)),
                    //     //this.ti_map.i2t(this.range.end + (d.tf || this.interval))
                    // ));
                    // TODO!!: this block here has been modified to suite our range datatype,
                    // but what about we using d.indexSrc and that new i2t_mode() fun???
                    const res = Utils.fast_filter(
                        d.data, this.ti_map.i2t_mode(
                            this.range.start - this.interval,
                            d.indexSrc
                        ),
                        this.ti_map.i2t_mode(this.range.end, d.indexSrc)
                    )
                    data = this.ti_map.parse(res[0] || [], d.indexSrc || 'map')
                } else {
                    data = Utils.fast_filter(
                        d.data,
                        this.range.start - (d.tf || this.interval),
                        this.range.end + (d.tf || this.interval)
                    );
                }

                return {
                    type: d.type,
                    name: Utils.format_name(d),
                    data,
                    //data: this.ti_map.parse(res[0] || [], d.indexSrc || 'map'),     <-- upstream
                    settings: d.settings || this.settings_ov,
                    grid: d.grid || {},
                    tf: d.tf, // upstream has: Utils.parse_tf(d.tf)
                    i0: data[1],  // TODO!! does this work even for gap_collapse!=3 mode???
                    loading: d.loading,
                    last: (this.last_values[side] || [])[i]  // TODO!!: last - do we need to reverse something for our implementation?
                }
            });
        },

        section_props(i) {
            return i === 0 ? this.main_section : this.sub_section
        },
        init_range() {
            this.calc_interval()
            return this.default_range()  // note upstream's default_range() didn't rertun anything, hence why _we_ return from this function here
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
            const lay = new Layout(this)
            Utils.copy_layout(this._layout, lay)
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
            this.last_candle = d ? d[d.length - 1] : []  // TODO!!: upstream defaults to undefined instead of []
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
        },
        on_dc_legend_button_click(event) {
            this.$emit('dc-legend-button-click', event)
        },
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
        //filter() {  TODO: upstream's subset() called it
        //    return this.$props.ib ?
        //        Utils.fast_filter_i : Utils.fast_filter
        //},
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
        forced_tf() {  // TODO!! this is a new field from upstream we likely should make more use of
            return this.chart.tf
        }
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
            activated: false,

            sub_start_i: null,
            ti_map: null,
            dc_legend_displayed: false,  // whether DC legend should be shown

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
                this.range.start = this.ti_map.i2t(this.range.start)
                this.range.end = this.ti_map.i2t(this.range.end)
                this.range.delta = this.range.end - this.range.start
                this.ti_map = null
                //Utils.overwrite(this.range, [t1, t2])
                this.interval = this.interval_ms
            } else {
                this.init_range() // TODO: calc index range instead
                //Utils.overwrite(this.range, this.range)
                Object.assign(this.range, this.range)  // TODO: is this really necessary?
                this.interval = 1
            }

            this.subset()  // overwrite this.sub & trigger update_layout() if necessary
        },
        timezone() {
            this.update_layout()
        },
        colors() {
            Object.assign(this.range, this.range)  // TODO: is this really necessary?
            //this.range = Object.assign({}, this.range);  //  TODO can we use maybe this instead above line?
        },
        forced_tf(n, p) {
            this.update_layout(true)
            this.ce('exec-all-scripts')
        },
        data: {
            handler: function(n, p) {
                if (this.$props.gap_collapse === 3 && this.sub_start_i !== null) {
                    const ia = new IndexedArray(n.chart.data, '6');  // TODO: '6' needs to be parametrized
                    ia.fetch(this.sub_start_i);  // move cursor to current, pre-move end
                    // TODO: issue if new data is fetched when gap is not yet visible - we lose all candles on reload
                    if (ia.cursor !== this.sub_start) {
                        const delta = ia.cursor - this.sub_start;
                        this.range.start += delta;
                        this.range.end += delta;
                        this.sub_start = ia.cursor;  // TODO: why couldn't/shouldn't this be overridden?
                    }
                    // TODO: what to do if ia.cursor is null? is it possible?
                }


              /**
               * endTimestamp
               * @type {object|number|array|undefined}
               */
                const endTimestamp = this.sub.length === 0 ? this.init_range() : undefined;  // init_range() should be called first thing here!
                this.init_secondary_series_tf();

                // TODO: find a better solution than ohlcv.slice().reverse()!:
                // TODO2: why are we resolving gaps here, not in subset() where gap_collapse===1 logic is??
                if (this.$props.gap_collapse === 1) {
                    Utils.overwrite(this.gaps, Utils.resolve_gaps(this.ohlcv.slice(0).reverse(), this.interval, this.$props.gap_collapse))
                }
                this.subset(endTimestamp);  // _always_ call subset in order to redraw when data changes, eg if data is lazy-loaded

                // TODO: data changed detection not working?:
                //window.console.log(`d changed?: ${Utils.data_changed(n, p)}`)

                // TODO!!: upstream has this: is this something new we should use instead of our utils.data_changed?: {
                //let nw = this.data_changed()  // TODO what/where is this    this.data_changed()? is that new?
                //this.update_layout(nw)
                // }

                const nw = Utils.data_changed(n, p)  // TODO!!: upstream used this method instead:  nw = this.data_changed()
                this.update_layout(nw)
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
