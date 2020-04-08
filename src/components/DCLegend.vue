<template>
<div class="tv-dc-legend" v-bind:style="calc_style">
    <span class="t-vue-dc-btn-grp">
        <d-c-legend-button v-for="(b, i) in buttons"
                :id="b"
                :key="i"
                :display="display"
                @dc-legend-button-click="on_button_click"
        >
        </d-c-legend-button>
    </span>
</div>
</template>
<script>

import DCLegendButton from './DCLegendButton.vue'

export default {
    name: 'DCLegend',
    components: { DCLegendButton },
    props: [
        'common', 'display',
    ],
    computed: {
        calc_style() {
            // TODO: 42px here is the expected native icon edge
            const vertical_margin = this.$props.common.layout.grids[0].height < 200 ? 42 : 62
            const horizontal_margin = this.$props.common.layout.grids[0].spacex < 1000 ? 42 : 62
            return {
                top: `${this.$props.common.layout.grids[0].height - vertical_margin}px`,
                left: `${this.$props.common.layout.grids[0].spacex - horizontal_margin}px`,
            }
        },
    },
    methods: {
        format(id, values) {
            const meta = this.$props.meta_props[id] || {}
            // Matches Overlay.data_colors with the data values
            // (see Spline.vue)
            if (!values[id]) return this.n_a(1)

            // Custom formatter
            if (meta.legend) return meta.legend(values[id])

            return values[id].slice(1).map((x, i) => {
                const cs = meta.data_colors ? meta.data_colors() : []
                if (typeof x == 'number') {
                    // Show 8 digits for small values
                    x = x.toFixed(x > 0.001 ? 4 : 8)
                }
                return {
                    value: x,
                    color: cs ? cs[i] : undefined
                }
            })
        },
        on_button_click(event) {
            this.$emit('dc-legend-button-click', event)
        },
    },
    data() {
        return {
            buttons: ['right'],
        }
    }
}
</script>
<style>
.tv-dc-legend {
    position: absolute;
    z-index: 100;
    font-size: 1.25em;
    pointer-events: none;
}
.t-vue-lspan {
    font-variant-numeric: tabular-nums;
    font-weight: 100;
    font-size: 0.95em;
    color: #999999; /* TODO: move => params */
    margin-left: 0.1em;
    margin-right: 0.2em;
}
.t-vue-title {
    margin-right: 0.25em;
    font-size: 1.45em;
    font-weight: 200;
}
.t-vue-ind {
    margin-left: 0.2em;
    margin-bottom: 0.5em;
    font-weight: 200;
    font-size: 1.0em;
}
.t-vue-ivalue {
    margin-left: 0.5em;
}
.t-vue-unknown {
    color: #999999; /* TODO: move => params */
}
</style>
