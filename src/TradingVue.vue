
<template>
    <!-- Main component  -->
    <div class="trading-vue" v-bind:id="id"
         :style="{
            color: this.colorText, font: this.font,
            width: this.width+'px',
            height: this.height+'px'}">
        <toolbar v-if="toolbar"
            @custom-event="on_custom_event"
            v-bind="chart_props"
            :config="chart_config">
        </toolbar>
        <chart
            :key="reset"
            ref="chart"
            v-bind="chart_props"
            :tv_id="id"
            :config="chart_config"
            @custom-event="on_custom_event"
            @range-changed="on_range_changed"
            @legend-button-click="on_legend_button">
        </chart>
    </div>
</template>

<script>

import Const from './stuff/constants.js'
import Chart from './components/Chart.vue'
import Toolbar from './components/Toolbar.vue'

export default {
    name: 'TradingVue',
    components: {
        Chart, Toolbar
    },
    props: {
        titleTxt: {
            type: String,
            default: 'TradingVue.js'
        },
        id: {
            type: String,
            default: 'trading-vue-js'
        },
        width: {
            type: Number,
            default: 800
        },
        height: {
            type: Number,
            default: 421
        },
        colorTitle: {
            type: String,
            default: '#42b883'
        },
        colorBack: {
            type: String,
            default: '#121826'
        },
        colorGrid: {
            type: String,
            default: '#2f3240'
        },
        colorText: {
            type: String,
            default: '#dedddd'
        },
        colorTextHL: {
            type: String,
            default: '#fff'
        },
        colorScale: {
            type: String,
            default: '#838383'
        },
        colorCross: {
            type: String,
            default: '#8091a0'
        },
        colorCandleUp: {
            type: String,
            default: '#23a776'
        },
        colorCandleDw: {
            type: String,
            default: '#e54150'
        },
        colorWickUp: {
            type: String,
            default: '#23a77688'
        },
        colorWickDw: {
            type: String,
            default: '#e5415088'
        },
        colorWickSm: {
            type: String,
            default: '#bdbec0'
        },
        colorVolUp: {
            type: String,
            default: '#79999e42'
        },
        colorVolDw: {
            type: String,
            default: '#ef535042'
        },
        colorPanel: {
            type: String,
            default: '#565c68'
        },
        colorTbBack: {
            type: String
        },
        colorTbBorder: {
            type: String,
            default: '#8282827d'
        },
        font: {
            type: String,
            default: Const.ChartConfig.FONT
        },
        toolbar: {
            type: Boolean,
            default: false
        },
        data: {
            type: Object,
            required: true
        },
        gap_collapse: {
            type: Number,
            default: 2,
        },
        // Your overlay classes here
        overlays: {
            type: Array,
            default: function () { return [] }
        },
        // Overwrites ChartConfig values,
        // see constants.js
        chartConfig: {
            type: Object,
            default: function () { return {} }
        },
        legendButtons: {
            type: Array,
            default: function () { return [] }
        },
        indexBased: {
            type: Boolean,
            default: false
        }
    },
    computed: {
        // Copy a subset of TradingVue props
        chart_props() {
            const offset = this.$props.toolbar ?
                this.chart_config.TOOLBAR : 0

            const chart_props = {
                title_txt: this.$props.titleTxt,
                overlays: this.$props.overlays,
                data: this.decubed,
                width: this.$props.width - offset,
                height: this.$props.height,
                font: this.$props.font,
                buttons: this.$props.legendButtons,
                toolbar: this.$props.toolbar,
                ib: this.$props.indexBased || this.index_based || false,
                gap_collapse: this.$props.gap_collapse,
                colors: {}
            }

            for (const k in this.$props) {
                if (k.indexOf('color') === 0) {
                    chart_props.colors[k] = this.$props[k]
                }
            }

            return chart_props
        },
        chart_config() {
            return Object.assign({},
                Const.ChartConfig,
                this.$props.chartConfig,
            )
        },
        decubed() {
            const data = this.$props.data

            if (data.hasOwnProperty('data')) {
                // DataCube detected
                data.init_tvjs(this)
                return data.data
            } else {
                return data
            }
        },
        index_based() {
            const base = this.$props.data
            if (base.chart) {
                return base.chart.indexBased
            }
            else if (base.data) {
                return base.data.chart.indexBased
            }
            return false
        }
    },
    data() {
        return { reset: 0 }
    },
    beforeDestroy() {
        this.on_custom_event({ event: 'before-destroy' })

        this.$refs.chart.$off('cursor-locked');
        this.$refs.chart.$off('range-changed');
        this.$refs.chart.$off('scroll-lock');
    },
    methods: {
        resetChart(resetRange = true) {
            this.reset++
            const range = this.getRange()

            if (!resetRange && range.start && range.end) {
                this.$nextTick(() => this.setRange(...range))  // TODO: need to correctly set the range here
            }
        },
        goto(t) {
            // TODO: limit goto & setRange (out of data error)
            if (this.chart_props.ib) {
                const ti_map = this.$refs.chart.ti_map
                t = ti_map.smth2i(t)
            }
            this.$refs.chart.goto(t)
        },
        pan(t) {
            this.$refs.chart.goto([t, t])
        },
        setRange(t1, t2) {
            if (this.chart_props.ib) {
                const ti_map = this.$refs.chart.ti_map
                t1 = ti_map.smth2i(t1)
                t2 = ti_map.smth2i(t2)
                console.log(t1, t2)
            }
            this.$refs.chart.setRange(t1, t2)
        },
        getRange() {
            if (this.chart_props.ib) {
                // Time range => index range
                const ti_map = this.$refs.chart.ti_map
                return this.$refs.chart.range
                    .map(x => ti_map.i2t(x))
            }
            return this.$refs.chart.range
        },
        getCursor() {
            let cursor = this.$refs.chart.cursor
            if (this.chart_props.ib) {
                let ti_map = this.$refs.chart.ti_map
                let copy = Object.assign({}, cursor)
                copy.i = copy.t
                copy.t = ti_map.i2t(copy.t)
                return copy
            }
            return cursor
        },
        on_legend_button(event) {
            this.$emit('legend-button-click', event)
        },
        on_custom_event(d) {
            if (d.hasOwnProperty('args')) {
                this.$emit(d.event, ...d.args)
            } else {
                this.$emit(d.event)
            }

            const data = this.$props.data
            if (data.hasOwnProperty('tv')) {
                // If the data object is DataCube
                data.on_custom_event(d.event, d.args)
            }
        },
        on_range_changed(r) {
            this.$emit('range-changed', r)
        },

        // TODO: perhaps instead of going through vue component for
        // event registration, consider using something like https://github.com/sandeepk01/vue-event-handler ?
        // or any other event-bus, or better yet - vuex
        register_range_changed_listener(onRangeChanged) {
            if (onRangeChanged) {
                this.$refs.chart.$off('range-changed')  // TODO: should we?
                this.$refs.chart.$on('range-changed',
                    r => onRangeChanged(r, this.$refs.chart.interval)
                )
            }
        },
        register_cursor_lock_listener(onCursorLockChanged) {
            if (onCursorLockChanged) {
                this.$refs.chart.$off('cursor-locked')  // TODO: should we?
                this.$refs.chart.$on('cursor-locked', onCursorLockChanged)
            }

            // TODO: we'll need scroll-lock emit as well!
            //this.$refs.chart.$on('scroll-lock', v => window.console.log(`>>> scroll-lock ev with value: ${v}`))
        },
    }
}
</script>
