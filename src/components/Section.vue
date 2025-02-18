<template>
    <!-- Horizontal section: (grid + sidebar) -->
    <div class="trading-vue-section">
        <d-c-legend
                v-if="grid_id === 0"
                ref="dc_legend"
                :common="common"
                :display="dc_legend_displayed"
                @dc-legend-button-click="on_dc_legend_button_click"
        />
        <chart-legend
            :values="section_values"
            :grid_id="grid_id"
            :common="legend_props"
            :meta_props="get_meta_props"
            @legend-button-click="button_click">
        </chart-legend>
        <grid
             v-bind="grid_props"
             :grid_id="grid_id"
             @register-kb-listener="register_kb"
             @remove-kb-listener="remove_kb"
             @movement="movement_changed"
             @cursor-changed="cursor_changed"
             @cursor-locked="cursor_locked"
             @layer-meta-props="emit_meta_props"
             @custom-event="emit_custom_event"
             @sidebar-transform="sidebar_transform">
        </grid>
        <sidebar
            v-bind="sidebar_props"
            :grid_id="grid_id"
            :rerender="rerender"
            :shaders="shaders"
            @sidebar-transform="sidebar_transform">
        </sidebar>
    </div>
</template>

<script>

import DCLegend from './DCLegend.vue'
import Grid from './Grid.vue'
import Sidebar from './Sidebar.vue'
import ChartLegend from './Legend.vue'
import Shaders from '../mixins/shaders.js'

export default {
    name: 'GridSection',
    components: {
        Grid,
        Sidebar,
        ChartLegend,
        DCLegend,
    },
    mixins: [Shaders],
    props: ['common', 'grid_id', 'dc_legend_displayed'],
    methods: {
        movement_changed(m) {
            this.$emit('movement', m)
        },
        cursor_changed(c) {
            c.grid_id = this.$props.grid_id
            this.$emit('cursor-changed', c)
        },
        cursor_locked(state) {
            this.$emit('cursor-locked', state)
        },
        sidebar_transform(s) {
            this.$emit('sidebar-transform', s)
        },
        emit_meta_props(d) {
            this.$set(this.meta_props, d.layer_id, d)
            this.$emit('layer-meta-props', d)
        },
        emit_custom_event(d) {
            this.on_shader_event(d, 'sidebar')
            this.$emit('custom-event', d)
        },
        button_click(event) {
            this.$emit('legend-button-click', event)
        },
        register_kb(event) {
            this.$emit('register-kb-listener', event)
        },
        remove_kb(event) {
            this.$emit('remove-kb-listener', event)
        },
        on_dc_legend_button_click(event) {
            this.$emit('dc-legend-button-click', event)
        },
    },
    computed: {
        // Component-specific props subsets:
        grid_props() {
            const id = this.$props.grid_id
            const p = Object.assign({}, this.$props.common)

            // Split offchart data between offchart grids
            if (id > 0) {
                const all = p.data  // contains _all_ offcharts' data
                p.data = [p.data[id - 1]]
                // Merge offchart overlays with custom ids with
                // the existing ones (by comparing the grid ids)
                p.data.push(...all.filter(
                    x => x.grid && x.grid.id === id))
            }

            p.width = p.layout.grids[id].width
            p.height = p.layout.grids[id].height
            p.y_transform = p.y_ts[id]
            return p
        },
        sidebar_props() {
            const id = this.$props.grid_id
            const p = Object.assign({}, this.$props.common)
            p.width = p.layout.grids[id].sb
            p.height = p.layout.grids[id].height
            p.y_transform = p.y_ts[id]
            return p
        },
        section_values() {
            const id = this.$props.grid_id
            const p = Object.assign({}, this.$props.common)
            p.width = p.layout.grids[id].width
            return p.cursor.values[id]
        },
        legend_props() {
            const id = this.$props.grid_id
            const p = Object.assign({}, this.$props.common)

            // Split offchart data between offchart grids
            if (id > 0) {
                const all = p.data
                p.data = [p.data[id - 1]]
                // TODO: show correct legend values
                p.data.push(...all.filter(
                    x => x.grid && x.grid.id === id))
            }
            return p
        },
        get_meta_props() {
            return this.meta_props
        }
    },
    watch: {
        common: {
            handler: function (val, old_val) {
                if (val.data.length !== old_val.data.length) {
                    // Look at this nasty trick!
                    this.rerender++
                }
            },
            deep: true
        }
    },
    data() {
        return {
            meta_props: {},
            shaders: [],
            rerender: 0
        }
    }
}
</script>
<style>
.trading-vue-section {
    height: 0;
    position: absolute;
}
</style>
