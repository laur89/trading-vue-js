<template>
    <img v-if="display" class="t-vue-dc-lbtn"
        :src="base64"
        @click="onclick"
    />
</template>
<script>

import Icons from '../stuff/icons.json'

export default {
    name: 'DCLegendButton',
    props: ['id', 'display'],
    mounted() {
    },
    computed: {
        base64() {
            return Icons[this.file_name]
        },
        file_name() {
            let id = this.$props.id
            if (this.$props.id === 'display') {
                id = this.$props.display ? 'display_on' : 'display_off'
            }
            return id + '.png'
        },
    },
    methods: {
        onclick() {
            this.$emit('dc-legend-button-click', {
                button: this.$props.id,
            });
        }
    }
}
</script>
<style>
.t-vue-dc-lbtn {
    z-index: 100;
    /*width: 21px;
    height: 21px;
    margin-bottom: -6px;*/
    pointer-events: all;
    cursor: pointer;
}
</style>
