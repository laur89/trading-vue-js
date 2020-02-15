// Grid.js listens to various user-generated events,
// emits Vue-events if something has changed (e.g. range)
// Think of it as an I/O system for Grid.vue

import * as Hammer from 'hammerjs'
import Hamster from 'hamsterjs'
import Utils from '../../stuff/utils.js'

// Grid is good.
export default class Grid {

    constructor(canvas, comp) {

        this.MIN_ZOOM = comp.config.MIN_ZOOM
        this.MAX_ZOOM = comp.config.MAX_ZOOM

        this.canvas = canvas
        this.ctx = canvas.getContext('2d')
        this.comp = comp
        this.$p = comp.$props
        this.data = this.$p.sub
        this.range = this.$p.range
        this.id = this.$p.grid_id
        this.layout = this.$p.layout.grids[this.id]
        this.interval = this.$p.interval
        this.cursor = comp.$props.cursor
        this.offset_x = 0
        this.offset_y = 0
        this.deltas = 0 // Wheel delta events
        this.drag = null;
        this.pinch = null;

        this.listeners()
        this.overlays = []
    }

    listeners() {
        const hamster = Hamster(this.canvas)
        hamster.wheel((event, delta) => this.mousezoom(-delta * 50, event))

        const mc = new Hammer.Manager(this.canvas)
        mc.add(new Hammer.Pan())
        mc.add(new Hammer.Tap())
        mc.add(new Hammer.Pinch())
        mc.get('pinch').set({ enable: true })

        mc.on('panstart', event => {
            if (this.cursor.scroll_lock) return
            const tfrm = this.$p.y_transform
            this.drag = {
                x: event.center.x + this.offset_x,
                y: event.center.y + this.offset_y,
                r: this.range.slice(0),
                t: this.range[1] - this.range[0],
                o: tfrm ? (tfrm.offset || 0) : 0,
                y_r: tfrm && tfrm.range ? tfrm.range.slice(0) : undefined
            }
            this.comp.$emit('cursor-changed', {
                grid_id: this.id,
                x: event.center.x + this.offset_x,
                y: event.center.y + this.offset_y
            })
            this.comp.$emit('cursor-locked', true)
        })

        mc.on('panmove', event => {
            if (this.drag !== null) {
                this.mousedrag(
                    this.drag.x + event.deltaX,
                    this.drag.y + event.deltaY,
                )
                this.comp.$emit('cursor-changed', {
                    grid_id: this.id,
                    x: event.center.x + this.offset_x,
                    y: event.center.y + this.offset_y
                })
            }
        })

        mc.on('panend', () => {
            this.drag = null
            this.comp.$emit('cursor-locked', false)
        })

        mc.on('tap', event => {
            this.comp.$emit('cursor-changed', {
                grid_id: this.id,
                x: event.center.x + this.offset_x,
                y: event.center.y + this.offset_y
            })
            this.update()
        })

        mc.on('pinchstart', () => {
            this.pinch = {
                t: this.range[1] - this.range[0],
                r: this.range.slice(0)
            }
        })

        mc.on('pinchend', () => {
            this.pinch = null
        })

        mc.on('pinch', event => {
            if (this.pinch !== null) this.pinchzoom(event.scale)
        })

        window.addEventListener('gesturestart', event => {
            event.preventDefault()
        })

        window.addEventListener('gesturechange', event => {
            event.preventDefault()
        })

        window.addEventListener('gestureend', event => {
            event.preventDefault()
        })
    }

    mousemove(event) {

        this.comp.$emit('cursor-changed', {
            grid_id: this.id,
            x: event.layerX,
            y: event.layerY + this.layout.offset
        })
        // TODO: Temp solution, need to implement
        // a proper way to get the chart el offset
        this.offset_x = event.layerX - event.pageX
            + window.scrollX
        this.offset_y = event.layerY - event.pageY
            + this.layout.offset
            + window.scrollY

        this.propagate('mousemove', event)
    }

    mouseout(event) {
        this.comp.$emit('cursor-changed', {})
        this.propagate('mouseout', event)
    }

    mouseup(event) {
        this.drag = null
    //    this.pinch = null
        this.comp.$emit('cursor-locked', false)
        this.propagate('mouseup', event)
    }

    mousedown(event) {
        this.propagate('mousedown', event)
        this.comp.$emit('cursor-locked', true)
        if (event.defaultPrevented) return
        this.comp.$emit('custom-event', {
            event: 'grid-mousedown', args: [this.id]
        })
    }

    click(event) {
        this.propagate('click', event)
    }

    new_layer(layer) {
        if (layer.name === 'crosshair') {
            this.crosshair = layer
        } else {
            this.overlays.push(layer)
        }
        this.update()
    }

    del_layer(id) {
        this.overlays = this.overlays.filter(x => x.id !== id)
        this.update()
    }

    show_hide_layer(event) {
        const l = this.overlays.filter(x => x.id === event.id)
        if (l.length) l[0].display = event.display
    }

    update() {
        // Update reference to the grid
        // TODO: check what happens if data changes interval
        this.layout = this.$p.layout.grids[this.id]
        this.interval = this.$p.interval

        if (!this.layout) return

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
        this.grid()

        this.overlays.slice(0)  // copy
            .sort((l1, l2) => l1.z - l2.z)  // z-index sorting
            .forEach(l => {
                if (!l.display) return
                this.ctx.save()
                const r = l.renderer
                if (r.hasOwnProperty('pre_draw') && typeof r.pre_draw === 'function') r.pre_draw(this.ctx)
                r.draw(this.ctx)
                if (r.hasOwnProperty('post_draw') && typeof r.post_draw === 'function') r.post_draw(this.ctx)
                this.ctx.restore()
            })

        if (this.crosshair) {
            this.crosshair.renderer.draw(this.ctx)
        }
    }

