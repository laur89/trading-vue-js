<template>
<span class="t-vue-lbtn-grp">
    <legend-button
        v-for="(b, i) in buttons"
        :id="b"
        :key="i"
        :tv_id="tv_id"
        :ov_id="ov_id"
        :grid_id="grid_id"
        :index="index"
        :display="display"
        v-on:legend-button-click="button_click"
    >
    </legend-button>
</span>
</template>
<script>

import LegendButton from './LegendButton.vue'

export default {
    name: 'ButtonGroup',
    components: {
        LegendButton
    },
    props: [
        'buttons', 'tv_id', 'ov_id', 'grid_id', 'index',
        'display'
    ],
    methods: {
        button_click(event) {
            this.$emit('legend-button-click', event)
        }
    }
}
</script>
<style>
.t-vue-lbtn-grp {
    margin-left: 0.5em;
}
</style>
