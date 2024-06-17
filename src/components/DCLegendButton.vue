<template>
  <div>
    <img v-if="display"
         class="t-vue-dc-lbtn"
        :src="base64"
        @click="onclick"
    />

<!--  <Teleport v-if="id === 'goto'"-->
  <Teleport to="body">
    <!-- use the modal component, pass in the prop -->
    <Modal
           ref="modal"
           :show="showModal"
           :common="common"
           @go-to="emitUpstream"
           @close="closeModal">
      <template #header>
        <h3>Go to...</h3>
      </template>

      <template #body>
        <div v-if="orders.length">
          <h3>Orders:</h3>
          <ul>
            <li
                v-for="(order, i) in orders"
                :key="i">
              <span :style="{color: order[1] === 0 ? 'red' : 'green'}"
                    @click="onOrderClick(i, order)">{{ i+1 }}: {{ order[1] === 0 ? 'S' : 'B' }} {{ order[0] }}</span>
            </li>
          </ul>
        </div>
      </template>
    </Modal>
  </Teleport>
  </div>
</template>
<script>
import Icons from '../stuff/icons.json'
import Modal from './Modal.vue'
import dayjs from 'dayjs'

const ARROW_DOWN_KEYCODE = 40

export default {
    components: {
      Modal
    },
    name: 'DCLegendButton',
    props: ['id', 'display', 'common'],
    mounted() {
      if (this.$props.id === 'goto') {
        document.body.addEventListener('keyup', this.onKey);  // with 'keydown' event the input value pre-selection doesn't work
      }
    },
    computed: {
        base64() {
            return Icons[this.file_name]
        },
        file_name() {
            return this.$props.id + '.png'
        },
        orders() {
          const orders = this.$props.common.dcData.onchart.find(oc => oc.type === 'Trades')
          // console.log(`onchart ${this.$props.common.dcData.onchart.length}, orders: ${orders.length}`)
          return orders ? orders.data : []
        }
    },
    data() {
      return {
        showModal: false
      }
    },
    methods: {
        onclick() {
          if (this.$props.id === 'goto') {
            this.openModal()
          } else {
            this.emitUpstream()
          }
        },
        onOrderClick(i, order) {
          this.emitUpstream(dayjs(order[0]))
          this.closeModal()
        },
        emitUpstream(optionalE) {
          const payload = {
            button: this.$props.id,  // value will be like 'left', 'right', 'goto'...
          }

          if (payload.button === 'goto') {
            payload.goToMs = +optionalE  // unix epoch millis
          }

          // push the event up the tree...:
          this.$emit('dc-legend-button-click', payload);
        },
        closeModal() {
          this.showModal = false
        },
        openModal() {
          this.showModal = true
        },
        toggleModal() {
          this.showModal ? this.closeModal() : this.openModal();
        },
        onKey(event) {
          if (event.keyCode === ARROW_DOWN_KEYCODE) {
            this.toggleModal();
          }
        },
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
