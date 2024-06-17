<script>
import { debounce } from 'lodash-es';
import dayjs from 'dayjs-parser/dayjs'
// import { DateTime } from 'luxon'
// import 'luxon-parser' // simply causes the luxon's DateTime to be monkeypatched

const ESC_KEYCODE = 27
const NOW = dayjs()

export default {
  props: {
    show: Boolean,
    common: Object,
  },
  mounted() {
  },
  data() {
    return {
      isValidTimestamp: false,
      input: '',
      text: 'sup2',
      date: null
    }
  },
  watch: {
    show: {
      handler: function (newValue) {
        if (newValue) {
          document.body.addEventListener('keydown', this.onEscKey);
          this.$nextTick(function () {
            // this.$refs.input.focus();  // focus, but don't pre-select possible existing value
            this.$refs.input.select();  // pre-select data in input field
          })
        } else {
          document.removeEventListener('keydown', this.onEscKey);
        }
      }
    },
  },
  methods: {
    onclick() {
      if (this.isValidTimestamp) {
        this.$emit('go-to', this.date)
        this.closeModal()
      } else {
        console.log('invalid time, try again');
      }
    },
    onEscKey(event) {
      if (event.keyCode === ESC_KEYCODE) {
        this.closeModal()
      }
    },
    closeModal() {
      this.$emit('close')
    },
    onInputDebounced: debounce(function (e) {
      let d = e.target.value;
      this.input = d;

      if (/^1\d{9}000$/.test(d)) {
        d = `@${d/1000}`  // millis to seconds
      } else if (/^1\d{9}$/.test(d)) {
        d = `@${d}`
      }

      d = dayjs(d)
      // d = DateTime.fromHuman(d)  // luxon
      this.isValidTimestamp = false  // reset

      if (!d.isValid()) {
        this.text = 'invalid date lol, try again'
        return
      }

      const chartStart = dayjs(`@${this.$props.common.dcDynamicData.startTimestamp / 1000}`)
      const chartEnd = dayjs(`@${this.$props.common.dcDynamicData.endTimestamp / 1000}`)

      if (d.isAfter(chartEnd)) {
        this.text = `invalid - selected date [${d}] after our chart endDate of ${chartEnd}`;
        return
      } else if (d.isAfter(NOW)) {
        this.text = `invalid - selected date [${d}] is in the future`;
        return
      } else if (d.isBefore(chartStart)) {
        this.text = `invalid - selected date [${d}] before our chart startDate of ${chartStart}`;
        return
      }

      // this.isValidTimestamp = d.isValid  // luxon
      this.isValidTimestamp = true
      this.date = d
      this.text = d.toString()
    }, 250)
  }
}
</script>

<template>
  <Transition name="modal">
    <div v-if="show" ref="goto-modal" class="modal-mask t-vue-dc-lbtn">
      <div class="modal-wrapper" @click="closeModal">
        <div class="modal-container" @click.stop="">
          <div class="modal-header">
            <slot name="header">default header</slot>
          </div>

          <div class="modal-body overflow-auto">
            <slot name="body">{{ text }}</slot>
            <slot name="errtxt">{{ text }}</slot>
          </div>

          <div class="modal-footer">
            <input
                ref="input"
                :value="input"
                @input="onInputDebounced"
                @keyup.enter="onclick">

            <slot name="footer">
              default footer
              <button
                  class="modal-default-button"
                  @click="onclick"
              >OK</button>
            </slot>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style>
.modal-mask {
  position: fixed;
  z-index: 9998;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: table;
  transition: opacity 0.3s ease;
}

.modal-wrapper {
  display: table-cell;
  vertical-align: middle;
}

.modal-container {
  width: 300px;
  margin: 0px auto;
  padding: 20px 30px;
  background-color: #fff;
  border-radius: 2px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.33);
  transition: all 0.3s ease;
}

.modal-header h3 {
  margin-top: 0;
  color: #42b983;
}

.modal-body {
  margin: 20px 0;
  max-height: 50vh;
}

.modal-default-button {
  float: right;
}

/*
 * The following styles are auto-applied to elements with
 * transition="modal" when their visibility is toggled
 * by Vue.js.
 *
 * You can easily play with the modal transition by editing
 * these styles.
 */

.modal-enter-from {
  opacity: 0;
}

.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  -webkit-transform: scale(1.1);
  transform: scale(1.1);
}
</style>