    // Actually draws the grid (for real)
    grid() {

        this.ctx.strokeStyle = this.$p.colors.colorGrid
        this.ctx.beginPath()

        const ymax = this.layout.height
        for (const [x, p] of this.layout.xs) {

            this.ctx.moveTo(x - 0.5, 0)
            this.ctx.lineTo(x - 0.5, ymax)
        }

        for (const [y, y$] of this.layout.ys) {

            this.ctx.moveTo(0, y - 0.5)
            this.ctx.lineTo(this.layout.width, y - 0.5)
        }

        this.ctx.stroke()
        if (this.$p.grid_id) this.upper_border()
    }

    upper_border() {
        this.ctx.strokeStyle = this.$p.colors.colorScale
        this.ctx.beginPath()
        this.ctx.moveTo(0, 0.5)
        this.ctx.lineTo(this.layout.width, 0.5)
        this.ctx.stroke()
    }

    mousezoom(delta, event) {

        event.originalEvent.preventDefault()
        event.preventDefault()

        event.deltaX = event.deltaX || Utils.get_deltaX(event)
        event.deltaY = event.deltaY || Utils.get_deltaY(event)

        if (event.deltaX !== 0) {
            this.trackpad = true
            if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
                delta *= 0.1
            }
            this.trackpad_scroll(event)
        }

        if (this.trackpad) delta *= 0.032

        delta = Utils.smart_wheel(delta)

        // TODO: mouse zooming is a little jerky,
        // needs to follow f(mouse_wheel_speed) and
        // if speed is low, scroll should be slower
        if (delta < 0 && this.data.length <= this.MIN_ZOOM) return
        if (delta > 0 && this.data.length > this.MAX_ZOOM) return

        const k = this.interval / 1000
        let diff = delta * k * this.data.length
        if (event.originalEvent.ctrlKey) {
            let offset = event.originalEvent.offsetX
            let diff_x = offset / (this.canvas.width-1) * diff
            let diff_y = diff - diff_x
            this.range[0] -= diff_x
            this.range[1] += diff_y
        } else {
            this.range[0] -= diff
        }

        this.change_range()
    }

    mousedrag(x, y) {

        const dt = this.drag.t * (this.drag.x - x) / this.layout.width

        let d$ = this.layout.$_hi - this.layout.$_lo
        d$ *= (this.drag.y - y) / this.layout.height
        const offset = this.drag.o + d$

        if (this.$p.y_transform && !this.$p.y_transform.auto) {
            this.comp.$emit('sidebar-transform', {
                grid_id: this.id,
                range: [
                    this.drag.y_r[0] - offset,
                    this.drag.y_r[1] - offset,
                ]
            })
        }

        this.range[0] = this.drag.r[0] + dt
        this.range[1] = this.drag.r[1] + dt

        this.change_range()
    }

    pinchzoom(scale) {

        if (scale > 1 && this.data.length <= this.MIN_ZOOM) return
        if (scale < 1 && this.data.length > this.MAX_ZOOM) return

        const t = this.pinch.t
        const nt = t * 1 / scale

        this.range[0] = this.pinch.r[0] - (nt - t) * 0.5
        this.range[1] = this.pinch.r[1] + (nt - t) * 0.5

        this.change_range()
    }

    trackpad_scroll(event) {

        const dt = this.range[1] - this.range[0]

        this.range[0] += event.deltaX * dt * 0.011
        this.range[1] += event.deltaX * dt * 0.011

        this.change_range()
    }

    change_range() {

        // TODO: better way to limit the view. Problem:
        // when you are at the dead end of the data,
        // and keep scrolling,
        // the chart continues to scale down a little.
        // Solution: I don't know yet

        if (!this.range.length || this.data.length < 2) return

        const l = this.data.length - 1

        this.range[0] = Utils.clamp(
            this.range[0],
            -Infinity, this.data[l][0] - this.interval * 5.5,
        )

        this.range[1] = Utils.clamp(
            this.range[1],
            this.data[0][0] + this.interval * 5.5, Infinity
        )

        // TODO: IMPORTANT scrolling is jerky The Problem caused
        // by the long round trip of 'range-changed' event.
        // First it propagates up to update layout in Chart.vue,
        // then it moves back as watch() update. It takes 1-5 ms.
        // And because the delay is different each time we see
        // the lag. No smooth movement and it's annoying.
        // Solution: we could try to calc the layout immediatly
        // somewhere here. Still will hurt the sidebar & bottombar
        this.comp.$emit('range-changed', this.range)
    }

    // Propagate mouse event to overlays
    propagate(name, event) {
        for (const layer of this.overlays) {
            if (layer.renderer.hasOwnProperty(name) && typeof layer.renderer[name] === 'function') {
                layer.renderer[name](event)
            }

            const mouse = layer.renderer.mouse
            if (mouse.listeners) {
                mouse.emit(name, event)
            }

            const keys = layer.renderer.keys
            if (keys && keys.listeners) {
                keys.emit(name, event)
            }
        }
    }
}
