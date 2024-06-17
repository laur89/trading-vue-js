<template>
<div class="tv-dc-legend" :style="calc_style">
    <span class="t-vue-dc-btn-grp">
        <d-c-legend-button
            id="goto"
            display="true"
            :common="common"
            @dc-legend-button-click="on_button_click"
        ></d-c-legend-button>
        <d-c-legend-button
            v-for="(b, i) in buttons"
            :id="b"
            :key="i"
            :display="display"
            :common="common"
            @dc-legend-button-click="on_button_click"
        ></d-c-legend-button>
    </span>
</div>
</template>
<script>

import DCLegendButton from './DCLegendButton.vue'

export default {
    name: 'DCLegend',
    components: { DCLegendButton },
    props: [
        'common', 'display', 'dc_left_btn_displayed'
    ],
    computed: {
        calc_style() {
            // TODO: 42px here is the expected native icon edge
            // TODO 2: prolly need to modify these based on how many buttons are shown! to make sure the buttons are not forced to resize in order to fit
            const vertical_margin = this.$props.common.layout.grids[0].height < 200 ? 42 : 62
            // const horizontal_margin = this.$props.common.layout.grids[0].spacex < 1000 ? 42 : 62
            const horizontal_margin = (this.$props.common.layout.grids[0].spacex < 1000 ? 0 : 20) + this.buttons.length * 42
            return {
                top: `${this.$props.common.layout.grids[0].height - vertical_margin}px`,
                left: `${this.$props.common.layout.grids[0].spacex - horizontal_margin}px`,
                // maxWidth: 100
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
        // window.console.log(`dc legend btnd clicked; ${JSON.stringify(event)}`)
        this.$emit('dc-legend-button-click', event)
      },
    },
    data() {
        return {
            buttons: ['left', 'right'],
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

/* make sure buttons are on single line: */
.t-vue-dc-btn-grp {
  display: flex;
  justify-content: space-between;
}
</style>
