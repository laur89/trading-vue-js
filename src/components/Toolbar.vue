
<template>
    <div class="trading-vue-toolbar"
         :key="tool_count"
         :style="styles">
        <toolbar-item v-for="(tool, i) in data.tools"
            v-if="tool.icon"
            @item-selected="selected"
            :key="i"
            :data="tool"
            :config="config"
            :colors="colors"
            :selected="tool.type === data.tool">
        </toolbar-item>
    </div>
</template>

<script>

import ToolbarItem from './ToolbarItem.vue'

export default {
    name: 'Toolbar',
    components: { ToolbarItem },
    props: [
        'data', 'height', 'colors', 'tv_id', 'config'
    ],
    mounted() {

    },
    methods: {
        selected(tool) {
            this.$emit('custom-event', {
                event: 'tool-selected',
                args: [tool.type]
            })
        }
    },
    computed: {
        styles() {
            const colors = this.$props.colors
            const b = this.$props.config.TB_BORDER
            const w = this.$props.config.TOOLBAR - b
            const c = colors.colorGrid
            const cb = colors.colorTbBack || colors.colorBack
            const brd = colors.colorTbBorder || colors.colorScale
            const st = this.$props.config.TB_B_STYLE

            return {
                'width': `${w}px`,
                'height': `${this.$props.height}px`,
                'background-color': cb,
                'border-right': `${b}px ${st} ${brd}`
            }
        }
    },
    watch: {
        data: {
            handler(n) {
                // For some reason Vue.js doesn't want to
                // update 'tools' automatically when new item
                // is pushed/removed. Yo, Vue, I herd you
                // you want more dirty tricks?
                if (n.tools) this.tool_count = n.tools.length
            },
            deep: true
        }
    },
    data() {
        return { tool_count: 0 }
    }
}

</script>

<style>
.trading-vue-toolbar {
    position: absolute;
    border-right: 1px solid black;
    z-index: 100;
    padding-top: 3px;
}
</style>
